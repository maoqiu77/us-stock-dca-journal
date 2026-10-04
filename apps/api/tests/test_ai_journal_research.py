from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock

from app.modules.ai_journal.agent.analytics import technicals, relative_performance
from app.modules.ai_journal.agent.contracts import EvidenceBook
from app.modules.ai_journal.agent.research import PublicResearch, extract_article
from app.modules.ai_journal.agent.research_plan import research_plan
from app.modules.ai_journal.agent.runtime import Budget, ToolExecutor
from app.modules.ai_journal.agent.tools import make_tools
from app.modules.ai_journal.agent.model import runtime_available
from app.modules.market_board.http import PublicHttp
from app.modules.market_board.models import Instrument

KEY = 'US:XNAS:NVDA:STOCK'
NOW = datetime.now(timezone.utc) - timedelta(minutes=1)


def article(**changes):
    return {'instrument_key': KEY, 'title': 'NVIDIA earnings', 'url': 'https://finance.yahoo.com/news/fixture.html',
        'publisher': 'Fixture', 'published_at': NOW.isoformat(), 'fetched_at': NOW.isoformat(),
        'reading_scope': 'headline_only', **changes}


def series(key=KEY, scale=1):
    return {'instrument_key': key, 'currency': 'USD', 'period': '1d', 'range': '3mo',
        'timezone': 'America/New_York', 'adjustment': 'split_adjusted',
        'meta': {'source': 'fixture', 'status': 'available', 'as_of': NOW.isoformat(), 'fetched_at': NOW.isoformat()},
        'bars': [{'time': (NOW - timedelta(days=21-i)).isoformat(), 'open': str((100+i)*scale),
            'high': str((102+i)*scale), 'low': str((98+i)*scale), 'close': str((100+i)*scale),
            'volume': 200 if i == 20 else 100, 'is_final': True} for i in range(21)]}


