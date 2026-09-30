import unittest,json
from datetime import datetime,timezone
from app.modules.market_board.providers.shares import SharesProvider
from app.modules.market_board.catalog import default_instruments
from app.modules.market_board.models import Segment

class Http:
    def __init__(self,missing=False):self.missing=missing
    def get(self,url,**kwargs):
        dates=['2026-09-28','2026-09-25','2026-09-24']
        data=[dict(fund_code='159501',size_date=d,current_size='120.05' if i==0 else '100') for i,d in enumerate(dates)]
        if '159696' in url:
            data=[dict(row,fund_code='159696') for row in data]
            if self.missing:data.pop(1)
        return json.dumps([{'metadata':{'tabkey':'tab1','pageno':1,'pagesize':20,'recordcount':len(data)},'data':data}]).encode()
class SharesTest(unittest.TestCase):
    def test_units_and_verified_adjacent_disclosures(self):
        item=next(i for i in default_instruments()[Segment.ETF] if i.symbol=='159696')
        result=SharesProvider(Http()).shares(item,datetime(2026,9,29,10,tzinfo=timezone.utc))
        self.assertEqual(str(result.shares),'1200500.00')
        self.assertEqual(str(result.shares_change),'200500.00')
        self.assertEqual(str(result.shares_date),'2026-09-28')
    def test_missing_report_does_not_bridge_gap(self):
        item=next(i for i in default_instruments()[Segment.ETF] if i.symbol=='159696')
        result=SharesProvider(Http(True)).shares(item,datetime(2026,9,29,10,tzinfo=timezone.utc))
        self.assertIsNone(result.shares_change)
