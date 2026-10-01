"""Compile explicit human reviews of paired synthetic answers without model calls."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
from statistics import median

ENGINES = ('agent', 'legacy_llm')
DIMENSIONS = ('source_support', 'time_currency_scope', 'question_coverage')


def answer_hash(answer):
    return hashlib.sha256(answer.encode()).hexdigest()


def review_template(receipt):
    return {
        'schema_version': 1, 'dataset_sha256': receipt['dataset_sha256'],
        'prompt_hashes': dict(receipt['prompt_hashes']), 'reviewer': None,
        'instructions': 'Read every answer against frozen originals. Review citations for meaning, not ID membership. Null is unreviewed; do not tune on this held-out cohort.',
        'cases': [{'id': case['id'], 'category': case['category'],
            'required_claims': case.get('required_claims', []),
            'forbidden_claims': case['forbidden_claims'],
            'engines': {engine: {'answer_sha256': answer_hash(output['answer']),
                'checks': {dimension: None for dimension in DIMENSIONS},
                'notes': None, 'issues': []} for engine, output in case['engines'].items()}}
            for case in receipt['cases']],
    }


def compile_review(receipt, review):
    if (receipt.get('synthetic_only') is not True or review.get('schema_version') != 1
        or review.get('dataset_sha256') != receipt.get('dataset_sha256')
        or review.get('prompt_hashes') != receipt.get('prompt_hashes')):
        raise ValueError('review_input_identity_mismatch')
    case_ids = [case['id'] for case in receipt['cases']]
    reviews = [case['id'] for case in review['cases']]
    if len(set(case_ids)) != len(case_ids) or len(set(reviews)) != len(reviews) or set(reviews) != set(case_ids):
        raise ValueError('review_case_set_mismatch')
    indexed = {case['id']: case for case in review['cases']}
    totals = {engine: Counter() for engine in ENGINES}
    categories = defaultdict(lambda: {engine: Counter() for engine in ENGINES})
    pairs = Counter()
    all_reviewed = True
    all_complete = True
    measures = {engine: {'duration_ms': [], 'input_tokens': 0, 'output_tokens': 0, 'usage_complete': True,
        'requests': 0} for engine in ENGINES}
    for case in receipt['cases']:
        reviewed = indexed[case['id']]
        if reviewed.get('category') != case['category'] or set(reviewed['engines']) != set(case['engines']):
            raise ValueError('review_case_identity_mismatch')
        results = {}
        for engine in ENGINES:
            output, assessed = case['engines'].get(engine), reviewed['engines'].get(engine)
            if output is None:
                all_complete = all_reviewed = False
                continue
            if assessed['answer_sha256'] != answer_hash(output['answer']):
                raise ValueError('review_answer_changed')
            if output.get('fixed_input_sha256') != case['fixed_input_sha256']:
                raise ValueError('paired_input_mismatch')
            complete = output['status'] == 'completed' and bool(output['answer']) and not output.get('error_code')
            all_complete &= complete
            totals[engine]['answers_complete'] += complete
            checks = assessed['checks']
            if set(checks) != set(DIMENSIONS) or any(value not in {None, 'pass', 'partial', 'fail'} for value in checks.values()):
                raise ValueError('review_checks_invalid')
            critical = 0
            for issue in assessed['issues']:
                if issue.get('severity') not in {'minor', 'major', 'critical'} or not issue.get('note'):
                    raise ValueError('review_issue_invalid')
                critical += issue['severity'] == 'critical'
            totals[engine]['critical_issues'] += critical
            done = all(value is not None for value in checks.values())
            if done and (not review.get('reviewer') or not assessed.get('notes')):
                raise ValueError('reviewer_and_evidence_notes_required')
            all_reviewed &= done
            if done:
                passed = complete and all(value == 'pass' for value in checks.values()) and not critical
                totals[engine]['reviewed'] += 1
                totals[engine]['passed'] += passed
                categories[case['category']][engine]['reviewed'] += 1
                categories[case['category']][engine]['passed'] += passed
                results[engine] = passed
            measured = measures[engine]
            measured['duration_ms'].append(output['duration_ms'])
            measured['requests'] += output['requests']
            calls = output.get('calls', [])
            if len(calls) != output['requests'] or not calls:
                measured['usage_complete'] = False
            for call in calls:
                usage = call.get('usage') or {}
                values = [usage.get('input_tokens', usage.get('prompt_tokens')),
                    usage.get('output_tokens', usage.get('completion_tokens'))]
                if call.get('outcome') != 'received' or any(type(value) is not int or value < 0 for value in values):
                    measured['usage_complete'] = False
                else:
                    measured['input_tokens'] += values[0]
                    measured['output_tokens'] += values[1]
        if len(results) == 2:
            key = ('both_pass' if all(results.values()) else 'agent_only_pass' if results['agent']
                else 'legacy_only_pass' if results['legacy_llm'] else 'neither_full_pass')
            pairs[key] += 1
    planned = receipt.get('planned_cases', len(receipt['cases']))
    coverage_complete = len(receipt['cases']) == planned
    complete = (receipt.get('status') == 'answers_ready_for_review' and bool(receipt.get('real_model_tested'))
        and all_complete and all_reviewed and coverage_complete
        and all(values['usage_complete'] for values in measures.values()))
    plan = receipt.get('evaluation_plan') or {}
    meets_gate = None
    if complete and plan:
        meets_gate = all(totals[engine]['passed'] / planned >= plan['minimum_pass_rate']
            and totals[engine]['critical_issues'] <= plan['critical_failures_allowed']
            for engine in ENGINES)
        meets_gate &= len(categories) == plan['categories'] and all(
            categories[category][engine]['reviewed'] == plan['cases_per_category']
            and categories[category][engine]['passed'] >= plan['minimum_passes_per_category']
            for category in categories for engine in ENGINES)
    measurement = {}
    for engine, values in measures.items():
        durations = sorted(values['duration_ms'])
        measurement[engine] = {**{key: value for key, value in values.items() if key != 'duration_ms'},
            'median_duration_ms': median(durations) if durations else None,
            'p95_duration_ms': durations[math.ceil(len(durations) * .95) - 1] if durations else None}
    return {'schema_version': 1, 'synthetic_only': True,
        'status': 'reviewed_complete' if complete else 'incomplete_no_conclusion',
        'dataset_sha256': receipt['dataset_sha256'], 'prompt_hashes': receipt['prompt_hashes'],
        'planned_cases': planned, 'observed_cases': len(receipt['cases']),
        'engines': {engine: {**totals[engine],
            'pass_rate': totals[engine]['passed'] / planned if complete else None} for engine in ENGINES},
        'categories': {category: {engine: dict(values) for engine, values in engines.items()}
            for category, engines in categories.items()},
        'paired_outcomes': dict(pairs), 'measurements': measurement,
        'meets_frozen_semantic_gate': meets_gate,
        'quality_winner': 'not_required_or_inferred',
        'limits': 'Descriptive results on this synthetic original-memory cohort. Related cases are not independent field samples. No proof of model superiority, live portfolio reliability or upstream billing.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--review', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    home = args.workspace.resolve()
    if not home.is_relative_to((root / 'storage/local').resolve()):
        parser.error('review outputs must stay under storage/local')
    receipt = json.loads((home / 'verification.json').read_text())
    if args.review:
        report = compile_review(receipt, json.loads(args.review.read_text()))
        target = home / 'comparison.json'
    else:
        report = review_template(receipt)
        target = home / 'review-template.json'
    if target.exists():
        parser.error('existing review output is preserved; choose a fresh workspace')
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'output': str(target), 'status': report.get('status', 'awaiting_manual_review')}))


if __name__ == '__main__':
    main()