class ResearchDataTest(unittest.TestCase):
    def test_time_horizon_and_followup(self):
        short = research_plan('SMCI明后天继续上涨？结合财报看看')
        self.assertEqual(short['horizon'], 'short_term')
        self.assertTrue(short['secondary_fundamentals'])
        self.assertEqual(research_plan('再查订单是否持续', short)['horizon'], 'short_term')
        self.assertEqual(research_plan('准备长期持有一年', short)['horizon'], 'long_term')
        self.assertEqual(research_plan('未来几周做波段')['horizon'], 'swing')

    def test_volume_returns_and_comparison_are_computed_from_observations(self):
        result = technicals(series())
        self.assertEqual(Decimal(result['volume_ratio_vs_previous_20']), 2)
        self.assertEqual(Decimal(result['close_position_in_day_range']), Decimal('.5'))
        self.assertAlmostEqual(float(result['return_5d_pct']), (120/115-1)*100)
        relative = relative_performance(series(), series('US:ARCX:SPY:ETF', 2))
        self.assertEqual([row['observations'] for row in relative['windows']], [1, 5, 20])
        self.assertTrue(all(Decimal(row['excess_percentage_points']) == 0 for row in relative['windows']))
        missing = series()
        missing['bars'][0]['volume'] = None
        self.assertIsNone(technicals(missing)['volume_ratio_vs_previous_20'])

    def test_comparison_rejects_mismatched_basis_and_latest_dates(self):
        for field, value in [('currency', 'CNY'), ('adjustment', 'unadjusted'), ('period', '60m')]:
            other = series()
            other[field] = value
            with self.assertRaises(ValueError):
                relative_performance(series(), other)
        other = series()
        other['bars'].pop()
        with self.assertRaises(ValueError):
            relative_performance(series(), other)

    def test_excerpts_prefer_article_body_and_preserve_text(self):
        body = '\n'.join(f'Revenue grew in quarter {i}, while gross margin contracted due to product mix.' for i in range(45))
        raw = ('<html><body><nav>not evidence</nav><script type="application/ld+json">' +
            json.dumps({'@graph': [{'articleBody': body}]}) + '</script><main>' + 'navigation noise '*900 + '</main></body></html>').encode()
        result = extract_article(raw, 'margins')
        self.assertEqual(result['reading_scope'], 'excerpts')
        self.assertGreater(result['extracted_characters'], result['returned_characters'])
        self.assertLessEqual(result['returned_characters'], 2600)
        self.assertTrue(all(text in body for text in result['excerpts']))

    def test_html_and_filing_tables_and_unreadable_pages(self):
        body = ''.join(f'<p>Revenue statement {i}: sales increased with stronger customer orders.</p>' for i in range(10))
        result = extract_article(('<html><body><article>' + body + '</article></body></html>').encode(), 'orders')
        self.assertIn('customer orders', ' '.join(result['excerpts']))
        filing = extract_article(('<html><body>' + body + '<table><tr><td>Revenue</td><td>100</td></tr></table></body></html>').encode(), 'earnings', filing=True)
        self.assertIn('Revenue | 100', ' '.join(filing['excerpts']))
        for raw in (b'<body>Enable JavaScript</body>', b'<article>Subscribe to read</article>', b'%PDF-1.7 unsupported'):
            with self.assertRaises(ValueError):
                extract_article(raw, 'earnings')

    def provider(self):
        item = Instrument(key=KEY, symbol='NVDA', name='NVIDIA', market='US', exchange='XNAS',
            asset_type='STOCK', currency='USD', timezone='America/New_York')
        http = SimpleNamespace(get=Mock())
        board = SimpleNamespace(catalog=SimpleNamespace(resolve=lambda key: item if key == KEY else None), http=http)
        return PublicResearch(board, document_http=SimpleNamespace(get=Mock())), http

    def test_targeted_search_filters_dates_duplicates_and_sends_only_public_query(self):
        research, http = self.provider()
        row = {'title': 'NVIDIA earnings', 'link': article()['url'], 'publisher': 'Fixture',
               'relatedTickers': ['NVDA'], 'providerPublishTime': NOW.timestamp()}
        future = {**row, 'title': 'NVIDIA future', 'providerPublishTime': (NOW + timedelta(days=1)).timestamp()}
        bad_port = {**row, 'title': 'NVIDIA malformed URL', 'link': 'https://finance.yahoo.com:invalid/story'}
        http.get.side_effect = [json.dumps({'news': [row, row, future, bad_port]}).encode(), b'<rss><channel/></rss>']
        result = research.search(KEY, 'margins')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['reading_scope'], 'headline_only')
        self.assertIn('gross+margin+profitability', http.get.call_args_list[-1].args[0])
        self.assertNotIn(KEY, http.get.call_args_list[-1].args[0])

    def test_search_uses_verified_english_company_name_for_rss_relevance(self):
        research, http = self.provider()
        date = NOW.strftime('%a, %d %b %Y %H:%M:%S GMT')
        http.get.side_effect = [json.dumps({'quotes': [{'symbol': 'NVDA', 'longname': 'NVIDIA Corporation'}], 'news': []}).encode(),
            f'<rss><channel><item><title>NVIDIA reports gross margin</title><link>https://finance.yahoo.com/news/result</link><source>Fixture</source><pubDate>{date}</pubDate></item></channel></rss>'.encode()]
        self.assertEqual(research.search(KEY, 'margins')[0]['relevance'], 0.95)

    def test_sources_fail_closed_without_claiming_to_read(self):
        research, http = self.provider()
        http.get.side_effect = TimeoutError()
        self.assertEqual(research.search(KEY, 'earnings'), [])
        self.assertEqual(research.read(article(url='https://127.0.0.1/private'), 'earnings')['status'], 'unavailable')
        research.documents.get.assert_not_called()
        research.documents.get.side_effect = TimeoutError()
        self.assertEqual(research.read(article(), 'earnings')['status'], 'unavailable')
        self.assertEqual(research.filings(KEY), [])
        http_client = PublicHttp(requester=Mock(), allowed_hosts={'finance.yahoo.com'})
        for url in ('https://finance.yahoo.com@localhost/test', 'https://finance.yahoo.com:8000/test', 'http://finance.yahoo.com/test'):
            with self.assertRaises(ValueError):
                http_client.get(url)
        http_client.requester.assert_not_called()

    def test_filings_have_exact_acceptance_time_and_are_only_metadata(self):
        research, _ = self.provider()
        research.documents.get.side_effect = [json.dumps({'fields': ['cik', 'ticker'], 'data': [[1045810, 'NVDA']]}).encode(),
            json.dumps({'filings': {'recent': {'form': ['10-Q'], 'acceptanceDateTime': [NOW.isoformat()],
                'accessionNumber': ['0001-26-0001'], 'primaryDocument': ['nvda.htm'], 'filingDate': [NOW.date().isoformat()]}}}).encode()]
        rows = research.filings(KEY)
        self.assertEqual(rows[0]['reading_scope'], 'filing_metadata_only')
        self.assertEqual(rows[0]['published_at'], NOW.isoformat())
        self.assertEqual(rows[0]['url'], 'https://www.sec.gov/Archives/edgar/data/1045810/0001260001/nvda.htm')


