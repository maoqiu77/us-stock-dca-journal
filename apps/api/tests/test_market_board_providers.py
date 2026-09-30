import unittest, json
from datetime import datetime, timezone
from app.modules.market_board.catalog import default_instruments
from app.modules.market_board.models import Segment
from app.modules.market_board.providers.bars import BarsProvider
from app.modules.market_board.providers.etf import EtfProvider
from app.modules.market_board.providers.us import USProvider
from app.modules.market_board.providers.cn import CNProvider

NOW=datetime(2026,9,29,10,tzinfo=timezone.utc)
class Http:
    def __init__(self,payload): self.payload=payload
    def get(self,*a,**kw): return json.dumps(self.payload).encode()
class ProvidersTest(unittest.TestCase):
    def test_tencent_etf_quote_and_reference_keep_separate_basis(self):
        item=next(i for i in default_instruments()[Segment.ETF] if i.symbol=='159501')
        values=['']*83
        for index,value in {2:'159501',3:'2.236',4:'2.214',30:'20260929150000',31:'0.022',32:'0.99',72:'6791986600',77:'17.04',78:'1.9105',82:'CNY'}.items():values[index]=value
        class Tencent:
            def get(self,*args,**kwargs):return ('v_sz159501="'+'~'.join(values)+'";').encode('gb18030')
        quote=CNProvider(Tencent()).tencent(item,NOW)
        metrics=EtfProvider(Tencent()).tencent(item,NOW)
        self.assertEqual(str(quote.price),'2.236')
        self.assertEqual(str(metrics.premium_pct),'17.04')
        self.assertEqual(metrics.basis_id,'tencent:field77:v1')
        self.assertIsNone(metrics.reference_date)
        values[82]='USD'
        with self.assertRaises(ValueError):CNProvider(Tencent()).tencent(item,NOW)
    def test_bars_are_real_missing_volume_and_identity_validated(self):
        item=default_instruments()[Segment.US][0]
        payload={'chart':{'result':[{'meta':{'symbol':item.symbol,'currency':'USD','exchangeTimezoneName':'America/New_York'},'timestamp':[1790602200], 'indicators':{'quote':[{'open':[10], 'high':[12], 'low':[9], 'close':[11], 'volume':[None]}]}}]}}
        series=BarsProvider(Http(payload)).series(item,'1d','1mo',NOW)
        self.assertEqual(len(series.bars),1)
        self.assertIsNone(series.bars[0].volume)
        self.assertNotEqual(series.meta.status,'sample')
        payload['chart']['result'][0]['meta']['currency']='CNY'
        self.assertEqual(BarsProvider(Http(payload)).series(item,'1d','1mo',NOW).meta.status,'missing')
    def test_etf_does_not_invent_reference_or_shares_dates(self):
        item=next(i for i in default_instruments()[Segment.ETF] if i.symbol=='513100')
        payload={'data':{'diff':[{'f12':item.symbol,'f13':1,'f14':'供应商简称','f2':2.3,'f38':12340000,'f441':2,'f402':-15,'f124':int(NOW.timestamp())}]}}
        metrics=EtfProvider(Http(payload)).metrics([item],NOW)[item.key]
        self.assertEqual(str(metrics.premium_pct),'15')
        self.assertIsNone(metrics.reference_date)
        self.assertIsNone(metrics.shares_date)
        self.assertIsNone(metrics.nav)
        self.assertIsNone(metrics.iopv)
        self.assertEqual(str(metrics.vendor_reference.value),'2')
        self.assertIsNone(metrics.percentile60)
    def test_us_previous_close_uses_last_completed_day_not_range_start(self):
        item=default_instruments()[Segment.US][0]
        payload={'chart':{'result':[{'meta':{'symbol':item.symbol,'currency':'USD','regularMarketPrice':12,'chartPreviousClose':5,'previousClose':5,'regularMarketTime':1790692200},'timestamp':[1790602200,1790692200], 'indicators':{'quote':[{'close':[10,12]}]}}]}}
        payload['chart']['result'][0]['meta']['regularMarketTime']=int(NOW.timestamp())-86400
        payload['chart']['result'][0]['timestamp']=[int(NOW.timestamp())-172800,int(NOW.timestamp())-86400]
        quote=USProvider(Http(payload)).quotes([item],NOW)[0]
        self.assertEqual(str(quote.previous_close),'10')
        self.assertEqual(str(quote.change),'2')

    def test_eastmoney_us_reference_quote_validates_identity_and_time(self):
        item=default_instruments()[Segment.US][0]
        payload={'data':{'diff':[{'f12':item.symbol,'f13':105,'f2':123.45,'f3':1.2,'f4':1.47,'f18':121.98,'f124':int(NOW.timestamp()),'f20':1000000}]}}
        quote=USProvider(Http(payload)).eastmoney(item,NOW)
        self.assertEqual(str(quote.price),'123.45')
        self.assertEqual(str(quote.previous_close),'121.98')
        self.assertEqual(quote.meta.source,'东方财富公开接口')
        payload['data']['diff'][0]['f13']=106
        with self.assertRaises(ValueError): USProvider(Http(payload)).eastmoney(item,NOW)

    def test_tencent_us_complete_snapshot_is_available_with_unknown_session(self):
        item=default_instruments()[Segment.US][0]
        values=['']*37
        for index,value in {0:'200',2:item.symbol+'.OQ',3:'123.45',4:'121.98',30:'2026-09-29 05:00:00',31:'1.47',32:'1.20',35:'USD',36:'1000'}.items(): values[index]=value
        class Tencent:
            def get(self,*args,**kwargs): return ('v_us'+item.symbol+'="'+'~'.join(values)+'";').encode('gb18030')
        quote=USProvider(Tencent()).tencent(item,NOW)
        self.assertEqual(quote.meta.status,'available')
        self.assertEqual(quote.session,'unknown')
