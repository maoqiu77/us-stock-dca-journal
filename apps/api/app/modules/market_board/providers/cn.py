from __future__ import annotations
from datetime import datetime
import json
from decimal import Decimal
from zoneinfo import ZoneInfo
import re
from datetime import timedelta
from .us import number
from ..models import Instrument, Quote, ObservationMeta, ObservationStatus

def tencent_record(http,item,now):
    if item.market.value!='CN' or item.exchange not in ('XSHG','XSHE'):raise ValueError('unsupported identity')
    identity=('sh' if item.exchange=='XSHG' else 'sz')+item.symbol
    text=http.get('https://qt.gtimg.cn/q='+identity,referer='https://gu.qq.com/').decode('gb18030')
    match=re.search(r'v_'+re.escape(identity)+r'="([^"]*)";',text)
    values=match.group(1).split('~') if match else []
    if len(values)<83 or values[2]!=item.symbol or values[82]!='CNY':raise ValueError('Tencent identity mismatch')
    observed=datetime.strptime(values[30],'%Y%m%d%H%M%S').replace(tzinfo=ZoneInfo('Asia/Shanghai'))
    price=number(values[3])
    if observed>now+timedelta(seconds=60) or price is None or price<=0:raise ValueError('invalid observation')
    return values,observed

class CNProvider:
    def __init__(self, http): self.http = http
    def tencent(self,item,now):
        values,observed=tencent_record(self.http,item,now)
        return Quote(instrument_key=item.key,price=values[3],previous_close=number(values[4]),change=number(values[31]),change_pct=number(values[32]),trading_date=observed.date(),session='unknown',meta=ObservationMeta(source='腾讯财经',as_of=observed,fetched_at=now,status='stale' if now-observed>timedelta(days=4) else 'partial',timeliness='unknown',reason='公开参考行情；时段与延迟未知，未猜测成交量单位'))
    def quotes(self, instruments: list[Instrument], now: datetime) -> list[Quote]:
        if not instruments:
            return []
        secids = ",".join(f"{1 if item.exchange == 'XSHG' else 0}.{item.symbol}" for item in instruments)
        try:
            payload = json.loads(self.http.get(f"https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids={secids}&fltt=2&fields=f12,f13,f14,f2,f3,f4,f124", referer="https://quote.eastmoney.com/").decode("utf-8"))
            values = payload.get("data", {}).get("diff", [])
        except Exception:
            values = []
        result = []
        for item in instruments:
            row = next((value for value in values if value.get("f12") == item.symbol and value.get("f13") == (1 if item.exchange == "XSHG" else 0)), None)
            observed = datetime.fromtimestamp(row["f124"], tz=now.tzinfo) if row and isinstance(row.get("f124"), (int, float)) else None
            valid = row is not None and observed is not None and observed <= now.replace(tzinfo=now.tzinfo) + __import__("datetime").timedelta(seconds=60) and isinstance(row.get("f2"), (int, float)) and row["f2"] > 0
            result.append(Quote(instrument_key=item.key, price=Decimal(str(row["f2"])) if valid else None, change=Decimal(str(row["f4"])) if valid and isinstance(row.get("f4"), (int, float)) else None, change_pct=Decimal(str(row["f3"])) if valid and isinstance(row.get("f3"), (int, float)) else None, trading_date=observed.date() if valid else None, session="unknown", meta=ObservationMeta(source="东方财富公开行情", fetched_at=now, as_of=observed, status=ObservationStatus.AVAILABLE if valid else ObservationStatus.MISSING, timeliness="delayed" if valid else "unknown", reason=None if valid else "未取得可核实报价")))
        return result