@unittest.skipUnless(runtime_available(), 'optional Python 3.12 Agent environment required')
class ResearchToolTest(unittest.IsolatedAsyncioTestCase):
    def runtime(self):
        research = SimpleNamespace(search=Mock(return_value=[article()]),
            read=Mock(side_effect=lambda payload, focus: {**payload, 'status': 'available', 'reading_scope': 'excerpts',
                'excerpts': ['Margin declined; investigate guidance.'], 'fetched_at': NOW.isoformat()}),
            filings=Mock(return_value=[]))
        scope = {'positions': False, 'plans': False, 'memory': False, 'instrument_keys': [KEY],
                 'periods_by_key': {KEY: ['1d']}, 'public_research': True}
        async def empty(*args):
            return []
        book = EvidenceBook()
        budget = Budget(max_model_calls=7, max_tool_calls=14, max_external_tools=8, max_input_bytes=56000, max_reserved_units=420000)
        specs = make_tools(book=book, scope=scope, read_private=empty, read_market=empty, read_series=empty,
            search_memory=empty, research=research)
        return research, book, budget, ToolExecutor(specs, book, budget, lambda: None)

    async def test_search_read_followup_search_read_graph(self):
        from langchain_core.messages import AIMessage
        from app.modules.ai_journal.agent.graph import build_graph
        research, book, budget, executor = self.runtime()
        calls = []
        async def model(messages, tools):
            calls.append(1)
            step = len(calls)
            if step in (1, 3):
                name, args = 'search_public_news', {'instrument_key': KEY, 'topic': 'earnings' if step == 1 else 'guidance'}
            elif step in (2, 4):
                data = json.loads(messages[-1].content)['data']
                name, args = 'read_research_document', {'source_id': data['items'][0]['source_id'], 'focus': 'margins' if step == 2 else 'guidance'}
            else:
                source_id = json.loads(messages[-1].content)['data']['source_id']
                return AIMessage(content=json.dumps({'summary': '需要观察利润率能否改善', 'stance': 'observe',
                    'facts': [{'text': '已核实原文片段', 'source_ids': [source_id]}], 'interpretations': [], 'risks': [], 'missing': [], 'next_questions': []}))
            return AIMessage(content='', tool_calls=[{'id': f'call-{step}', 'name': name, 'args': args}])
        result = await build_graph(model_call=model, executor=executor, book=book, budget=budget,
            check_access=lambda: None).ainvoke({'messages': [], 'result': None, 'repair_count': 0, 'stop_code': ''})
        self.assertEqual(result['stop_code'], 'completed')
        self.assertEqual(research.search.call_args_list[-1].args, (KEY, 'guidance'))
        self.assertEqual(research.read.call_count, 2)
        self.assertEqual(budget.model_calls, 5)
        self.assertEqual([row.kind for row in book.rows.values()], ['news', 'document', 'document'])
        self.assertTrue(all(row.classification == 'observed' for row in book.rows.values()))

    async def test_unobserved_out_of_scope_future_sources_are_rejected(self):
        research, book, _, executor = self.runtime()
        for name, args in [('read_research_document', {'source_id': 'forged'}),
                           ('search_public_news', {'instrument_key': 'US:XNAS:TSLA:STOCK'})]:
            self.assertFalse(json.loads(await executor.invoke({'name': name, 'args': args}))['ok'])
        research.read.assert_not_called()
        research.search.assert_not_called()
        research.search.return_value = [article(published_at=(NOW+timedelta(days=1)).isoformat())]
        self.assertFalse(json.loads(await executor.invoke({'name': 'search_public_news', 'args': {'instrument_key': KEY}}))['ok'])
        self.assertFalse(book.rows)

    async def test_unavailable_read_adds_no_evidence_and_uses_bounded_retry_cache(self):
        research, book, _, executor = self.runtime()
        result = json.loads(await executor.invoke({'name': 'search_public_news', 'args': {'instrument_key': KEY}}))
        source_id = result['data']['items'][0]['source_id']
        research.read.return_value = None
        research.read.side_effect = lambda *args: {'status': 'unavailable', 'reason': 'fixture'}
        request = {'name': 'read_research_document', 'args': {'source_id': source_id}}
        read = json.loads(await executor.invoke(request))
        self.assertEqual(read['data']['status'], 'unavailable')
        self.assertEqual(len(book.rows), 1)
        await executor.invoke(request)
        self.assertEqual(research.read.call_count, 1)
