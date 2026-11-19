"""Deterministic local validation; not a historical performance claim.
Run: python -m unittest -v test_rotation.py
"""
import unittest
import numpy as np
import pandas as pd
from rotation_backtest import (Settings,TICKERS,SEMIS,target_portfolio,
                               execute_target,indicators,backtest)

class TestRotation(unittest.TestCase):
    def test_locked_is_all_bills(self):
        s=Settings()
        target=target_portfolio(['NVDA','MU','INTC','AVGO','MSFT'],{},True,0.0,s)
        self.assertAlmostEqual(target['BIL'],1.0)
        self.assertAlmostEqual(sum(target.values()),1.0)

    def test_sector_and_cap(self):
        s=Settings()
        target=target_portfolio(['NVDA','MU','INTC','AVGO','MSFT'],{},True,.90,s)
        self.assertLessEqual(sum(target[t] for t in SEMIS),.22+1e-12)
        self.assertLessEqual(sum(target[t] for t in TICKERS if t!='BIL'),.9+1e-12)
        self.assertAlmostEqual(sum(target.values()),1.0)
        target2=target_portfolio(['NVDA','MU','INTC','AVGO','MSFT'],{'NVDA':2},True,.9,s)
        self.assertEqual(target2['NVDA'],0)

    def test_no_borrowing_integer_shares(self):
        s=Settings()
        prices=pd.Series({sym:100.0 for sym in TICKERS})
        holdings={sym:0 for sym in TICKERS}
        weights=target_portfolio(['NVDA','GOOGL','MSFT','AMZN','AAPL'],{},True,.90,s)
        holdings,cash,trades=execute_target(holdings,10000,prices,weights,s,pd.Timestamp('2026-11-16'))
        self.assertGreaterEqual(cash,0)
        self.assertTrue(all(isinstance(q,int) and q>=0 for q in holdings.values()))
        self.assertLessEqual(sum(holdings.values())*100+cash,10000.001)
        self.assertTrue(len(trades)>0)

    def test_indicator_causality_and_scale_invariance(self):
        rng=np.random.default_rng(20)
        dates=pd.bdate_range('2018-01-01',periods=400)
        levels=100*np.exp(np.cumsum(rng.normal(.0005,.015,size=(400,len(TICKERS))),axis=0))
        close=pd.DataFrame(levels,index=dates,columns=TICKERS)
        orig=indicators(close,Settings())['z']
        new=close.copy()
        new.loc[dates[350]:,'NVDA']*=2.0
        changed=indicators(new,Settings())['z']
        np.testing.assert_allclose(orig.loc[dates[320],:].values,changed.loc[dates[320],:].values,rtol=1e-12)
        # constant price scaling does not affect normalized log price residual
        scaled=close.copy()
        scaled['NVDA']*=7.0
        result=indicators(scaled,Settings())['z']
        np.testing.assert_allclose(orig['NVDA'].iloc[250:].values,result['NVDA'].iloc[250:].values,rtol=1e-9,atol=1e-9)

if __name__=='__main__':
    unittest.main()
