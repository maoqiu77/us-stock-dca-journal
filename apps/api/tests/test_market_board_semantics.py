import unittest
from datetime import datetime, timedelta, timezone
from pydantic import ValidationError
from app.modules.market_board.models import ObservationMeta, PurchaseLimit, Quote
from app.modules.market_board.metrics import premium_percentile, shares_delta
from app.modules.market_board.providers.fund_parsers import parse_amount, parse_purchase_state, parse_nav_trend, parse_holdings
import json

NOW = datetime(2026, 9, 29, 10, tzinfo=timezone.utc)

class SemanticsTest(unittest.TestCase):
    def test_limit_amount_preserves_integer_zeros(self):
        self.assertEqual(parse_amount('单日限额1.5万元'), '15000')
        self.assertEqual(parse_amount('1000元'), '1000')
        self.assertEqual(parse_purchase_state('开放申购'), ('unknown', None))
        self.assertEqual(parse_purchase_state('基金016701，净值2.2'), ('unknown', None))
        self.assertEqual(parse_purchase_state('暂停申购'), ('suspended', None))
        self.assertEqual(parse_purchase_state('申购不限额'), ('unlimited', None))

    def test_nav_uses_shanghai_date_and_latest_valid_entry(self):
        stamp = datetime(2026, 9, 27, 16, tzinfo=timezone.utc).timestamp() * 1000
        text = 'var Data_netWorthTrend = ' + json.dumps([{'x': stamp, 'y': 2.2}, {'x': stamp - 86400000, 'y': 2.1}]) + ';'
        self.assertEqual(parse_nav_trend(text, NOW)['date'], '2026-09-28')

    def test_percentile_requires_unique_complete_real_final_dates(self):
        dates = [(NOW.date() - timedelta(days=59-i)).isoformat() for i in range(60)]
        rows = [dict(trade_date=d, premium=str(i), basis='vendor:v1', is_final=True, status='available') for i,d in enumerate(dates)]
        self.assertEqual(premium_percentile(rows, dates, '29', 'vendor:v1'), ('50', 60))
        self.assertEqual(premium_percentile(rows[:-1]+[rows[0]], dates, '29', 'vendor:v1')[0], None)
        rows[0]['status'] = 'sample'
        self.assertEqual(premium_percentile(rows, dates, '29', 'vendor:v1'), (None, 59))
        self.assertEqual(premium_percentile([], dates[:59], '0', 'vendor:v1'), (None, 0))
        self.assertIsNone(shares_delta((dates[2], '120'), (dates[0], '100'), dates))
        self.assertEqual(shares_delta((dates[2], '120'), (dates[1], '100'), dates), '20')

    def test_invalid_states_and_missing_prices_rejected(self):
        meta = ObservationMeta(source='fixture', fetched_at=NOW, status='missing')
        with self.assertRaises(ValidationError):
            Quote(instrument_key='US:XNAS:AAPL:STOCK', price='12', meta=meta)
        with self.assertRaises(ValidationError):
            PurchaseLimit(state='open', meta=meta)
        with self.assertRaises(ValidationError):
            ObservationMeta(source='fixture', fetched_at=NOW, as_of=datetime.now(timezone.utc)+timedelta(days=1))

    def test_holdings_headers_not_positions(self):
        html = '<div class="boxitem"><h4>2026-06-30</h4><div><table><tr><th>序号</th><th>股票名称</th><th>占净值比例</th><th>股票代码</th></tr><tr><td>1</td><td>苹果</td><td>8.20%</td><td>AAPL</td></tr></table></div></div>'
        result = parse_holdings(html, NOW, 'CN:FUND:016701:FUND')
        self.assertEqual(result['stocks'][0]['symbol'], 'AAPL')
        self.assertEqual(result['stocks'][0]['name'], '苹果')
        production_html=html.replace('class="boxitem"', 'class="boxitem w790"').replace('<table>', '<div class="space0"></div><table>')
        self.assertEqual(parse_holdings(production_html,NOW,'CN:FUND:016701:FUND')['stocks'],result['stocks'])
