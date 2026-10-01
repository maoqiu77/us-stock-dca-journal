"""Offline synthetic retrieval evaluation; no credentials or provider requests."""
from __future__ import annotations

from contextlib import closing
from datetime import datetime
import sqlite3
from types import SimpleNamespace

from ..models import PreviewRequest
from .contracts import Evidence
from .memory import candidates, retrieve
from .scope import build_scope


def evaluate_retrieval(dataset):
    if dataset.get('schema_version') != 1 or dataset.get('synthetic') is not True:
        raise ValueError('synthetic_dataset_required')
    stamp = datetime.fromisoformat(dataset['known_at'])
    if stamp.tzinfo is None:
        raise ValueError('timezone_required')
    originals, cases = dataset['originals'], dataset['cases']
    original_ids = [row['id'] for row in originals]
    case_ids = [row['id'] for row in cases]
    if not cases or len(set(original_ids)) != len(original_ids) or len(set(case_ids)) != len(case_ids):
        raise ValueError('evaluation_ids_invalid')
    results = []
    # Isolated originals use the production candidate query, freezing and retrieval.
    with closing(sqlite3.connect(':memory:')) as db:
        db.row_factory = sqlite3.Row
        db.execute('create table ai_journal_notes(id text,body text,updated_at text,deleted_at text)')
        trades = []
        for row in originals:
            if row['kind'] == 'note':
                db.execute('insert into ai_journal_notes values (?,?,?,?)',
                    (row['id'], row['text'], row['version_at'], row.get('deleted_at')))
            elif row['kind'] == 'trade_reason':
                trades.append({'id': row['id'], 'ticker': row['ticker'], 'date': row['trade_date'],
                    'note': row['text'], **({'updated_at': row['version_at']} if row.get('version_at') else {})})
            else:
                raise ValueError('original_kind_invalid')
        journal = SimpleNamespace(connect=lambda: db)
        board = SimpleNamespace(catalog=SimpleNamespace(resolve=lambda _: None))
        for case in cases:
            expected = set(case['expected_original_ids'])
            if not expected.issubset(original_ids) or len(expected) != len(case['expected_original_ids']):
                raise ValueError('expected_original_ids_invalid')
            request = PreviewRequest(task_type='conversation', engine='agent', auto_context=True,
                question=case['question'], memory_excluded_ids=case.get('excluded_ids', []),
                memory_before=case.get('before'))
            private = candidates(journal, {'trades': trades}, request, stamp)
            _, sources = build_scope(board, request, private, [], stamp)
            rows = [Evidence.model_validate(row) for row in sources]
            filters = {name: datetime.fromisoformat(case[name]) for name in ('before', 'after') if case.get(name)}
            top = retrieve(case['question'], rows, **filters)[:5]
            found = [row.payload['id'] for row in top]
            frozen = {row.payload['id'] for row in rows}
            forbidden = set(case.get('forbidden_original_ids', []))
            results.append({'id': case['id'], 'expected_original_ids': sorted(expected), 'top5_original_ids': found,
                'candidate_original_ids': sorted(frozen),
                'candidate_recall': len(expected & frozen) / len(expected) if expected else None,
                'recall_at_5': len(expected & set(found)) / len(expected) if expected else None,
                'empty_result_passed': not found if not expected else None,
                'forbidden_sources_absent': not bool(forbidden & (frozen | set(found)))})
    positive = [row for row in results if row['recall_at_5'] is not None]
    recall = sum(row['recall_at_5'] for row in positive) / len(positive) if positive else None
    return {'schema_version': 1, 'synthetic': True, 'real_model_tested': False,
        'scope': 'production_candidates_freeze_and_bm25; top5_of_bounded_results',
        'case_count': len(results), 'positive_case_count': len(positive),
        'recall_at_5': recall, 'target': .85,
        'passed': bool(positive) and recall >= .85 and all(
            row['forbidden_sources_absent'] and row['empty_result_passed'] is not False for row in results),
        'semantic_entailment': 'not_evaluated', 'cases': results}


def comparison_template(dataset):
    """Prepare paired reviews; missing answers/scores/costs stay unknown."""
    retrieval = evaluate_retrieval(dataset)
    frozen = {row['id']: row['candidate_original_ids'] for row in retrieval['cases']}
    return {'schema_version': 1, 'synthetic': True, 'real_model_tested': False,
        'status': 'awaiting_paired_outputs_and_review',
        'instructions': 'Use identical frozen originals and assumptions for both engines. Review claims against original text; citation membership alone is insufficient. Never replay an uncertain request.',
        'cases': [{'id': row['id'], 'question': row['question'],
            'fixed_input': {'known_at': dataset['known_at'],
                'before': row.get('before'), 'after': row.get('after'),
                'excluded_ids': row.get('excluded_ids', []),
                'originals': [original for original in dataset['originals'] if original['id'] in frozen[row['id']]],
                'positions': [], 'plans': [], 'market_observations': [], 'cash': None,
                'user_assumptions': {}},
            'expected_original_ids': row['expected_original_ids'],
            'acceptable_response': row['acceptable_response'], 'forbidden_claims': row['forbidden_claims'],
            'engines': {engine: {'answer': None, 'source_reliability_review': None,
                'calculation_correctness_review': None, 'input_tokens': None, 'output_tokens': None,
                'cost_cny': None, 'duration_ms': None} for engine in ('legacy_llm', 'agent')}}
            for row in dataset['cases']]}


class FakeModel:
    def __init__(self):
        self.calls = 0

    async def call(self, messages, tools):
        from langchain_core.messages import AIMessage, ToolMessage
        self.calls += 1
        if self.calls == 1:
            return AIMessage(content='', tool_calls=[{'id': 'offline-echo', 'name': 'echo_capability', 'args': {'value': 'synthetic'}}])
        if not isinstance(messages[-1], ToolMessage) or messages[-1].tool_call_id != 'offline-echo':
            raise ValueError('tool_result_not_linked')
        return AIMessage(content='synthetic')


async def evaluate():
    from langchain_core.messages import HumanMessage, ToolMessage
    import langgraph.graph  # Verify the installed graph library without enabling production execution.
    import langchain_openai
    model = FakeModel()
    messages = [HumanMessage(content='synthetic capability check')]
    reply = await model.call(messages, [{'name': 'echo_capability'}])
    messages.extend([reply, ToolMessage(content='synthetic', tool_call_id=reply.tool_calls[0]['id'])])
    final = await model.call(messages, [])
    assert final.content == 'synthetic' and model.calls == 2
    return {'offline': 'passed', 'model_calls': model.calls, 'real_model_tested': False}


if __name__ == '__main__':
    import asyncio
    import json
    print(json.dumps(asyncio.run(evaluate())))
