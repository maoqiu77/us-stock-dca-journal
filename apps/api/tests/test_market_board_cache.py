import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from app.modules.market_board.store import BoardStore
from app.modules.market_board.models import Quote, ObservationMeta
from app.modules.market_board.cache import FieldCache, cache_key
from app.modules.market_board.http import PublicHttp

class CacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.now = datetime(2026,9,29,10,tzinfo=timezone.utc)
        self.store = BoardStore(Path(self.tmp.name)/'test.db')
        self.cache = FieldCache(self.store, lambda:self.now)
        self.calls = 0
    def loader(self):
        self.calls += 1
        return Quote(instrument_key='US:XNAS:AAPL:STOCK',price='10',meta=ObservationMeta(source='fixture',fetched_at=self.now,as_of=self.now))
    def get(self, loader=None, refresh=False):
        return self.cache.get('fixture','US:XNAS:AAPL:STOCK','quote',Quote,loader or self.loader,refresh=refresh)
    def test_ttl_refresh_cooldown_stale_retention(self):
        first=self.get()
        self.get(refresh=True)
        self.assertEqual(self.calls,1)
        self.now += timedelta(seconds=10)
        self.get(refresh=True)
        self.assertEqual(self.calls,2)
        self.now += timedelta(seconds=30)
        def fail(): raise TimeoutError()
        stale=self.get(fail)
        self.assertEqual(stale.meta.status,'stale')
        self.assertEqual(stale.meta.as_of,first.meta.as_of+timedelta(seconds=10))
        self.now += timedelta(days=8)
        self.assertIsNone(self.get(fail))
    def test_coalesced_and_no_sample_cached(self):
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(lambda _:self.get(refresh=True),range(4)))
        self.assertEqual(self.calls,1)
        sample=self.loader(); sample.meta.status='sample'
        self.cache.get('sample','identity','quote',Quote,lambda:sample)
        self.assertIsNone(self.store.read_cache(cache_key('sample','identity','quote')))
    def test_key_isolates_every_dimension(self):
        baseline=cache_key('a','b','bars','1d','1y','raw',1)
        for args in [('c','b','bars','1d','1y','raw',1),('a','c','bars','1d','1y','raw',1),('a','b','quote','1d','1y','raw',1),('a','b','bars','1m','1y','raw',1),('a','b','bars','1d','1mo','raw',1),('a','b','bars','1d','1y','split',1),('a','b','bars','1d','1y','raw',2)]:
            self.assertNotEqual(baseline,cache_key(*args))

class Response:
    def __init__(self,status=200,body=b'123',headers=None): self.status_code,self.body,self.headers,self.closed=status,body,headers or {},False
    def iter_content(self,size): yield self.body
    def close(self): self.closed=True

class HttpTest(unittest.TestCase):
    def test_429_backoff_closes_and_does_not_retry(self):
        calls=[]; response=Response(429,headers={'Retry-After':'20'}); clock=[0]
        http=PublicHttp(lambda *a,**k: calls.append(k) or response,now=lambda:clock[0])
        for _ in range(2):
            with self.assertRaises(RuntimeError): http.get('https://fund.eastmoney.com/test')
        self.assertEqual(len(calls),1); self.assertTrue(response.closed)
        clock[0]=21
        with self.assertRaises(RuntimeError): http.get('https://fund.eastmoney.com/test')
        self.assertEqual(len(calls),2)
    def test_size_redirect_and_timeout_are_bounded(self):
        for response in [Response(302),Response(body=b'12345')]:
            with self.assertRaises(RuntimeError): PublicHttp(lambda *a,**k:response).get('https://fund.eastmoney.com/test',max_bytes=4)
            self.assertTrue(response.closed)
        def timeout(*a,**k): raise TimeoutError()
        with self.assertRaises(TimeoutError): PublicHttp(timeout).get('https://fund.eastmoney.com/test')
