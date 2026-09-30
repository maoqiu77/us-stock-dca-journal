from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from app.modules.market_board.catalog import InstrumentCatalog, default_instruments
from app.modules.market_board.models import Segment
from app.modules.market_board.store import BoardStore


class Offline:
    def get(self, *args, **kwargs):
        raise TimeoutError('offline fixture')


class LegacySelectionTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = BoardStore(Path(self.directory.name) / 'board.db')
        defaults = default_instruments()
        by_symbol = {item.symbol: item for item in defaults[Segment.ETF]}
        self.legacy = [by_symbol[symbol] for symbol in ('513100', '159501', '510300')]
        self.store.ensure_initialized({Segment.US: [], Segment.ETF: self.legacy, Segment.FUND: []})

    def test_user_removal_from_legacy_seed_survives_catalog_startup(self):
        expected = [self.legacy[0].key, self.legacy[2].key]
        self.store.replace_selection(Segment.ETF, expected, 0)

        InstrumentCatalog(self.store, Offline())

        self.assertEqual([item.key for item in self.store.get_selection(Segment.ETF).items], expected)

    def test_user_reorder_of_legacy_seed_survives_catalog_startup(self):
        expected = [item.key for item in reversed(self.legacy)]
        self.store.replace_selection(Segment.ETF, expected, 0)

        InstrumentCatalog(self.store, Offline())

        self.assertEqual([item.key for item in self.store.get_selection(Segment.ETF).items], expected)

    def test_untouched_legacy_seed_expands_once(self):
        catalog = InstrumentCatalog(self.store, Offline())

        self.assertEqual(len(self.store.get_selection(Segment.ETF).items), len(catalog.defaults[Segment.ETF]))
        self.assertEqual(self.store.get_selection(Segment.ETF).revision, 1)
        InstrumentCatalog(self.store, Offline())
        self.assertEqual(self.store.get_selection(Segment.ETF).revision, 1)

    def test_verified_amex_us_etf_search_uses_arcx_identity(self):
        class SearchHttp:
            def get(self, *args, **kwargs):
                return json.dumps({'QuotationCodeTable': {'Data': [{
                    'Classify': 'UsStock', 'TypeUS': '5', 'JYS': 'AMEX',
                    'MktNum': '107', 'Code': 'XLK', 'QuoteID': '107.XLK',
                    'Name': '科技行业ETF',
                }]}}).encode()
        catalog = InstrumentCatalog(self.store, SearchHttp())

        result = catalog.search('XLK', 'US', 'ETF')

        self.assertEqual([item.key for item in result], ['US:ARCX:XLK:ETF'])
