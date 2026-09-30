from __future__ import annotations
import json
from datetime import datetime, timezone, timedelta
from .us import number
from .cn import tencent_record
from ..models import EtfMetrics, ObservationMeta, ReferenceValue, Quote

class EtfProvider:
    def __init__(self,http): self.http=http
    def tencent(self,item,now):
        values,observed=tencent_record(self.http,item,now)
        reference=number(values[78]);premium=number(values[77]);shares=number(values[72])
        reference=reference if reference is not None and reference>0 else None
        meta=ObservationMeta(source='腾讯财经 ETF 参考',fetched_at=now,as_of=observed,status='partial',timeliness='unknown',reason='供应商参考值估值时点及原始份额字段披露日未知；非实时 NAV/IOPV，独立交易所份额报告另行核实')
        return EtfMetrics(reference_value=reference,vendor_reference=ReferenceValue(value=reference,meta=meta) if reference else None,premium_pct=premium if reference else None,premium_basis='vendor_reference' if reference else 'unknown',basis_id='tencent:field77:v1',shares=shares if shares is not None and shares>=0 else None,shares_meta=meta,meta=meta)
    def metrics(self,instruments,now):
        result={}
        for item in instruments:
            try:
                market=1 if item.exchange=='XSHG' else 0
                payload=json.loads(self.http.get(f'https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids={market}.{item.symbol}&fltt=2&fields=f12,f13,f14,f2,f38,f124,f441,f402',referer='https://quote.eastmoney.com/'))
                row=next(v for v in payload['data']['diff'] if v.get('f12')==item.symbol and v.get('f13')==market)
                observed=datetime.fromtimestamp(row['f124'],timezone.utc)
                if observed > now+timedelta(seconds=60) or number(row.get('f2')) is None:
                    raise ValueError('invalid observation')
                meta=ObservationMeta(source='东方财富 ETF 行情',fetched_at=now,as_of=observed,status='partial',timeliness='unknown',reason='供应商参考值时点与原始份额字段披露日未知；非同步 NAV/IOPV，不能计算实时溢价；独立交易所份额报告另行核实')
                reference=number(row.get('f441'))
                reference=reference if reference is not None and reference > 0 else None
                discount=number(row.get('f402'))
                shares=number(row.get('f38'))
                result[item.key]=EtfMetrics(premium_pct=-discount if discount is not None and reference else None,premium_basis='vendor_reference' if reference else 'unknown',basis_id='eastmoney:f402:negated:v1',reference_value=reference,reference_date=None,vendor_reference=ReferenceValue(value=reference,meta=meta) if reference else None,shares=shares if shares is not None and shares>=0 else None,shares_date=None,shares_meta=meta,meta=meta)
            except Exception:
                result[item.key]=EtfMetrics(meta=ObservationMeta(source='东方财富 ETF 行情',fetched_at=now,status='missing',reason='未取得可核实参考值'))
        return result
    def benchmarks(self,now):
        definitions=[('SPX','标普500','index',100),('NDX100','纳斯达克100','index',100),('NQ00Y','小型纳指期货','future',103)]
        try:
            payload=json.loads(self.http.get('https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=100.SPX,100.NDX100,103.NQ00Y&fltt=2&fields=f12,f13,f2,f3,f4,f124',referer='https://quote.eastmoney.com/'))
            values=payload['data']['diff']
        except Exception:
            values=[]
        result=[]
        for symbol,name,kind,market in definitions:
            q=Quote(instrument_key=symbol,meta=ObservationMeta(source='东方财富基准行情',fetched_at=now,status='missing',reason='基准暂不可用'))
            try:
                row=next(v for v in values if v.get('f12')==symbol and v.get('f13')==market)
                observed=datetime.fromtimestamp(row['f124'],timezone.utc)
                price=number(row.get('f2'))
                if price is not None and price>0 and observed<=now+timedelta(seconds=60):
                    q=Quote(instrument_key=symbol,price=price,change=number(row.get('f4')),change_pct=number(row.get('f3')),meta=ObservationMeta(source='东方财富基准行情',fetched_at=now,as_of=observed,status='partial',timeliness='unknown'))
            except Exception:
                pass
            result.append(dict(symbol=symbol,name=name,kind=kind,quote=q.model_dump(mode='json')))
        return result
