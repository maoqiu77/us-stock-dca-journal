from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
import os
import sys
import json, re
from .models import AssetType, Instrument, Market, Segment
from .http import PublicHttp
from .cache import cache_key,cache_window

_bundle_root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[5]))
TEMPLATE = Path(os.getenv('STOCK_APP_TEMPLATE_HOME', str(_bundle_root / 'storage/templates'))) / 'market-board-instruments.example.json'

def default_instruments():
    data=json.loads(TEMPLATE.read_text())
    defaults={segment:[] for segment in Segment}
    for market,rows in [('US',data['us']),('CN',data['cn'])]:
        for row in rows:
            item=Instrument(key=f"{market}:{row['exchange']}:{row['symbol']}:{row['asset_type']}",market=market,currency='USD' if market=='US' else 'CNY',timezone='America/New_York' if market=='US' else 'Asia/Shanghai',verified_at=data['verified_at'],**row)
            defaults[Segment.US if market=='US' else Segment.FUND if item.asset_type is AssetType.FUND else Segment.ETF].append(item)
    return defaults

class InstrumentCatalog:
    def __init__(self,store,http=None):
        self.store=store
        self.http=http or PublicHttp()
        self.defaults=default_instruments()
        self.store.save_instruments([item for items in self.defaults.values() for item in items])
        self.store.ensure_initialized(self.defaults)
        self._expand_legacy_defaults()

    def _expand_legacy_defaults(self):
        """Upgrade only the untouched original seed; never replace a user's edits."""
        legacy = {
            Segment.US: [f'US:{exchange}:{symbol}:{kind}' for symbol,exchange,kind in (
                ('AAPL','XNAS','STOCK'),('MSFT','XNAS','STOCK'),('NVDA','XNAS','STOCK'),
                ('AMZN','XNAS','STOCK'),('GOOGL','XNAS','STOCK'),('TSLA','XNAS','STOCK'),
                ('SPY','ARCX','ETF'),('QQQ','XNAS','ETF'),('DIA','ARCX','ETF'),('IWM','ARCX','ETF'))]
                + [f'US:XNAS:DEMO{i:02d}:STOCK' for i in range(1,22)],
            Segment.ETF: ['CN:XSHG:513100:ETF','CN:XSHE:159501:ETF','CN:XSHG:510300:ETF'],
            Segment.FUND: ['CN:FUND:016701:FUND','CN:FUND:000001:FUND'],
        }
        for segment, items in self.defaults.items():
            selection = self.store.get_selection(segment)
            keys = [item.key for item in selection.items]
            if selection.revision != 0 or keys != legacy[segment]:
                continue
            merged = [item.key for item in items]
            self.store.replace_selection(segment, merged, selection.revision)
    def resolve(self,key): return self.store.get_instrument(key)
    def search(self,query,market,asset_type=None,limit=20):
        needle=query.strip().upper()
        suffix=None
        match=re.fullmatch(r'(.+)\.(SH|SS|SZ|OF|US)',needle)
        if match:
            needle=match.group(1); suffix={'SH':'XSHG','SS':'XSHG','SZ':'XSHE','OF':'FUND','US':None}[match.group(2)]
        rows=[item for group in self.defaults.values() for item in group]
        local=[item for item in rows if item.market.value==market and (not asset_type or item.asset_type.value==asset_type) and (suffix is None or item.exchange==suffix) and (needle in item.symbol.upper() or needle in item.name.upper())]
        # Supplement the curated directory only with explicit exchange/type evidence.
        if asset_type!='FUND' and len(local)<limit:
            try:
                url='https://searchapi.eastmoney.com/api/suggest/get?'+urlencode(dict(input=needle,type=14,count=limit))
                key=cache_key('eastmoney:suggest',market+':'+str(asset_type)+':'+needle,'catalog')
                cached=self.store.read_cache(key)
                now=datetime.now(timezone.utc)
                if cached and datetime.fromisoformat(cached['expires_at'])>now:
                    payload=cached['data']
                else:
                    payload=json.loads(self.http.get(url))
                    expires,retain=cache_window('catalog',now)
                    self.store.write_cache(key,{'data':payload},expires,retain)
                for row in payload['QuotationCodeTable']['Data']:
                    if market=='US':
                        if row.get('Classify')!='UsStock' or row.get('TypeUS') not in ('1','5'):continue
                        exchange='XNAS' if row.get('JYS')=='NASDAQ' and row.get('MktNum')=='105' else 'XNYS' if row.get('JYS')=='NYSE' and row.get('MktNum')=='106' else 'ARCX' if row.get('JYS')=='AMEX' and row.get('MktNum')=='107' and row.get('TypeUS')=='5' else None
                        symbol=row.get('Code','');kind='ETF' if row['TypeUS']=='5' else 'STOCK'
                        if not exchange or not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}',symbol) or row.get('QuoteID')!=row['MktNum']+'.'+symbol or (asset_type and asset_type!=kind):continue
                        item=Instrument(key=f'US:{exchange}:{symbol}:{kind}',symbol=symbol,name=row['Name'],market='US',exchange=exchange,asset_type=kind,currency='USD',timezone='America/New_York',verified_at=now)
                        if item.key not in {v.key for v in local}:local.append(item)
                        continue
                    exchange={'1':'XSHG','0':'XSHE'}.get(str(row.get('MktNum')))
                    symbol=row.get('Code',''); name=row.get('Name','')
                    kind='ETF' if str(row.get('SecurityType'))=='8' and 'ETF' in name and '联接' not in name else 'STOCK' if str(row.get('SecurityType'))=='1' else None
                    if not exchange or not kind or not re.fullmatch(r'\d{6}',symbol) or row.get('QuoteID')!=str(row.get('MktNum'))+'.'+symbol or (asset_type and kind!=asset_type) or (suffix and suffix!=exchange): continue
                    item=Instrument(key=f'CN:{exchange}:{symbol}:{kind}',symbol=symbol,name=name,market='CN',exchange=exchange,asset_type=kind,currency='CNY',timezone='Asia/Shanghai',verified_at=datetime.now(timezone.utc))
                    if item.key not in {v.key for v in local}: local.append(item)
            except Exception:
                pass
        self.store.save_instruments(local)
        return local[:limit]
