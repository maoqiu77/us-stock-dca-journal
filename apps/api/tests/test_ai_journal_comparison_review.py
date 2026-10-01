from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('comparison_review', ROOT / 'scripts/review_ai_journal_comparison.py')
review_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review_module)


class ComparisonReviewTest(unittest.TestCase):
    def receipt(self):
        cases = []
        for index in range(2):
            engines = {name: {'status': 'completed', 'answer': f'answer-{index}-{name}', 'error_code': '',
                'fixed_input_sha256': 'frozen', 'duration_ms': 10 + index, 'requests': 1,
                'calls': [{'outcome': 'received', 'usage': {'input_tokens': 3, 'output_tokens': 2}}]}
                for name in review_module.ENGINES}
            cases.append({'id': f'case-{index}', 'category': 'time', 'fixed_input_sha256': 'frozen',
                'forbidden_claims': ['wrong date'], 'engines': engines})
        return {'synthetic_only': True, 'real_model_tested': True, 'dataset_sha256': 'dataset',
            'prompt_hashes': {'agent': 'a', 'legacy_llm': 'b'}, 'planned_cases': 2, 'cases': cases,
            'status': 'answers_ready_for_review', 'evaluation_plan': {'categories': 1,
                'cases_per_category': 2, 'minimum_pass_rate': .9, 'minimum_passes_per_category': 2,
                'critical_failures_allowed': 0}}

    def reviewed(self, receipt):
        review = review_module.review_template(receipt)
        review['reviewer'] = 'synthetic reviewer'
        for case in review['cases']:
            for engine in case['engines'].values():
                engine['checks'] = {dimension: 'pass' for dimension in review_module.DIMENSIONS}
                engine['notes'] = 'Reviewed the date against the frozen original.'
        return review

    def test_unreviewed_complete_answers_are_not_semantic_passes(self):
        receipt = self.receipt()
        result = review_module.compile_review(receipt, review_module.review_template(receipt))
        self.assertEqual(result['status'], 'incomplete_no_conclusion')
        self.assertIsNone(result['meets_frozen_semantic_gate'])
        self.assertIsNone(result['engines']['agent']['pass_rate'])

    def test_reviewed_tie_is_a_complete_comparison_without_inventing_a_winner(self):
        receipt = self.receipt()
        result = review_module.compile_review(receipt, self.reviewed(receipt))
        self.assertEqual(result['status'], 'reviewed_complete')
        self.assertTrue(result['meets_frozen_semantic_gate'])
        self.assertEqual(result['paired_outcomes'], {'both_pass': 2})
        self.assertEqual(result['quality_winner'], 'not_required_or_inferred')
        self.assertEqual(result['measurements']['legacy_llm']['input_tokens'], 6)

    def test_partial_and_critical_cases_fail_the_frozen_gate(self):
        receipt = self.receipt()
        review = self.reviewed(receipt)
        review['cases'][0]['engines']['agent']['checks']['time_currency_scope'] = 'partial'
        review['cases'][1]['engines']['legacy_llm']['issues'] = [
            {'severity': 'critical', 'note': 'Invented a historical reason.'}]
        result = review_module.compile_review(receipt, review)
        self.assertEqual(result['status'], 'reviewed_complete')
        self.assertFalse(result['meets_frozen_semantic_gate'])
        self.assertEqual(result['paired_outcomes'], {'legacy_only_pass': 1, 'agent_only_pass': 1})

    def test_changed_answer_input_prompt_or_duplicate_review_is_rejected(self):
        for mutation in ('answer', 'input', 'prompt', 'duplicate', 'reviewer'):
            receipt = self.receipt()
            review = self.reviewed(receipt)
            if mutation == 'answer': receipt['cases'][0]['engines']['agent']['answer'] = 'changed'
            elif mutation == 'input': receipt['cases'][0]['engines']['agent']['fixed_input_sha256'] = 'changed'
            elif mutation == 'prompt': review['prompt_hashes']['agent'] = 'changed'
            elif mutation == 'duplicate': review['cases'].append(copy.deepcopy(review['cases'][0]))
            else: review['reviewer'] = None
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                review_module.compile_review(receipt, review)

    def test_short_cohort_and_missing_usage_cannot_close_the_gate(self):
        for mutation in ('short', 'usage', 'failed'):
            receipt = self.receipt()
            if mutation == 'short': receipt['planned_cases'] = 60
            elif mutation == 'usage': receipt['cases'][0]['engines']['agent']['calls'][0]['usage'] = None
            else: receipt['cases'][0]['engines']['agent']['status'] = 'failed'
            result = review_module.compile_review(receipt, self.reviewed(receipt))
            with self.subTest(mutation=mutation):
                self.assertEqual(result['status'], 'incomplete_no_conclusion')
                self.assertIsNone(result['meets_frozen_semantic_gate'])
