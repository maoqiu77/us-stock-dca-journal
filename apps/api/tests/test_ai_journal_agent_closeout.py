from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import sys
import unittest

from app.modules.ai_journal.agent.analytics import portfolio_exposure, technicals
from app.modules.ai_journal.agent.contracts import EvidenceBook, Report, make_evidence


STAMP = datetime(2026, 9, 28, 20, tzinfo=timezone.utc)


def position(symbol, currency, quantity, cost):
    key = f'US:XNAS:{symbol}:STOCK' if currency == 'USD' else f'CN:XSHG:{symbol}:ETF'
    return make_evidence('position', 'position:' + key, '1', {
        'instrument_key': key, 'currency': currency, 'quantity': quantity, 'cost': cost}, STAMP, STAMP)


def quote(row, price, *, currency=None, fact_kind='交易报价'):
    key = row.payload['instrument_key']
    return make_evidence('quote', 'quote:' + key, '1', {
        'instrument_key': key, 'currency': currency or row.payload['currency'], 'price': price,
        'fact_kind': fact_kind, 'meta': {'status': 'available', 'as_of': STAMP.isoformat()}}, STAMP, STAMP)


class CloseoutNumericalTests(unittest.TestCase):
    def test_fractional_and_zero_cost_cases_keep_exact_observed_units(self):
        cases = [('3.5', '7.24', '11.5', '25.34', '40.25'),
                 ('0.125', '19.2', '20', '2.4', '2.5'),
                 ('0.000001', '125', '150', '0.000125', '0.000150'),
                 ('2', '0', '7.5', '0', '15')]
        for shares, cost, price, total_cost, market_value in cases:
            with self.subTest(shares=shares, cost=cost):
                row = position('MSFT', 'USD', shares, cost)
                result = portfolio_exposure([row], [quote(row, price)])
                group = result['groups'][0]
                self.assertEqual(Decimal(group['holding_cost']), Decimal(total_cost))
                self.assertEqual(Decimal(group['market_value']), Decimal(market_value))
                self.assertEqual(Decimal(group['positions'][0]['weight_within_currency']), 1)
                self.assertIsNone(result['cash'])
                self.assertIsNone(result['total_across_currencies'])

    def test_missing_quote_only_invalidates_its_currency_group(self):
        a = position('AAPL', 'USD', '2', '3')
        b = position('MSFT', 'USD', '1', '5')
        c = position('510300', 'CNY', '10', '2')
        result = portfolio_exposure([a, b, c], [quote(a, '10'), quote(c, '4')])
        groups = {row['currency']: row for row in result['groups']}
        self.assertIsNone(groups['USD']['market_value'])
        self.assertEqual(groups['USD']['holding_cost'], '11')
        self.assertTrue(all(row['weight_within_currency'] is None for row in groups['USD']['positions']))
        self.assertEqual(groups['USD']['positions'][0]['market_value'], '20')
        self.assertEqual(groups['CNY']['market_value'], '40')
        self.assertEqual(groups['CNY']['positions'][0]['weight_within_currency'], '1')
        self.assertIsNone(result['total_across_currencies'])

    def test_multiple_positions_have_observed_currency_denominator(self):
        a = position('AAPL', 'USD', '1.5', '4')
        b = position('MSFT', 'USD', '2.5', '6')
        result = portfolio_exposure([a, b], [quote(a, '20'), quote(b, '12')])
        group = result['groups'][0]
        self.assertEqual(group['market_value'], '60.0')
        self.assertEqual(group['holding_cost'], '21.0')
        self.assertEqual([row['weight_within_currency'] for row in group['positions']], ['0.5', '0.5'])

    def test_wrong_or_unknown_quote_currency_cannot_create_valuation(self):
        row = position('MSFT', 'USD', '3.5', '7.24')
        for currency in ('CNY', None):
            source = quote(row, '11.5', currency='CNY')
            if currency is None:
                payload = {key: value for key, value in source.payload.items() if key != 'currency'}
                source = make_evidence('quote', source.entity_id, '1', payload, STAMP, STAMP)
            with self.subTest(currency=currency), self.assertRaises(ValueError):
                portfolio_exposure([row], [source])

    def test_nav_is_not_a_transaction_quote(self):
        row = position('510300', 'CNY', '10', '2')
        with self.assertRaises(ValueError):
            portfolio_exposure([row], [quote(row, '4', fact_kind='正式净值（非盘中价格）')])

    def test_ma_boundary_counts_and_nonfinal_bar_cutoff(self):
        cases = [(4, None, None, None), (5, '3', None, None), (19, '17', None, None),
                 (20, '18', '10.5', None), (59, '57', '49.5', None),
                 (60, '58', '50.5', '30.5'), (61, '59', '51.5', '31.5')]
        for count, ma5, ma20, ma60 in cases:
            payload = {'instrument_key': 'US:XNAS:MSFT:STOCK', 'period': '1d', 'range': '3mo',
                'currency': 'USD', 'timezone': 'America/New_York', 'adjustment': 'split_adjusted',
                'meta': {'source': 'synthetic-closeout', 'status': 'available', 'as_of': STAMP.isoformat(), 'fetched_at': STAMP.isoformat()},
                'bars': [{'time': (STAMP - timedelta(days=count - i)).isoformat(), 'open': str(i+1),
                    'close': str(i+1), 'high': str(i+2), 'low': str(i+.5), 'is_final': True} for i in range(count)]}
            payload['bars'].append({'time': STAMP.isoformat(), 'open': '999', 'close': '999',
                'high': '1000', 'low': '998', 'is_final': False})
            with self.subTest(count=count):
                result = technicals(payload)
                self.assertEqual((result['ma5'], result['ma20'], result['ma60']), (ma5, ma20, ma60))
                self.assertEqual(result['bar_count'], count)
                self.assertEqual(datetime.fromisoformat(result['as_of']), STAMP - timedelta(days=1))

    def test_structural_citation_acceptance_does_not_establish_semantics(self):
        row = position('MSFT', 'USD', '3.5', '7.24')
        book = EvidenceBook()
        book.add_batch([row], STAMP)
        report = Report(summary='synthetic unsupported claim', stance='observe',
            facts=[{'text': '云续费已经增长50%。', 'source_ids': [row.id]}],
            interpretations=[], risks=[], missing=[], next_questions=[])
        self.assertEqual(book.validate_report(report.model_dump_json()), report)
        self.assertNotIn('renewal', row.payload)

    @unittest.skipUnless(sys.version_info >= (3, 12), 'Agent runtime requires Python 3.12')
    def test_tool_currency_rejection_creates_no_calculation_evidence(self):
        from app.modules.ai_journal.agent.adapters import frozen_ports
        from app.modules.ai_journal.agent.runtime import Budget, ToolExecutor
        from app.modules.ai_journal.agent.tools import make_tools
        row = position('MSFT', 'USD', '3.5', '7.24')
        wrong = quote(row, '11.5', currency='CNY')
        scope = {'positions': True, 'plans': False, 'memory': False, 'memory_source_ids': [],
            'instrument_keys': [row.payload['instrument_key']], 'periods_by_key': {}, 'refresh_market': False}
        snapshot = {'agent_scope': scope, 'agent_sources': [source.model_dump(mode='json') for source in (row, wrong)]}
        book = EvidenceBook()
        executor = ToolExecutor(make_tools(book=book, scope=scope, **frozen_ports(snapshot, lambda: None)),
            book, Budget(), lambda: None)
        async def run():
            await executor.invoke({'name': 'read_portfolio_snapshot', 'args': {}})
            await executor.invoke({'name': 'get_market_facts', 'args': {'instrument_key': row.payload['instrument_key']}})
            return await executor.invoke({'name': 'calculate_portfolio_exposure', 'args': {
                'position_source_ids': [row.id], 'quote_source_ids': [wrong.id]}})
        import json
        result = json.loads(asyncio.run(run()))
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'tool_unavailable_or_invalid')
        self.assertTrue(all(source.kind != 'calculation' for source in book.rows.values()))
