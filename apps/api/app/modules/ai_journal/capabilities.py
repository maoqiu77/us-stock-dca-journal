from __future__ import annotations

from app.modules.quant_analysis.sources import resolve_instrument
from .store import fail


def capabilities(board, key, resolver=None):
    item = board.catalog.resolve(key)
    if item is None:
        fail('unknown_instrument', 404)
    quant = False
    if item.market.value == 'US' and item.asset_type.value in ('STOCK', 'ETF'):
        try:
            resolved = (resolver or resolve_instrument)(item.symbol)
            quant = resolved['assetType'] == ('ETF' if item.asset_type.value == 'ETF' else 'EQUITY') and resolved['ticker'] in {item.symbol, item.symbol.replace('.', '-')}
        except Exception:
            pass
    return {
        'instrument': item.model_dump(mode='json'),
        'periods': ['1d'] if item.market.value == 'US' else [],
        'fact_kinds': ['formal_nav', 'purchase_limit', 'disclosure'] if item.asset_type.value == 'FUND' else ['quote', 'etf_reference'] if item.asset_type.value == 'ETF' and item.market.value == 'CN' else ['quote'],
        'period_reason': '仅开放已验证的美股日线；确认前再次检查真实已收盘数据。' if item.market.value == 'US' else '国内 K 线的单位与收盘状态尚未完整验证；仅使用报价或正式净值与披露。',
        'quant_eligible': quant,
        'quant_reason': '现有量化解析器已核实美国身份。' if quant else '现有量化解析器未核实可用能力，暂不开放。',
    }
