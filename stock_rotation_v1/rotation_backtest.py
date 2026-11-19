#!/usr/bin/env python3
"""Risk-aware, long-only rotation backtest with next-open execution.

Research tool, not an automatic live trading system. Uses adjusted OHLC prices.
Run: pip install numpy pandas yfinance matplotlib
     python rotation_backtest.py --end 2026-11-14
     python rotation_backtest.py --csv my_daily_ohlc.csv

CSV columns: Date,Ticker,Open,Close; tickers use VOO,QQQ,BIL for base/short T-bills.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd

INDIVIDUALS = ['NVDA','AVGO','GOOGL','MSFT','AMZN','META','MU','INTC','AAPL']
TICKERS = ['VOO','QQQ','BIL'] + INDIVIDUALS
SEMIS = {'NVDA','AVGO','MU','INTC'}

@dataclass
class Settings:
    capital: float=10000.0
    fee_bps: float=10.0  # slippage + brokerage + execution friction, per side
    min_trade_usd: float=75.0
    min_rebalance_gap: float=0.025  # 2.5% of NAV per holding; ignores tiny drift
    use_z: bool=True
    ranking_hysteresis: float=0.25  # avoid replacing a held name on tiny score advantage
    sma_fast: int=50
    sma_slow: int=200
    residual_ema: int=60
    residual_window: int=120
    z_trim: float=2.5
    z_exit: float=3.0
    z_reset: float=1.0
    stock_max: float=0.11
    mu_max: float=0.08
    intc_max: float=0.05
    semi_max: float=0.22
    active_slots: int=5
    voo_weight: float=0.25
    qqq_weight: float=0.10
    active_weight: float=0.55
    volatility_ceiling: float=0.35
    normal_cap: float=0.90
    regime_riskoff_cap: float=0.45
    soft_dd1: float=-0.12
    soft_dd2: float=-0.20
    lock_dd: float=-0.25
    lock_min_days: int=20
    cool_recover_days: int=10


def obtain_data(csv=None, start='2014-01-01', end='2026-11-14'):
    if csv:
        raw = pd.read_csv(csv, parse_dates=['Date'])
        for key in ['Date','Ticker','Open','Close']:
            if key not in raw.columns:
                raise ValueError(f'Missing CSV column: {key}')
        raw['Ticker'] = raw['Ticker'].str.upper()
        for t in TICKERS:
            if t not in set(raw.Ticker):
                raise ValueError(f'Missing ticker {t} from CSV')
        opens = raw.pivot(index='Date', columns='Ticker', values='Open').sort_index()
        closes = raw.pivot(index='Date', columns='Ticker', values='Close').sort_index()
    else:
        try:
            import yfinance as yf
        except ImportError as exc:
            raise SystemExit('Install yfinance: pip install yfinance') from exc
        raw = yf.download(TICKERS, start=start, end=end, auto_adjust=True,
                          progress=False, group_by='ticker', threads=True,
                          multi_level_index=True)
        if raw.empty:
            raise ValueError('No prices downloaded. Try CSV input.')
        opens, closes = pd.DataFrame(), pd.DataFrame()
        for t in TICKERS:
            opens[t] = raw[t]['Open']
            closes[t] = raw[t]['Close']
        opens.index = raw.index
        closes.index = raw.index
    # Common trading dates, no forward filling across outages: missing bars = no valid prices.
    cols = TICKERS
    opens, closes = opens[cols].astype(float), closes[cols].astype(float)
    valid = opens.notna().all(axis=1) & closes.notna().all(axis=1) & (opens > 0).all(axis=1) & (closes > 0).all(axis=1)
    opens, closes = opens.loc[valid], closes.loc[valid]
    if len(closes) < 270:
        raise ValueError('At least 270 common daily OHLC observations are required.')
    return opens, closes


def indicators(closes: pd.DataFrame, c: Settings):
    logp = np.log(closes)
    ret = logp.diff()
    ema = logp.ewm(span=c.residual_ema, adjust=False).mean()
    residual = logp - ema
    std = residual.rolling(c.residual_window, min_periods=c.residual_window).std(ddof=1)
    zscore = (residual - residual.rolling(c.residual_window, min_periods=c.residual_window).mean()) / std.replace(0, np.nan)
    vol63 = ret.rolling(63).std(ddof=1) * math.sqrt(252)
    fast = closes.rolling(c.sma_fast).mean()
    slow = closes.rolling(c.sma_slow).mean()
    m63 = (logp.shift(5) - logp.shift(63))
    m126 = (logp.shift(21) - logp.shift(126))
    score = (0.4 * m63 / math.sqrt(58/252) + 0.6 * m126 / math.sqrt(105/252)) / vol63.clip(lower=.10)
    market_vol = ret['VOO'].rolling(20).std(ddof=1) * math.sqrt(252)
    return dict(z=zscore,fast=fast,slow=slow,score=score,m63=m63,m126=m126,market_vol=market_vol)


def portfolio_nav(shares, cash, px):
    return float(cash + sum(qty * float(px[symbol]) for symbol,qty in shares.items()))


def execute_target(shares: Dict[str,int], cash: float, px: pd.Series, weights: Dict[str,float], cfg: Settings, date):
    """Sell first, then buy integer shares. Adjusted shares are not broker share quantities."""
    nav = portfolio_nav(shares,cash,px)
    rows=[]
    cost = cfg.fee_bps / 10000.0
    desired = {sym: int(max(0,math.floor(nav * weights.get(sym,0) / float(px[sym]) / (1+cost)))) for sym in TICKERS}
    # Reduce unnecessary turnover: an ordinary weight drift smaller than 2.5% NAV
    # is not corrected. Full liquidation and first entry are not suppressed.
    for sym in TICKERS:
        target = weights.get(sym,0.0)
        current = shares[sym]
        if target > 0 and current > 0 and abs(desired[sym]-current) * float(px[sym]) < max(cfg.min_trade_usd, cfg.min_rebalance_gap * nav):
            desired[sym] = current
    for sym in TICKERS:
        delta = desired[sym]-shares[sym]
        if delta >= 0 or abs(delta) * px[sym] < cfg.min_trade_usd: continue
        qty = min(shares[sym],-delta)
        cash += qty * float(px[sym]) * (1-cost)
        shares[sym] -= qty
        rows.append(dict(date=str(date.date()), ticker=sym, side='SELL', shares=int(qty), price=float(px[sym]),
                         notional=float(qty*px[sym]), cost=float(qty*px[sym]*cost), nav_at_execution=nav))
    # Prioritize larger allocation gaps and ensure no borrowing.
    buys = sorted((sym for sym in TICKERS if desired[sym]>shares[sym]),
                  key=lambda s: (desired[s]-shares[s])*float(px[s]), reverse=True)
    for sym in buys:
        gap=desired[sym]-shares[sym]
        qty=min(gap, int((cash+1e-8)//(float(px[sym])*(1+cost))))
        if qty<=0 or qty * px[sym]<cfg.min_trade_usd: continue
        outflow=qty*float(px[sym])*(1+cost)
        cash -= outflow
        shares[sym]+=qty
        rows.append(dict(date=str(date.date()), ticker=sym, side='BUY', shares=int(qty), price=float(px[sym]),
                         notional=float(qty*px[sym]), cost=float(qty*px[sym]*cost), nav_at_execution=nav))
    assert cash>-1e-6, 'cash balance became negative'
    return shares,max(0.0,cash),rows


def risk_tier(dd, locked, mkt_on, recovery_stage, cfg):
    if locked:return 0.0
    cap = cfg.normal_cap if mkt_on else cfg.regime_riskoff_cap
    if dd <= cfg.soft_dd2: cap=min(cap,.30)
    elif dd <= cfg.soft_dd1: cap=min(cap,.60)
    if recovery_stage is not None: cap=min(cap,recovery_stage)
    return max(0.,cap)


def target_portfolio(selection, heat, market_on, cap, cfg):
    w={t:0.0 for t in TICKERS}
    if cap<=0: w['BIL']=1.0;return w
    w['VOO']=cfg.voo_weight
    w['QQQ']=cfg.qqq_weight
    for symbol in selection:
        limit=cfg.stock_max
        if symbol=='MU':limit=min(limit,cfg.mu_max)
        if symbol=='INTC':limit=min(limit,cfg.intc_max)
        if heat.get(symbol,0)==1:limit*=.5
        if heat.get(symbol,0)==2:limit=0.0
        w[symbol]=min(cfg.active_weight/cfg.active_slots,limit)
    # Sector cap applies to direct stock selections (ETFs have embedded semiconductor exposure).
    sw=sum(w[s] for s in SEMIS)
    if sw>cfg.semi_max:
        for s in SEMIS:w[s]*=cfg.semi_max/sw
    total=sum(w.values())
    if total>cap:
        w={s:(v*cap/total) for s,v in w.items()}
    w['BIL']=max(0.0,1.0-sum(w.values()))
    return w


def backtest(opens,closes,cfg:Settings,first_trade_date='2016-01-01'):
    ind=indicators(closes,cfg)
    dates=closes.index
    holdings={s:0 for s in TICKERS}
    cash=cfg.capital
    nav_records=[];weight_records=[];trade_records=[];signal_records=[]
    heat={s:0 for s in INDIVIDUALS}
    selection=[]
    pending_weights=None
    locked=False
    lock_idx=-999999
    recovery_idx=None
    risk_peak=cfg.capital
    global_peak=cfg.capital
    previous_risk_cap=None
    previous_market_on=None
    ready=False
    first_trade_date=pd.Timestamp(first_trade_date)

    for i, day in enumerate(dates):
        op=opens.loc[day];cl=closes.loc[day]
        if not ready and day>=first_trade_date and i>=250:
            ready=True
            # first trade generated from previous day's close at today's open
            if i>0 and pending_weights is None:
                pending_weights={s:0.0 for s in TICKERS}
                pending_weights['BIL']=1.0
        if not ready:continue
        if pending_weights is not None:
            holdings,cash,orders=execute_target(holdings,cash,op,pending_weights,cfg,day)
            trade_records+=orders
            pending_weights=None
        nav=portfolio_nav(holdings,cash,cl)
        global_peak=max(global_peak,nav)
        risk_peak=max(risk_peak,nav)
        dd=nav/risk_peak-1
        if not locked and dd<=cfg.lock_dd:
            locked=True
            lock_idx=i
            recovery_idx=None

        market_on=bool((cl['VOO']>ind['slow'].loc[day,'VOO']) and
                       (ind['market_vol'].loc[day] < cfg.volatility_ceiling))
        if locked and i-lock_idx>=cfg.lock_min_days and i>=5:
            last5=closes['VOO'].iloc[i-4:i+1]
            slow5=ind['slow']['VOO'].iloc[i-4:i+1]
            if bool((last5>slow5).all()) and bool(cl['VOO']>closes['VOO'].iloc[i-20]):
                locked=False
                risk_peak=nav  # new risk episode; GLOBAL drawdown metric is never reset
                dd=0.0
                recovery_idx=i
        rec_cap=None
        if recovery_idx is not None:
            age=i-recovery_idx
            if age<cfg.cool_recover_days:rec_cap=.35
            elif age<2*cfg.cool_recover_days:rec_cap=.60
            else: recovery_idx=None

        changed_heat=False
        if cfg.use_z:
            for s in INDIVIDUALS:
                z=float(ind['z'].loc[day,s])
                old=heat[s]
                if not np.isfinite(z): continue
                if z>=cfg.z_exit: heat[s]=2
                elif z>=cfg.z_trim: heat[s]=max(heat[s],1)
                elif z<=cfg.z_reset:heat[s]=0
                if old!=heat[s]:changed_heat=True
        is_week_end = (i+1==len(dates) or dates[i+1].isocalendar().week != day.isocalendar().week or dates[i+1].year != day.year)
        if is_week_end:
            candidates=[]
            for s in INDIVIDUALS:
                if heat[s]>=2:continue
                if not (cl[s]>ind['slow'].loc[day,s] and ind['fast'].loc[day,s]>ind['slow'].loc[day,s]):continue
                if not (ind['m63'].loc[day,s]>0 and ind['m126'].loc[day,s]>0):continue
                z=float(ind['z'].loc[day,s])
                if cfg.use_z and (not np.isfinite(z) or z<=-2.0):continue
                score=float(ind['score'].loc[day,s])
                if np.isfinite(score):candidates.append((s,score))
            ranked=sorted(candidates,key=lambda item:item[1],reverse=True)
            candidate_scores=dict(ranked)
            kept=[s for s in selection if s in candidate_scores]
            if len(kept)>cfg.active_slots:
                kept=sorted(kept,key=lambda s:candidate_scores[s],reverse=True)[:cfg.active_slots]
            for candidate, candidate_score in ranked:
                if candidate in kept:continue
                if len(kept)<cfg.active_slots:
                    kept.append(candidate)
                else:
                    weakest=min(kept,key=lambda s:candidate_scores[s])
                    if candidate_score >= candidate_scores[weakest]+cfg.ranking_hysteresis:
                        kept.remove(weakest)
                        kept.append(candidate)
            selection=sorted(kept,key=lambda s:candidate_scores[s],reverse=True)
        cap=risk_tier(dd,locked,market_on,rec_cap,cfg)
        need_trade= (is_week_end or changed_heat or previous_risk_cap!=cap or previous_market_on!=market_on)
        previous_risk_cap,previous_market_on=cap,market_on
        weights=target_portfolio(selection,heat,market_on,cap,cfg)
        if need_trade: pending_weights=weights
        nav_records.append(dict(date=day,nav=nav,drawdown=nav/global_peak-1,
                                episode_drawdown=dd,market_on=market_on,
                                risk_cap=cap,locked=locked,signal_weekend=is_week_end))
        if is_week_end or changed_heat:
            signal_records.append(dict(date=str(day.date()),selection=','.join(selection),
                                       market_on=market_on,locked=locked,episode_dd=dd,max_equity=cap,
                                       **{f'z_{s.lower()}':float(ind['z'].loc[day,s]) for s in INDIVIDUALS},
                                       **{f'heat_{s.lower()}':heat[s] for s in INDIVIDUALS}))
        weights_actual={s: holdings[s]*float(cl[s])/nav for s in TICKERS}
        weight_records.append(dict(date=day,**weights_actual,cash=cash/nav))

    curve=pd.DataFrame(nav_records).set_index('date')
    exposures=pd.DataFrame(weight_records).set_index('date')
    trades=pd.DataFrame(trade_records)
    signals=pd.DataFrame(signal_records)
    if len(curve)<252:raise ValueError('Backtest period shorter than one year')
    curve['daily_return']=curve.nav.pct_change().fillna(0)
    bench=closes.loc[curve.index,'VOO']
    curve['voo_bh']=cfg.capital*bench/bench.iloc[0]
    qqq=closes.loc[curve.index,'QQQ']
    curve['qqq_bh']=cfg.capital*qqq/qqq.iloc[0]
    daily_mix=closes.loc[curve.index,['VOO','QQQ','BIL']].pct_change().fillna(0)
    mix_return=.35*daily_mix['VOO']+.55*daily_mix['QQQ']+.10*daily_mix['BIL']
    curve['static_mix_frictionless']=cfg.capital*(1+mix_return).cumprod()
    return curve,exposures,trades,signals


def performance(curve,trades,capital=10000.0):
    years=(curve.index[-1]-curve.index[0]).days/365.25
    ann=curve.nav.iloc[-1]/capital
    rets=curve.daily_return.iloc[1:]
    mdd=(curve.nav/curve.nav.cummax()-1).min()
    metrics=dict(start=str(curve.index[0].date()),end=str(curve.index[-1].date()),
                 initial_capital=capital,ending_nav=round(float(curve.nav.iloc[-1]),2),
                 total_return=round(float(ann-1),5),
                 cagr=round(float(ann**(1/years)-1),5),
                 volatility=round(float(rets.std(ddof=1)*math.sqrt(252)),5),
                 max_drawdown=round(float(mdd),5),
                 annual_sharpe_zero_rf=round(float(rets.mean()/rets.std(ddof=1)*math.sqrt(252)),4) if rets.std(ddof=1)>0 else None,
                 trade_count=int(len(trades)),
                 annual_one_way_turnover=round(float(((trades.notional/trades.nav_at_execution).sum()/2)/years),3) if not trades.empty else 0.0,
                 total_friction=round(float(trades.cost.sum()),2) if not trades.empty else 0.0)
    for key in ['voo_bh','qqq_bh','static_mix_frictionless']:
        ser=curve[key]
        metrics[key+'_cagr']=round(float((ser.iloc[-1]/ser.iloc[0])**(1/years)-1),5)
        metrics[key+'_mdd']=round(float((ser/ser.cummax()-1).min()),5)
    return metrics


def main():
    p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--csv',type=str,default=None,help='Local OHLC CSV; columns Date,Ticker,Open,Close')
    p.add_argument('--start',default='2014-01-01',help='Download warmup start')
    p.add_argument('--end',default='2026-11-14',help='Exclusive end date (last full US close: 2026-11-13)')
    p.add_argument('--first-trade',default='2016-01-01',help='Strategy evaluation start')
    p.add_argument('--cost-bps',type=float,default=10)
    p.add_argument('--z-trim',type=float,default=2.5)
    p.add_argument('--z-exit',type=float,default=3.0)
    p.add_argument('--disable-z',action='store_true',help='Ablation: skip all Z-score entry/exit conditions')
    p.add_argument('--output',default='rotation_output')
    args=p.parse_args()
    cfg=Settings(fee_bps=args.cost_bps,z_trim=args.z_trim,z_exit=args.z_exit,use_z=not args.disable_z)
    if args.z_exit<=args.z_trim:raise ValueError('--z-exit must be greater than --z-trim')
    op,cl=obtain_data(args.csv,args.start,args.end)
    curve,exposures,trades,signals=backtest(op,cl,cfg,first_trade_date=args.first_trade)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    curve.to_csv(out/'nav.csv')
    exposures.to_csv(out/'daily_weights.csv')
    trades.to_csv(out/'trades.csv',index=False)
    signals.to_csv(out/'signals.csv',index=False)
    summary=performance(curve,trades,cfg.capital)
    (out/'metrics.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(summary,indent=2,ensure_ascii=False))
    print(f'Outputs saved to: {out.resolve()}')

if __name__=='__main__':main()
