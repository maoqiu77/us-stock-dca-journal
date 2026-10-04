from __future__ import annotations

import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from app.modules.ai_journal.news import news_facts
from app.modules.ai_journal.agent.adapters import frozen_ports
from app.modules.ai_journal.agent.contracts import EvidenceBook
from app.modules.ai_journal.agent.scope import build_scope
from app.modules.ai_journal.agent.tools import make_tools
from app.modules.ai_journal.agent.runtime import Budget, ToolExecutor
from app.modules.ai_journal.agent.model import runtime_available
from app.modules.ai_journal.models import PreviewRequest
from app.modules.market_board.models import Instrument

NOW = datetime(2026, 10, 2, 10, tzinfo=timezone.utc)
KEY = 'US:XNAS:NVDA:STOCK'


class NewsTest(unittest.TestCase):
    def setUp(self):
        self.item = Instrument(key=KEY, symbol='NVDA', name='NVIDIA', market='US',
            exchange='XNAS', asset_type='STOCK', currency='USD', timezone='America/New_York', verified_at=NOW)
        self.http = SimpleNamespace(get=Mock())
        self.board = SimpleNamespace(catalog=SimpleNamespace(resolve=lambda key: self.item), http=self.http)

    def article(self, **updates):
        return {'title': 'NVIDIA announces event', 'publisher': 'Test newsroom',
            'link': 'https://example.org/news/1', 'relatedTickers': ['NVDA'],
            'providerPublishTime': int((NOW - timedelta(hours=1)).timestamp()), **updates}

    def test_news_rejects_old_future_unrelated_and_unsafe_links_and_deduplicates(self):
        self.http.get.return_value = json.dumps({'news': [self.article(), self.article(),
            self.article(title='old', providerPublishTime=int((NOW - timedelta(days=8)).timestamp())),
            self.article(title='future', providerPublishTime=int((NOW + timedelta(hours=1)).timestamp())),
            self.article(title='other', relatedTickers=['AAPL']),
            self.article(title='bad link', link='javascript:alert(1)')]}).encode()
        facts, missing = news_facts(self.board, KEY, NOW)
        self.assertEqual(len(facts), 1)
        self.assertEqual(missing, [])
        self.assertEqual(facts[0]['value']['reading_scope'], 'headline_only')
        self.assertEqual(facts[0]['value']['publisher'], 'Test newsroom')

    def test_fallback_retains_publisher_date_and_reading_scope(self):
        rss = b'''<rss><channel><item><title>NVDA event</title><link>https://example.org/news/2</link>
          <source>Test newsroom</source><pubDate>Fri, 02 Oct 2026 09:00:00 GMT</pubDate>
          <description>Unverified body must not be passed as full article</description></item></channel></rss>'''
        self.http.get.side_effect = [TimeoutError(), rss]
        facts, missing = news_facts(self.board, KEY, NOW)
        self.assertEqual(missing, [])
        self.assertEqual(facts[0]['value']['meta']['source'], 'Google News')
        self.assertEqual(facts[0]['value']['summary'], '')
        self.assertEqual(self.http.get.call_count, 2)

    def test_direct_company_headlines_take_priority_over_generic_ticker_tags(self):
        general = [self.article(title=f'Market roundup {index}') for index in range(6)]
        direct = self.article(title='Nvidia announces event', providerPublishTime=int((NOW - timedelta(days=1)).timestamp()))
        self.http.get.return_value = json.dumps({'news': [{'providerPublishTime': 'bad'}, *general, direct]}).encode()
        facts, _ = news_facts(self.board, KEY, NOW)
        self.assertEqual(len(facts), 5)
        self.assertEqual(facts[0]['value']['title'], 'Nvidia announces event')
        self.assertEqual(facts[0]['value']['relevance'], 'direct_mention')

    def test_outage_is_explicit_and_does_not_synthesize_news(self):
        self.http.get.side_effect = TimeoutError()
        facts, missing = news_facts(self.board, KEY, NOW)
        self.assertEqual(facts, [])
        self.assertIn('不代表没有新闻', missing[0])

    @unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
    def test_news_is_observed_evidence_only_after_tool_read_and_cannot_be_price(self):
        self.http.get.return_value = json.dumps({'news': [self.article()]}).encode()
        facts, _ = news_facts(self.board, KEY, NOW)
        request = PreviewRequest(task_type='conversation', question='新闻', instrument_key=KEY)
        scope, rows = build_scope(self.board, request, {}, facts, NOW)
        self.assertEqual(rows[0]['kind'], 'news')
        self.assertEqual(rows[0]['classification'], 'observed')
        book = EvidenceBook()
        executor = ToolExecutor(make_tools(book=book, scope=scope, **frozen_ports(
            {'agent_scope': scope, 'agent_sources': rows}, lambda: None)), book, Budget(), lambda: None)

        async def run():
            quotes = json.loads(await executor.invoke({'name': 'get_market_facts', 'args': {'instrument_key': KEY}}))
            self.assertEqual(quotes['data']['status'], 'unavailable')
            self.assertEqual(book.rows, {})
            news = json.loads(await executor.invoke({'name': 'get_news_and_fundamentals', 'args': {'instrument_key': KEY}}))
            self.assertEqual(news['data']['status'], 'available')
            self.assertEqual(news['data']['fundamentals_status'], 'unavailable')
            self.assertIn(news['data']['articles'][0]['source_id'], book.rows)
            blocked = json.loads(await executor.invoke({'name': 'get_news_and_fundamentals', 'args': {'instrument_key': 'US:XNAS:AAPL:STOCK'}}))
            self.assertFalse(blocked['ok'])
        asyncio.run(run())
