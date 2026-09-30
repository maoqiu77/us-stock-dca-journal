from __future__ import annotations
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from decimal import Decimal
from urllib.parse import quote
import json
import re
from ..models import Quote, ObservationMeta


def number(value):
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except Exception:
        return None


def yahoo_chart(http, symbol, range_):
    payload = json.loads(http.get(f'https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe="")}?range={range_}&interval=1d', referer='https://finance.yahoo.com/'))
    result = payload['chart']['result'][0]
    if result['meta'].get('symbol') != symbol or result['meta'].get('currency') != 'USD':
        raise ValueError('provider identity mismatch')
    return result


def yahoo_quote(item, result, now):
    meta = result['meta']
    observed = datetime.fromtimestamp(meta['regularMarketTime'], timezone.utc)
    if observed > now + timedelta(seconds=60):
        raise ValueError('future observation')
    price = number(meta.get('regularMarketPrice'))
    if price is None or price <= 0:
        raise ValueError('no quote')
    zone = ZoneInfo('America/New_York')
    day = observed.astimezone(zone).date()
    previous = None
    closes = result.get('indicators',{}).get('quote',[{}])[0].get('close',[])
    for timestamp, close in zip(result.get('timestamp',[]),closes):
        if datetime.fromtimestamp(timestamp,zone).date() < day and number(close) is not None:
            previous = number(close)
    # chartPreviousClose/previousClose can be the start of a multi-day range, not yesterday.
    change = price-previous if previous is not None else None
    session = 'unknown'
    periods = meta.get('currentTradingPeriod',{})
    for kind in ('pre','regular','post'):
        bounds=periods.get(kind,{})
        if bounds.get('start',float('inf')) <= now.timestamp() < bounds.get('end',0):
            session=kind
    if periods.get('post',{}).get('end',float('inf')) <= now.timestamp() and now.astimezone(zone).date() == datetime.fromtimestamp(periods['post']['end'],zone).date():
        session='closed'
    # regularMarketPrice is a regular-session observation, never claim it is a pre/post quote.
    reason = '常规时段最后成交；当前市场'+session+'，非盘前/盘后成交价' if session in ('pre','post') else None
    status = 'stale' if now-observed > timedelta(days=4) else 'partial' if session == 'unknown' or previous is None or reason else 'available'
    return Quote(instrument_key=item.key,price=price,previous_close=previous,change=change,change_pct=change/previous*100 if previous and change is not None else None,volume=number(meta.get('regularMarketVolume')),volume_unit='shares',trading_date=day,session=session,meta=ObservationMeta(source='Yahoo Finance',as_of=observed,fetched_at=now,status=status,timeliness='delayed',reason=reason))


