from __future__ import annotations
import unittest
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory
from pydantic import ValidationError
from app.modules.market_board import router
from app.modules.market_board.store import BoardStore
from app.modules.market_board.catalog import InstrumentCatalog
from app.modules.market_board.service import BoardService
from app.modules.market_board.models import Segment
from fastapi import HTTPException

class Offline:
    def get(self,*args,**kwargs): raise TimeoutError()
class ApiTest(unittest.TestCase):
    def setUp(self):
        tmp=TemporaryDirectory();self.addCleanup(tmp.cleanup)
        store=BoardStore(Path(tmp.name)/'board.db');catalog=InstrumentCatalog(store,Offline());service=BoardService(store,catalog,http=Offline())
        for name,value in [('_store',store),('_catalog',catalog),('_service',service)]:
            patcher=patch.object(router,name,value);patcher.start();self.addCleanup(patcher.stop)
        self.catalog=catalog
    def test_strict_inputs(self):
        with self.assertRaises(ValidationError):router.SelectionUpdate(keys=[],expected_revision=0,unknown=True)
        with self.assertRaises(ValidationError):router.QuotesRequest(keys=['x']*31)
        with self.assertRaises(ValidationError):router.QuotesRequest(keys='AAPL')
    def test_quotes_contract_and_errors(self):
        key=self.catalog.defaults[Segment.US][0].key
        result=router.quotes(router.QuotesRequest(keys=[key]))
        self.assertEqual(result['items'][0]['instrument_key'],key)
        self.assertNotIn('instrument',result['items'][0])
        with self.assertRaises(HTTPException) as caught:router.quotes(router.QuotesRequest(keys=['unknown']))
        self.assertEqual(caught.exception.status_code,422)
        with self.assertRaises(HTTPException) as caught:router.detail('unknown')
        self.assertEqual(caught.exception.status_code,404)
    def test_revision_and_empty_board(self):
        result=router.replace_selection(Segment.FUND,router.SelectionUpdate(keys=[],expected_revision=0))
        self.assertEqual(result['items'],[])
        self.assertEqual(router.board(Segment.FUND)['rows'],[])
        with self.assertRaises(HTTPException) as caught:router.replace_selection(Segment.FUND,router.SelectionUpdate(keys=[],expected_revision=0))
        self.assertEqual(caught.exception.status_code,409)
