from __future__ import annotations

import copy
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

from app.modules.ai_journal.agent.evaluation import comparison_template, evaluate_retrieval

DATASET = Path(__file__).resolve().parents[3] / 'storage/templates/ai-journal-agent-evaluation.json'
HELDOUT_DATASET = Path(__file__).resolve().parents[3] / 'storage/templates/ai-journal-agent-phase7-heldout.json'


class RetrievalEvaluationTest(unittest.TestCase):
    def setUp(self):
        self.dataset = json.loads(DATASET.read_text(encoding='utf-8'))

    def test_labeled_corpus_through_candidates_frozen_scope_and_retrieval(self):
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            result = evaluate_retrieval(self.dataset)
        self.assertGreaterEqual(result['positive_case_count'], 30)
        self.assertGreaterEqual(result['recall_at_5'], .85)
        self.assertTrue(result['passed'])
        self.assertTrue(all(row['forbidden_sources_absent'] for row in result['cases']))
        self.assertEqual(sum(row['empty_result_passed'] is True for row in result['cases']), 6)
        self.assertFalse(result['real_model_tested'])
        self.assertEqual(result['semantic_entailment'], 'not_evaluated')

    def test_additional_corpus_passes_without_retrieval_tuning_or_network(self):
        dataset = json.loads(DATASET.with_name('ai-journal-agent-closeout-retrieval.json').read_text())
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            result = evaluate_retrieval(dataset)
        self.assertEqual(result['case_count'], 20)
        self.assertEqual(result['positive_case_count'], 14)
        self.assertGreaterEqual(result['recall_at_5'], .85)
        self.assertTrue(result['passed'])
        self.assertFalse(result['real_model_tested'])
        self.assertEqual(result['semantic_entailment'], 'not_evaluated')

    def test_phase7_heldout_corpus_is_independent_and_passes_offline(self):
        dataset = json.loads(HELDOUT_DATASET.read_text())
        baseline = json.loads(DATASET.read_text())
        baseline_ids = {row['id'] for row in baseline['originals']}
        heldout_ids = {row['id'] for row in dataset['originals']}
        self.assertTrue(heldout_ids.isdisjoint(baseline_ids))
        self.assertEqual(dataset['split'], 'phase7-heldout')
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            result = evaluate_retrieval(dataset)
        self.assertEqual(result['case_count'], 22)
        self.assertEqual(result['positive_case_count'], 17)
        self.assertGreaterEqual(result['recall_at_5'], .85)
        self.assertTrue(result['passed'])
        self.assertFalse(result['real_model_tested'])
        self.assertEqual(result['semantic_entailment'], 'not_evaluated')
        self.assertEqual(sum(row['empty_result_passed'] is True for row in result['cases']), 5)

    def test_expanded_holdout_has_fresh_sources_and_balanced_risk_categories(self):
        from collections import Counter
        dataset = json.loads(DATASET.with_name('ai-journal-agent-expanded-holdout.json').read_text())
        previous = [self.dataset, json.loads(HELDOUT_DATASET.read_text()),
            json.loads(DATASET.with_name('ai-journal-agent-release-semantic-v2.json').read_text())]
        old_ids = {row['id'] for corpus in previous for row in corpus['originals']}
        old_text = {row['text'] for corpus in previous for row in corpus['originals']}
        self.assertTrue(all(row['id'] not in old_ids and row['text'] not in old_text for row in dataset['originals']))
        self.assertEqual(Counter(case['category'] for case in dataset['cases']),
            {category: 5 for category in {case['category'] for case in dataset['cases']}})
        self.assertEqual(len(dataset['cases']), 60)
        self.assertEqual(len({case['category'] for case in dataset['cases']}), 12)
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')):
            result = evaluate_retrieval(dataset)
        self.assertTrue(result['passed'])
        self.assertGreaterEqual(result['recall_at_5'], .85)
        self.assertEqual(result['positive_case_count'], 50)
        self.assertEqual(sum(row['empty_result_passed'] is True for row in result['cases']), 10)

    def test_phase7_paired_template_keeps_identical_frozen_inputs_and_unknown_outputs(self):
        dataset = json.loads(HELDOUT_DATASET.read_text())
        result = comparison_template(dataset)
        self.assertEqual(result['status'], 'awaiting_paired_outputs_and_review')
        self.assertFalse(result['real_model_tested'])
        self.assertEqual(len(result['cases']), 22)
        for row in result['cases']:
            with self.subTest(case=row['id']):
                fixed_ids = {original['id'] for original in row['fixed_input']['originals']}
                self.assertTrue(set(row['expected_original_ids']).issubset(fixed_ids))
                self.assertEqual(row['fixed_input']['positions'], [])
                self.assertEqual(row['fixed_input']['market_observations'], [])
                for engine in row['engines'].values():
                    self.assertTrue(all(value is None for value in engine.values()))

    def test_missing_labeled_original_lowers_score_instead_of_passing(self):
        dataset = copy.deepcopy(self.dataset)
        dataset['cases'] = [dataset['cases'][0]]
        for row in dataset['originals']:
            if row['id'] in dataset['cases'][0]['expected_original_ids']:
                row['text'] = 'ZXQUNRELATED'
                if row['kind'] == 'trade_reason': row['ticker'] = 'ZXQUNRELATED'
        result = evaluate_retrieval(dataset)
        self.assertEqual(result['recall_at_5'], 0)
        self.assertFalse(result['passed'])

    def test_invalid_labels_and_nonsynthetic_datasets_rejected(self):
        for change in ('non_synthetic', 'duplicate_case', 'unknown_label'):
            dataset = copy.deepcopy(self.dataset)
            if change == 'non_synthetic': dataset['synthetic'] = False
            elif change == 'duplicate_case': dataset['cases'].append(dataset['cases'][0])
            else: dataset['cases'][0]['expected_original_ids'] = ['not-in-corpus']
            with self.subTest(change=change), self.assertRaises(ValueError):
                evaluate_retrieval(dataset)

    def test_paired_review_never_invents_answers_semantic_scores_cost_or_latency(self):
        result = comparison_template(self.dataset)
        self.assertEqual(result['status'], 'awaiting_paired_outputs_and_review')
        for row in result['cases']:
            self.assertEqual(set(row['engines']), {'legacy_llm', 'agent'})
            self.assertTrue(set(row['expected_original_ids']).issubset(
                {original['id'] for original in row['fixed_input']['originals']}))
            for engine in row['engines'].values():
                self.assertTrue(all(value is None for value in engine.values()))
        excluded = next(row for row in result['cases'] if row['id'] == 'excluded')
        self.assertEqual(excluded['fixed_input']['originals'], [])