class USProvider:
    def __init__(self,http): self.http=http
    def quotes(self,instruments,now):
        rows=[]
        for item in instruments:
            try:
                if item.market.value != 'US' or item.symbol.startswith('DEMO'):
                    raise ValueError('unsupported identity')
                rows.append(yahoo_quote(item,yahoo_chart(self.http,item.symbol,'5d'),now))
            except Exception:
                rows.append(Quote(instrument_key=item.key,meta=ObservationMeta(source='Yahoo Finance',fetched_at=now,status='missing',reason='公开源不可用或身份/时间校验失败')))
        return rows

    def eastmoney(self,item,now):
        """东方财富公开延迟参考行情。

        The endpoint is useful when Yahoo/Nasdaq throttle individual quote
        requests.  It is still treated as indicative data: the provider does
        not claim a trading session or real-time freshness.
        """
        if item.market.value!='US' or item.symbol.startswith('DEMO'):
            raise ValueError('unsupported identity')
        market={'XNAS':105,'XNYS':106,'ARCX':107}.get(item.exchange)
        if market is None:
            raise ValueError('unsupported exchange')
        url=(
            'https://push2delay.eastmoney.com/api/qt/ulist.np/get?'
            f'secids={market}.{quote(item.symbol,safe="")}&fltt=2&'
            'fields=f12,f13,f14,f2,f3,f4,f18,f20,f124'
        )
        payload=json.loads(self.http.get(url,referer='https://quote.eastmoney.com/'))
        rows=(payload.get('data') or {}).get('diff')
        if not isinstance(rows,list):
            raise ValueError('invalid Eastmoney response')
        row=next((value for value in rows if str(value.get('f12'))==item.symbol and int(value.get('f13',-1))==market),None)
        if row is None:
            raise ValueError('quote identity mismatch')
        price=number(row.get('f2')); observed_raw=number(row.get('f124'))
        if price is None or price<=0 or observed_raw is None or observed_raw<=0:
            raise ValueError('no quote')
        observed=datetime.fromtimestamp(float(observed_raw),timezone.utc)
        if observed>now+timedelta(seconds=60):
            raise ValueError('future quote')
        previous=number(row.get('f18'))
        change=number(row.get('f4'))
        if previous is not None and previous<=0: previous=None
        if change is None and previous is not None: change=price-previous
        change_pct=number(row.get('f3'))
        if change_pct is None and previous and change is not None: change_pct=change/previous*100
        return Quote(
            instrument_key=item.key,price=price,previous_close=previous,
            change=change,change_pct=change_pct,volume=None,
            volume_unit='unknown',trading_date=observed.astimezone(ZoneInfo('America/New_York')).date(),
            session='unknown',meta=ObservationMeta(
                source='东方财富公开接口',fetched_at=now,as_of=observed,
                status='stale' if now-observed>timedelta(days=4) else 'available',
                timeliness='unknown',reason='公开参考行情；交易时段与延迟未知'))

    def nasdaq(self,item,now):
        if item.market.value!='US' or item.symbol.startswith('DEMO'):
            raise ValueError('unsupported identity')
        asset='etf' if item.asset_type.value=='ETF' else 'stocks'
        data=json.loads(self.http.get(f'https://api.nasdaq.com/api/quote/{quote(item.symbol,safe="")}/info?assetclass={asset}',referer='https://www.nasdaq.com/'))['data']
        exchange=data.get('exchange','')
        valid_exchange=exchange.startswith('NASDAQ-') if item.exchange=='XNAS' else exchange=='NYSE' if item.exchange=='XNYS' else exchange in ('PSE','NYSE ARCA') if item.exchange=='ARCX' else False
        if data.get('symbol')!=item.symbol or data.get('assetClass')!=asset.upper() or not valid_exchange:
            raise ValueError('Nasdaq identity mismatch')
        primary=data['primaryData']
        raw=primary.get('lastTradeTimestamp','').removeprefix('Closed at ')
        # ET is exchange-local, including daylight saving time for this observation.
        stamp=datetime.strptime(raw,'%b %d, %Y %I:%M %p ET').replace(tzinfo=ZoneInfo('America/New_York'))
        if stamp>now+timedelta(seconds=60): raise ValueError('future quote')
        def parse(value): return number(re.sub(r'[$,%]','',value)) if isinstance(value,str) else None
        price=parse(primary.get('lastSalePrice'))
        if price is None or price<=0 or not str(primary.get('lastSalePrice','')).startswith('$'):
            raise ValueError('invalid USD price')
        change=parse(primary.get('netChange')); volume=parse(primary.get('volume'))
        if volume is not None and (volume<0 or volume!=volume.to_integral_value()):volume=None
        session={'Pre-Market':'pre','Market Open':'regular','Open':'regular','After-Hours':'post','After Hours':'post','Closed':'closed'}.get(data.get('marketStatus'),'unknown')
        previous=price-change if change is not None and price-change>0 else None
        return Quote(instrument_key=item.key,price=price,change=change,change_pct=parse(primary.get('percentageChange')),previous_close=previous,volume=volume,volume_unit='shares',trading_date=stamp.date(),session=session,meta=ObservationMeta(source='Nasdaq',fetched_at=now,as_of=stamp,status='stale' if now-stamp>timedelta(days=4) else 'available',timeliness='unknown',reason='公开报价；交易时段或延迟不承诺，成交量非整数时保留缺失'))

    def tencent(self,item,now):
        if item.market.value!='US' or item.symbol.startswith('DEMO'):raise ValueError('unsupported identity')
        raw=self.http.get(f'https://qt.gtimg.cn/q=us{quote(item.symbol,safe="")}',referer='https://gu.qq.com/').decode('gb18030')
        match=re.search(r'v_us'+re.escape(item.symbol)+r'="([^"]*)";',raw)
        values=match.group(1).split('~') if match else []
        suffix={'XNAS':'OQ','XNYS':'N','ARCX':'AM'}.get(item.exchange)
        if len(values)<37 or values[0]!='200' or values[2]!=item.symbol+'.'+str(suffix) or values[35]!='USD':raise ValueError('Tencent identity mismatch')
        stamp=datetime.strptime(values[30],'%Y-%m-%d %H:%M:%S').replace(tzinfo=ZoneInfo('America/New_York'))
        price=number(values[3])
        if stamp>now+timedelta(seconds=60) or price is None or price<=0:raise ValueError('invalid quote')
        previous=number(values[4]); change=number(values[31]); change_pct=number(values[32])
        return Quote(instrument_key=item.key,price=price,previous_close=previous,change=change,change_pct=change_pct,volume=number(values[36]) if values[36].isdigit() else None,volume_unit='feed_shares',trading_date=stamp.date(),session='unknown',meta=ObservationMeta(source='腾讯财经',fetched_at=now,as_of=stamp,status='stale' if now-stamp>timedelta(days=4) else 'available' if previous is not None and change is not None and change_pct is not None else 'partial',timeliness='unknown',reason='参考行情，交易时段与延迟未知'))
