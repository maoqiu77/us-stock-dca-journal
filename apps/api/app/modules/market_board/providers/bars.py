from __future__ import annotations
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from .us import yahoo_chart
from ..models import Bar, ObservationMeta, Series

class BarsProvider:
    def __init__(self,http): self.http=http
    def series(self,instrument,period,range_,now):
        args=dict(instrument_key=instrument.key,currency=instrument.currency,period=period,range=range_,timezone=instrument.timezone,adjustment='split_adjusted',volume_unit='shares',time_label='exchange_session_date')
        try:
            if instrument.market.value != 'US' or period != '1d' or range_ not in ('1mo','3mo','1y'):
                raise ValueError('unsupported period')
            result=yahoo_chart(self.http,instrument.symbol,range_)
            if result['meta'].get('exchangeTimezoneName') != 'America/New_York':
                raise ValueError('timezone mismatch')
            prices=result['indicators']['quote'][0]
            bars=[]
            zone=ZoneInfo(instrument.timezone)
            for index,stamp in enumerate(result.get('timestamp',[])):
                instant=datetime.fromtimestamp(stamp,timezone.utc)
                if instant > now + timedelta(seconds=60):
                    raise ValueError('future bar')
                values={key:prices.get(key,[])[index] if index<len(prices.get(key,[])) else None for key in ('open','high','low','close','volume')}
                if any(values[key] is None for key in ('open','high','low','close')):
                    continue
                day=instant.astimezone(zone).date()
                # On the current day, finality needs explicit provider session-end evidence.
                end=result['meta'].get('currentTradingPeriod',{}).get('regular',{}).get('end')
                final=day < now.astimezone(zone).date() or bool(end and now.timestamp() >= end)
                bars.append(Bar(time=instant,trading_date=day,is_final=final,**values))
            if not bars or len({bar.trading_date for bar in bars}) != len(bars):
                raise ValueError('empty or duplicate daily bars')
            return Series(**args,bars=bars,meta=ObservationMeta(source='Yahoo Finance',fetched_at=now,as_of=bars[-1].time,status='available',timeliness='eod',reason='拆股调整 OHLC；未使用股息调整收盘价；当前日线可能未收盘'))
        except Exception:
            return Series(**args,bars=[],meta=ObservationMeta(source='Yahoo Finance',fetched_at=now,status='missing',reason='日 K 暂不可用或周期不支持'))
