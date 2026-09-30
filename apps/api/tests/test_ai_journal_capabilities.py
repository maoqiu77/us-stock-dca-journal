import unittest
from app.modules.ai_journal.capabilities import capabilities


class AiJournalCapabilitiesTest(unittest.TestCase):
    def test_only_verified_us_quant_is_eligible(self):
        class I:
            market=type('M',(),{'value':'US'}); asset_type=type('A',(),{'value':'STOCK'}); symbol='AAPL'
            key='US:XNAS:AAPL:STOCK'
            def model_dump(self,**kwargs): return {'key':self.key}
        class C:
            def resolve(self,key): return I() if key == I.key else None
        class B: catalog=C()
        result = capabilities(B(), I.key, lambda symbol: {'assetType':'EQUITY','ticker':'AAPL'})
        self.assertTrue(result['quant_eligible']); self.assertEqual(result['periods'], ['1d'])
