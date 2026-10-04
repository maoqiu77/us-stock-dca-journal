from __future__ import annotations
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, wait
import time
from .models import BoardResponse, Capabilities, DetailResponse, Segment, Series, Quote, Nav, PurchaseLimit, EtfMetrics, FundHoldings, ObservationMeta, BoardRow
from .providers.bars import BarsProvider
from .providers.us import USProvider
from .providers.cn import CNProvider
from .providers.funds import FundProvider
from .providers.etf import EtfProvider
from .http import PublicHttp, REQUEST_DEADLINE
from .cache import FieldCache
from .models import SharesObservation
from .providers.shares import SharesProvider
from .metrics import premium_percentile

_POOL=ThreadPoolExecutor(max_workers=12,thread_name_prefix='market-board')

class BoardService:
    def __init__(self,store,catalog,now=None,http=None):
        self.store,self.catalog=store,catalog
        self.now=now or (lambda:datetime.now(timezone.utc))
        self.http=http or PublicHttp()
        self.cache=FieldCache(store,self.now)
        self.bars=BarsProvider(self.http)
        self.us_provider=USProvider(self.http)
        self.cn_provider=CNProvider(self.http)
        self.fund_provider=FundProvider(self.http)
        self.etf_provider=EtfProvider(self.http)
        self.shares_provider=SharesProvider(self.http,self.cache)

    def _row(self,item,refresh=False,cached_only=False):
        now=self.now()
        def get(provider,kind,model,loader):
            return self.cache.get(provider,item.key,kind,model,loader,refresh=refresh,cached_only=cached_only)
        fields={}
        if item.asset_type.value=='FUND':
            fields['nav']=get('eastmoney:nav:v2','nav',Nav,lambda:self.fund_provider.nav(item,now))
            fields['purchase_limit']=get('eastmoney:sales:v2','purchase_limit',PurchaseLimit,lambda:self.fund_provider.purchase_limit(item,now))
        else:
            provider=self.us_provider if item.market.value=='US' else self.cn_provider
            name='yahoo' if item.market.value=='US' else 'eastmoney'
            # Tencent is the fastest broad public US snapshot. Use it for the
            # board's first paint; Nasdaq remains the richer fallback for
            # session-aware rows and detail refreshes.
            fields['quote']=None
            if item.market.value=='US':
                fallback=get('tencent:us','quote',Quote,lambda:self.us_provider.tencent(item,now))
                if fallback is not None and fallback.price is not None:
                    fields['quote']=fallback
            if (fields['quote'] is None or fields['quote'].price is None) and item.market.value=='US':
                fallback=get('nasdaq','quote',Quote,lambda:self.us_provider.nasdaq(item,now))
                if fallback is not None and fallback.price is not None:
                    fields['quote']=fallback
            if fields['quote'] is None or fields['quote'].price is None:
                fallback=get(name,'quote',Quote,lambda:provider.quotes([item],now)[0])
                if fallback is not None and fallback.price is not None:
                    fields['quote']=fallback
            if (fields['quote'] is None or fields['quote'].price is None) and item.market.value=='US':
                fallback=get('eastmoney:us','quote',Quote,lambda:self.us_provider.eastmoney(item,now))
                if fallback is not None and fallback.price is not None:
                    fields['quote']=fallback
            if (fields['quote'] is None or fields['quote'].price is None) and item.market.value=='CN':
                fallback=get('tencent:cn','quote',Quote,lambda:self.cn_provider.tencent(item,now))
                if fallback is not None and fallback.price is not None:
                    fields['quote']=fallback
            if item.market.value=='CN' and item.asset_type.value=='ETF':
                fields['metrics']=get('eastmoney:f402:negated:v1','metrics',EtfMetrics,lambda:self.etf_provider.metrics([item],now).get(item.key))
                if fields['metrics'] is None:
                    fields['metrics']=get('tencent:field77:v1','metrics',EtfMetrics,lambda:self.etf_provider.tencent(item,now))
                shares=get('szse' if item.exchange=='XSHE' else 'sse','shares',SharesObservation,lambda:self.shares_provider.shares(item,now))
                if shares is not None:
                    metrics=fields['metrics'] or EtfMetrics(meta=ObservationMeta(source='参考值不可用',fetched_at=now,status='missing'))
                    for name in ('shares','shares_date','shares_change','previous_shares_date'):
                        setattr(metrics,name,getattr(shares,name))
                    metrics.shares_meta=shares.meta
                    fields['metrics']=metrics
                self._complete_premium_history(item, fields.get('quote'), fields.get('metrics'), now)
        # Provider outages stay explicit; production never fills gaps with sample prices.
        row=BoardRow(instrument=item,**fields)
        missing=ObservationMeta(source='未取得数据',fetched_at=now,status='missing',reason='字段不可用；未填充示例')
        if item.asset_type.value=='FUND':
            row.nav=row.nav or Nav(meta=missing)
            row.purchase_limit=row.purchase_limit or PurchaseLimit(state='unknown',channel='eastmoney',meta=missing)
        else:
            row.quote=row.quote or Quote(instrument_key=item.key,meta=missing)
            if item.market.value=='CN' and item.asset_type.value=='ETF':
                row.metrics=row.metrics or EtfMetrics(meta=missing)
        primary = row.quote if item.asset_type.value != 'FUND' else row.nav
        if primary is None or primary.meta.status.value == 'missing':
            row.quality = 'partial' if any(v is not None and v.meta.status.value in ('available','stale') for v in fields.values()) else 'missing'
        elif primary.meta.status.value == 'stale':
            row.quality = 'stale'
        else:
            # A valid primary price/NAV remains usable when an independent
            # supplemental field (limit, reference value, shares) is absent.
            row.quality = 'available'
        return row

    def _complete_premium_history(self,item,quote,metrics,now):
        if metrics is None or metrics.premium_pct is None or not metrics.basis_id or metrics.reference_date is None:
            return
        # A provider reference is not a final NAV merely because the exchange
        # has closed. Both observations must identify the same completed day.
        if (metrics.meta.status.value != 'available' or metrics.meta.timeliness != 'eod'
                or quote is None or quote.meta.status.value != 'available'
                or quote.trading_date != metrics.reference_date
                or quote.session != 'closed' or quote.meta.timeliness != 'eod'):
            return
        try:
            dates=self.shares_provider.calendar(now,count=60)
        except Exception:
            return
        trade_date=metrics.reference_date.isoformat()
        if len(set(dates)) != 60 or trade_date not in dates:
            return
        self.store.upsert_premium(item.key,metrics.basis_id,trade_date,str(metrics.premium_pct),True)
        observations=self.store.read_premiums(item.key,metrics.basis_id,dates[0])
        percentile,count=premium_percentile(observations,dates,str(metrics.premium_pct),metrics.basis_id)
        metrics.sample_days=count
        if percentile is not None:
            metrics.percentile60=percentile

    def _bounded_row(self,item,refresh,deadline):
        token=REQUEST_DEADLINE.set(deadline)
        try:
            return self._row(item,refresh,cached_only=time.monotonic()>=deadline)
        finally:
            REQUEST_DEADLINE.reset(token)

    def board(self,segment,refresh=False):
        selection=self.store.get_selection(segment)
        # A full curated US board can contain 30+ symbols.  Give the public
        # fallbacks enough wall time to complete while keeping a hard bound.
        timeout=20 if segment is Segment.US else 12
        deadline=time.monotonic()+timeout
        futures=[_POOL.submit(self._bounded_row,item,refresh,deadline) for item in selection.items]
        done,_=wait(futures,timeout=timeout) if futures else (set(),set())
        rows=[]
        for item,future in zip(selection.items,futures):
            if future in done:
                try: rows.append(future.result()); continue
                except Exception: pass
            future.cancel()
            # Do not wait on a still-running field lock after the board deadline.
            rows.append(self._row(item,cached_only=True))
        benchmarks=[]
        if segment is Segment.ETF and selection.items:
            token=REQUEST_DEADLINE.set(deadline)
            try: benchmarks=self.etf_provider.benchmarks(self.now())
            finally: REQUEST_DEADLINE.reset(token)
        warnings=[]
        if any(row.quality=='sample' for row in rows): warnings.append('部分数据为示例，非真实行情；不参与历史指标或组合估值')
        if any(row.quality in ('missing','partial','stale') for row in rows): warnings.append('部分字段缺失、时效未知或为旧缓存；请查看每项来源与观察时间')
        return BoardResponse(segment=segment,rows=rows,benchmarks=benchmarks,revision=selection.revision,fetched_at=self.now(),warnings=warnings)

    def detail(self,key,refresh=False):
        item=self.catalog.resolve(key)
        if item is None: raise KeyError(key)
        token=REQUEST_DEADLINE.set(time.monotonic()+12)
        try:
            row=self._row(item,refresh)
            if item.asset_type.value!='FUND': return DetailResponse(row=row)
            now=self.now()
            holdings=self.cache.get('eastmoney:holdings',''+key,'holdings',FundHoldings,lambda:self.fund_provider.holdings(item,now))
            allocation=self.cache.get('eastmoney:allocation',key,'allocation',FundHoldings,lambda:self.fund_provider.allocation(item,now))
            holdings=holdings or FundHoldings(instrument_key=key,meta=ObservationMeta(source='天天基金季度持仓披露',fetched_at=now,status='missing',reason='前十重仓披露不可用'))
            if allocation:
                holdings.allocation=allocation.allocation
                holdings.allocation_meta=allocation.meta
            return DetailResponse(row=row,holdings=holdings)
        finally:
            REQUEST_DEADLINE.reset(token)

    def capabilities(self,key):
        item=self.catalog.resolve(key)
        if item is None: raise KeyError(key)
        return Capabilities(instrument_key=key,quote=item.asset_type.value!='FUND',nav=item.asset_type.value=='FUND',periods=['1d'] if item.market.value=='US' else [],ranges=['1mo','3mo','1y'] if item.market.value=='US' else [])

    def quotes(self,keys,refresh=False):
        items=[self.catalog.resolve(key) for key in keys]
        if any(item is None for item in items): raise KeyError('unknown instrument')
        deadline=time.monotonic()+12
        futures=[_POOL.submit(self._bounded_row,item,refresh,deadline) for item in items]
        done,_=wait(futures,timeout=12) if futures else (set(),set())
        result=[]
        for item,future in zip(items,futures):
            row=None
            if future in done:
                try: row=future.result()
                except Exception: pass
            if row is None:
                future.cancel();row=self._row(item,cached_only=True)
            result.append(row.quote or Quote(instrument_key=item.key,meta=ObservationMeta(source='正式净值不是报价',fetched_at=self.now(),status='missing')))
        return result

    def series(self,key,period,range_,refresh=False):
        item=self.catalog.resolve(key)
        if item is None: raise KeyError(key)
        live=self.cache.get('yahoo',key,'bars',Series,lambda:self.bars.series(item,period,range_,self.now()),refresh=refresh,period=period,range_=range_,adjustment='split_adjusted')
        if live: return live
        return Series(instrument_key=key,currency=item.currency,period=period,range=range_,timezone=item.timezone,meta=ObservationMeta(source='Yahoo Finance',fetched_at=self.now(),status='missing',reason='无真实 K 线缓存'))
