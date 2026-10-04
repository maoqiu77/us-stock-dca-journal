from __future__ import annotations
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch
from app.modules.market_board.store import BoardStore,SelectionConflict
from app.modules.market_board.catalog import InstrumentCatalog
from app.modules.market_board.service import BoardService
from app.modules.market_board.models import Segment,Quote,Nav,PurchaseLimit,ObservationMeta,Instrument,EtfMetrics,SharesObservation
from app.modules.market_board.sample import row_for, series_for

class Offline:
    def get(self,*a,**k): raise TimeoutError('fixture')
class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=BoardStore(Path(self.tmp.name)/'test.db')
        self.catalog=InstrumentCatalog(self.store,Offline())
        self.now=datetime(2026,9,29,10,tzinfo=timezone.utc)
        self.service=BoardService(self.store,self.catalog,lambda:self.now,Offline())
    def test_clear_persists_and_wrong_market_rejected(self):
        cn=self.catalog.defaults[Segment.ETF][0]
        with self.assertRaises(ValueError):self.store.replace_selection(Segment.US,[cn.key],0)
        self.store.replace_selection(Segment.US,[],0)
        self.store.ensure_initialized(self.catalog.defaults)
        with patch.object(self.service.us_provider,'quotes',side_effect=AssertionError('empty board requested supplier')):
            self.assertEqual(self.service.board(Segment.US).rows,[])
        with self.assertRaises(SelectionConflict):self.store.replace_selection(Segment.US,[],0)
    def test_all_31_plus_rows_remain_in_order_when_supplier_fails(self):
        expected=self.store.get_selection(Segment.US).items
        self.assertGreaterEqual(len(expected),31)
        board=self.service.board(Segment.US)
        self.assertEqual([r.instrument.key for r in board.rows],[i.key for i in expected])
        self.assertTrue(all(r.quality=='missing' for r in board.rows))
        self.assertTrue(all(r.quote.meta.status=='missing' and r.quote.price is None for r in board.rows))
        self.assertTrue(all(r.metrics is None for r in board.rows))
    def test_unknown_identity_is_missing_not_fabricated_sample(self):
        item=Instrument(key='US:XNAS:NEW:STOCK',symbol='NEW',name='Fixture',market='US',exchange='XNAS',asset_type='STOCK',currency='USD',timezone='America/New_York')
        self.store.save_instruments([item])
        row=self.service.detail(item.key).row
        self.assertEqual(row.quality,'missing');self.assertIsNone(row.quote.price)
        self.assertEqual(self.service.series(item.key,'1d','1mo').bars,[])
    def test_real_field_cache_survives_independent_failure_and_refresh_respects_nav_ttl(self):
        item=self.catalog.defaults[Segment.FUND][0];calls=[]
        def nav(*args):
            calls.append(1)
            return Nav(value='1.2345',nav_date='2026-09-28',meta=ObservationMeta(source='fixture',fetched_at=self.now))
        with patch.object(self.service.fund_provider,'nav',side_effect=nav):
            row=self.service._row(item)
            self.service._row(item,refresh=True)
        self.assertEqual(len(calls),1);self.assertEqual(row.quality,'available');self.assertEqual(row.purchase_limit.state,'unknown')
        self.now+=timedelta(minutes=16)
        row=self.service._row(item)
        self.assertEqual(row.nav.meta.status,'stale');self.assertEqual(str(row.nav.value),'1.2345')
        self.assertEqual(str(row.nav.nav_date),'2026-09-28')
    def test_supplemental_real_limit_never_combines_with_sample_nav(self):
        item=self.catalog.defaults[Segment.FUND][0]
        limit=PurchaseLimit(state='limited',amount='1000',channel='eastmoney',meta=ObservationMeta(source='fixture',fetched_at=self.now))
        with patch.object(self.service.fund_provider,'purchase_limit',return_value=limit):
            row=self.service._row(item)
        self.assertIsNone(row.nav.value);self.assertEqual(row.nav.meta.status,'missing')
        self.assertEqual(str(row.purchase_limit.amount),'1000')
    def test_missing_never_written_to_premium_history(self):
        row=self.service._row(self.catalog.defaults[Segment.ETF][0])
        self.assertEqual(row.quality,'missing')
        self.assertIsNone(row.metrics.premium_pct)
        self.assertEqual(self.store.read_premiums(row.instrument.key,'vendor_reference','2000-01-01'),[])
    def test_curated_us_chart_is_missing_when_offline(self):
        item=self.catalog.defaults[Segment.US][0]
        series=self.service.series(item.key,'1d','1mo')
        self.assertEqual(series.meta.status,'missing')
        self.assertEqual(series.bars, [])
    def test_sample_dates_do_not_advance_with_the_wall_clock(self):
        class FutureDate(date):
            @classmethod
            def today(cls): return date(2030,1,1)
        item=self.catalog.defaults[Segment.US][0]
        with patch('app.modules.market_board.sample.date',FutureDate):
            row=row_for(item)
            series=series_for(item,'1d','1mo')
        self.assertEqual(row.quote.trading_date,date(2026,9,29))
        self.assertLessEqual(series.bars[-1].trading_date,date(2026,9,29))
    def test_final_same_basis_etf_premiums_build_complete_percentile(self):
        item=self.catalog.defaults[Segment.ETF][0]
        dates=[(date(2026,9,28)-timedelta(days=59-index)).isoformat() for index in range(60)]
        basis='verified:eod:v1'
        for index,day in enumerate(dates[:-1]):
            self.store.upsert_premium(item.key,basis,day,str(index),True)
        final_date=date.fromisoformat(dates[-1])
        quote=Quote(instrument_key=item.key,price='2',trading_date=final_date,session='closed',meta=ObservationMeta(source='fixture',fetched_at=self.now,timeliness='eod'))
        metrics=EtfMetrics(premium_pct='59',premium_basis='vendor_reference',basis_id=basis,reference_date=final_date,meta=ObservationMeta(source='fixture',fetched_at=self.now,timeliness='eod'))
        missing_shares=SharesObservation(meta=ObservationMeta(source='fixture',fetched_at=self.now,status='missing'))
        with patch.object(self.service.cn_provider,'quotes',return_value=[quote]), patch.object(self.service.etf_provider,'metrics',return_value={item.key:metrics}), patch.object(self.service.shares_provider,'shares',return_value=missing_shares), patch.object(self.service.shares_provider,'calendar',return_value=dates):
            row=self.service._row(item)
        self.assertEqual(str(row.metrics.percentile60),'100')
        self.assertEqual(row.metrics.sample_days,60)
        self.assertEqual(self.store.read_premiums(item.key,basis,dates[-1])[0]['premium'],'59')
    def test_provisional_etf_reference_never_enters_final_history(self):
        item=self.catalog.defaults[Segment.ETF][0]
        quote=Quote(instrument_key=item.key,price='2',trading_date='2026-09-28',session='closed',meta=ObservationMeta(source='fixture',fetched_at=self.now,timeliness='eod'))
        metrics=EtfMetrics(premium_pct='1.5',premium_basis='vendor_reference',basis_id='fixture:v1',reference_date='2026-09-28',meta=ObservationMeta(source='fixture',fetched_at=self.now,status='partial',timeliness='unknown'))
        with patch.object(self.service.cn_provider,'quotes',return_value=[quote]), patch.object(self.service.etf_provider,'metrics',return_value={item.key:metrics}), patch.object(self.service.shares_provider,'shares',return_value=None), patch.object(self.service.shares_provider,'calendar',side_effect=AssertionError('provisional reference requested calendar')):
            row=self.service._row(item)
        self.assertIsNone(row.metrics.percentile60)
        self.assertEqual(self.store.read_premiums(item.key,'fixture:v1','2000-01-01'),[])
    def test_calendar_outage_does_not_drop_valid_etf_row(self):
        item=self.catalog.defaults[Segment.ETF][0]
        quote=Quote(instrument_key=item.key,price='2',trading_date='2026-09-28',session='closed',meta=ObservationMeta(source='fixture',fetched_at=self.now,timeliness='eod'))
        metrics=EtfMetrics(premium_pct='1.5',premium_basis='vendor_reference',basis_id='fixture:v1',reference_date='2026-09-28',meta=ObservationMeta(source='fixture',fetched_at=self.now,timeliness='eod'))
        with patch.object(self.service.cn_provider,'quotes',return_value=[quote]), patch.object(self.service.etf_provider,'metrics',return_value={item.key:metrics}), patch.object(self.service.shares_provider,'shares',return_value=None), patch.object(self.service.shares_provider,'calendar',side_effect=TimeoutError('fixture')):
            row=self.service._row(item)
        self.assertEqual(str(row.quote.price),'2')
        self.assertIsNone(row.metrics.percentile60)
        self.assertEqual(self.store.read_premiums(item.key,'fixture:v1','2000-01-01'),[])
