from __future__ import annotations
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
from ..models import SharesObservation, ObservationMeta, TradingDates
from ..metrics import shares_delta


def sz_report(http, symbol, through, count=3):
    start=through-timedelta(days=120 if count==60 else 14)
    dates=[]; total=None
    for page in range(1,4 if count==60 else 2):
        params=dict(SHOWTYPE='JSON',CATALOGID='scsj_fund_jjgm',TABKEY='tab1',txtStart=start.isoformat(),txtEnd=through.isoformat(),jjlb='ETF',txtDm=symbol,PAGENO=page)
        payload=json.loads(http.get('https://www.szse.cn/api/report/ShowReport/data?'+urlencode(params),referer='https://www.szse.cn/market/fund/volume/etf/index.html'))
        report=next(v for v in payload if v.get('metadata',{}).get('tabkey')=='tab1')
        meta=report['metadata']; rows=report['data']
        if int(meta['pageno'])!=page or int(meta['pagesize'])!=20:
            raise ValueError('incomplete pagination')
        total=int(meta['recordcount']) if total is None else total
        if int(meta['recordcount'])!=total or len(rows)!=min(20,max(0,total-(page-1)*20)):
            raise ValueError('incomplete exchange report')
        for row in rows:
            day=date.fromisoformat(row['size_date'])
            if str(row['fund_code']).strip()!=symbol or not start<=day<=through:
                raise ValueError('report identity/date mismatch')
            amount=Decimal(str(row['current_size']).replace(',',''))*10000
            if not amount.is_finite() or amount<0:
                raise ValueError('invalid shares')
            dates.append((day.isoformat(),str(amount)))
        if len(dates)>=count: break
    if len({d for d,_ in dates})!=len(dates) or [d for d,_ in dates]!=sorted([d for d,_ in dates],reverse=True):
        raise ValueError('duplicate or unordered report')
    if count==60 and len(dates)<60: raise ValueError('calendar incomplete')
    return dates[:count] if count==60 else dates


class SharesProvider:
    def __init__(self,http,cache=None): self.http,self.cache=http,cache
    def calendar(self,now,count=3):
        # T-evening values are provisional. Only earlier disclosure dates are eligible.
        through=now.astimezone(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)
        def fetch():
            rows=sz_report(self.http,'159501',through,count)
            return TradingDates(dates=sorted(d for d,_ in rows),meta=ObservationMeta(source='深圳证券交易所完整披露日期',fetched_at=now,timeliness='eod'))
        value=self.cache.get('szse:calendar',str(through)+':'+str(count),'trading_dates',TradingDates,fetch) if self.cache else fetch()
        return value.dates if value else []
    def shares(self,item,now):
        source='深圳证券交易所' if item.exchange=='XSHE' else '上海证券交易所'
        try:
            dates=self.calendar(now)
            if len(dates)<2: raise ValueError('calendar unavailable')
            rows=[]
            if item.exchange=='XSHE':
                rows=sz_report(self.http,item.symbol,date.fromisoformat(dates[-1]))
            else:
                for day in dates[-2:]:
                    params={'isPagination':'true','pageHelp.pageSize':'10000','pageHelp.pageNo':'1','sqlId':'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L','STAT_DATE':day}
                    payload=json.loads(self.http.get('https://query.sse.com.cn/commonQuery.do?'+urlencode(params),referer='https://www.sse.com.cn/'))
                    values=payload['result']; count=payload.get('pageHelp',{}).get('total')
                    if count is None or int(count)!=len(values): raise ValueError('incomplete SSE report')
                    matches=[v for v in values if v.get('SEC_CODE')==item.symbol and v.get('STAT_DATE')==day]
                    if len(matches)==1:
                        amount=Decimal(str(matches[0]['TOT_VOL']).replace(',',''))*10000
                        if amount.is_finite() and amount>=0: rows.append((day,str(amount)))
            rows=sorted((row for row in rows if row[0] in dates),reverse=True)
            if not rows: raise ValueError('no shares')
            current=rows[0]; previous=rows[1] if len(rows)>1 else None
            change=shares_delta(current,previous,dates)
            return SharesObservation(shares=current[1],shares_date=current[0],shares_change=change,previous_shares_date=previous[0] if change is not None else None,meta=ObservationMeta(source=source,fetched_at=now,status='available' if change is not None else 'partial',timeliness='eod',reason='原报告万份 × 10000，底层保留份；仅相邻有效披露日计算变化'))
        except Exception:
            return SharesObservation(meta=ObservationMeta(source=source,fetched_at=now,status='missing',reason='未取得完整份额报告或相邻披露日期证据'))
