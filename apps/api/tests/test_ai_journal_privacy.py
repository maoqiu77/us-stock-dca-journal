import unittest
from pydantic import ValidationError
from app.modules.ai_journal.models import PreviewRequest
from app.modules.ai_journal.prompts import messages


class AiJournalPrivacyTest(unittest.TestCase):
    def test_contract_rejects_browser_facts_and_conflicting_periods(self):
        with self.assertRaises(ValidationError):
            PreviewRequest(task_type='instrument_research', question='q', instrument_key='US:XNAS:AAPL:STOCK', price=123)  # type: ignore[call-arg]
        with self.assertRaises(ValidationError):
            PreviewRequest(task_type='instrument_research', question='q', instrument_key='US:XNAS:AAPL:STOCK', primary_period='1d', auxiliary_periods=['1d'])

    def test_prompt_contains_only_explicit_private_context(self):
        payload = {'request': {'question': 'q'}, 'instrument': None, 'facts': [], 'private_context': {}, 'missing': [], 'model': {}, 'created_at': 'x', 'facts_origin': None}
        rendered = messages(payload)[1]['content']
        self.assertNotIn('交易流水', rendered)
        self.assertNotIn('secret', rendered)
