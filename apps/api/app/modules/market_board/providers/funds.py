from __future__ import annotations
from datetime import datetime
from zoneinfo import ZoneInfo
from decimal import Decimal
import re, json
from html import unescape
from ..models import FundHoldings, Nav, ObservationMeta, PurchaseLimit
from .fund_parsers import parse_nav_trend, parse_purchase_state, parse_holdings, parse_asset_allocation

class FundProvider:
    def __init__(self,http=None): self.http=http
    def script(self,instrument):
        text=self.http.get(f'https://fund.eastmoney.com/pingzhongdata/{instrument.symbol}.js',referer='https://fund.eastmoney.com/').decode('utf-8-sig','replace')
        code=re.search(r'var\s+fS_code\s*=\s*["\'](\d{6})["\']',text)
        if not code or code.group(1)!=instrument.symbol:
            raise ValueError('fund identity mismatch')
        return text
    def nav(self,instrument,now):
        try:
            row=parse_nav_trend(self.script(instrument),now)
            if row:
                return Nav(value=Decimal(row['nav']),change_pct=Decimal(row['change_pct']) if row['change_pct'] is not None else None,nav_date=row['date'],meta=ObservationMeta(source='东方财富正式净值档案',fetched_at=now,as_of=datetime.fromisoformat(row['date']).replace(tzinfo=ZoneInfo('Asia/Shanghai')),timeliness='eod'))
        except Exception:
            pass
        return Nav(meta=ObservationMeta(source='东方财富正式净值档案',fetched_at=now,status='missing',reason='未取得正式净值'))
    def purchase_limit(self,instrument,now):
        try:
            text=self.http.get(f'https://fund.eastmoney.com/{instrument.symbol}.html',referer='https://fund.eastmoney.com/').decode('utf-8-sig','replace')
            # Only the product trade-status section; ignore advertising limits and navigation.
            section=re.search(r'交易状态[：:]?.{0,2000}?(?=</div>)',text,re.S)
            plain=unescape(re.sub('<[^>]+>','',section.group(0))) if section else ''
            state,amount=parse_purchase_state(plain)
            return PurchaseLimit(state=state,amount=amount,channel='eastmoney',meta=ObservationMeta(source='天天基金销售页',fetched_at=now,status='available' if state!='unknown' else 'missing',timeliness='unknown',reason='限额仅适用于天天基金渠道，不代表其他平台'))
        except Exception:
            return PurchaseLimit(state='unknown',channel='eastmoney',meta=ObservationMeta(source='天天基金销售页',fetched_at=now,status='missing',reason='渠道信息不可用'))
    def holdings(self,instrument,now):
        try:
            raw=self.http.get(f'https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={instrument.symbol}&topline=10',referer=f'https://fundf10.eastmoney.com/ccmx_{instrument.symbol}.html').decode('utf-8-sig','replace')
            match=re.search(r'content:\s*("(?:\\.|[^"\\])*")',raw)
            text=json.loads(match.group(1)) if match else raw
            parsed=parse_holdings(text,now,instrument.key)
            return FundHoldings(**parsed,meta=ObservationMeta(source='天天基金季度持仓披露',fetched_at=now,status='available' if parsed['stocks'] else 'missing',timeliness='eod'))
        except Exception:
            return FundHoldings(instrument_key=instrument.key,meta=ObservationMeta(source='天天基金季度持仓披露',fetched_at=now,status='missing',reason='前十重仓披露不可用'))
    def allocation(self,instrument,now):
        try:
            allocation=parse_asset_allocation(self.script(instrument),now)
            return FundHoldings(instrument_key=instrument.key,allocation=allocation,meta=ObservationMeta(source='东方财富资产配置披露',fetched_at=now,status='available' if allocation else 'missing',timeliness='eod'))
        except Exception:
            return FundHoldings(instrument_key=instrument.key,meta=ObservationMeta(source='东方财富资产配置披露',fetched_at=now,status='missing',reason='资产配置披露不可用'))
