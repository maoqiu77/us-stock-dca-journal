const { service, showError } = require('../../lib/core');
const numberValue = value => { const parsed = Number(String(value ?? '').replace(/,/g, '').trim()); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; };
const currencyMarket = currency => currency === 'CNY' ? 'CN' : 'US';
function request(page) { return { batchId: page._batchId, expectedRevision: page.data.expectedRevision, observedAt: page._observedAt, instrument: { symbol: page.data.symbol, name: page.data.name, market: currencyMarket(page.data.currency), currency: page.data.currency, assetType: page.data.assetType, status: page.data.status, instrumentKey: page.data.instrumentKey || undefined }, quantity: page.data.quantity, unitCost: page.data.unitCost, replaceApproved: !!page.data.existing }; }
function currencyIndex(currency) { return currency === 'CNY' ? 1 : 0; }
Page({
  data: { error: '', expectedRevision: 0, symbol: '', name: '', market: 'US', currency: 'USD', currencyOptions: ['USD', 'CNY'], currencyIndex: 0, assetType: 'ETF', status: 'unverified', instrumentKey: '', quantity: '', unitCost: '', pnlMode: 'profit', pnlModeIndex: 0, pnlModes: ['盈利', '亏损'], pnlPercent: '', marketPrice: '', existing: null, costSuggestion: null, candidates: [], searching: false, previewData: null, saving: false, pendingSave: false },
  onLoad(options = {}) {
    if (options.key) { const item = [...service.marketDiscovery().results, ...service.marketDiscovery().watchlist, ...(service.marketDiscovery().domestic || []).map(row => row.instrument)].find(item => item.instrument_key === decodeURIComponent(options.key)); if (item) this.setData({ symbol: item.symbol, name: item.name, market: item.market, currency: item.currency, assetType: item.asset_type, status: 'verified', instrumentKey: item.instrument_key }); }
    this._batchId = `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; this._observedAt = new Date().toISOString();
    try { const snapshot = service.snapshot(); const views = ['CNY', 'USD'].flatMap(currency => { try { return service.overview(undefined, currency).positions || []; } catch (_) { return []; } }); const existing = views.find(item => options.id ? item.id === options.id : item.symbol === String(options.symbol || this.data.symbol || '').toUpperCase() && item.market === this.data.market && item.currency === this.data.currency) || null; const costSuggestion = existing && service.suggestHoldingCost ? service.suggestHoldingCost(existing.id) : null; const currency = existing?.currency || this.data.currency; const marketPrice = existing?.marketPrice || this.findMarketPrice(existing?.symbol || this.data.symbol, currency); this.setData({ expectedRevision: snapshot.revision, existing, costSuggestion, currency, market: currencyMarket(currency), currencyIndex: currencyIndex(currency), marketPrice: marketPrice || '', ...(existing ? { symbol: existing.symbol, name: existing.name, assetType: existing.assetType, status: existing.status, quantity: existing.quantity, unitCost: existing.unitCost || '' } : {}) }); this.recalculateCostPnl(); } catch (e) { this.setData({ error: e.message }); }
  },
  findMarketPrice(symbol, currency = this.data.currency) {
    const normalized = String(symbol || '').trim().toUpperCase(); if (!normalized) return '';
    try {
      const positions = service.overview(undefined, currency).positions || [], held = positions.find(item => item.symbol === normalized && item.currency === currency);
      if (held?.marketPrice) return String(held.marketPrice);
    } catch (_) { /* A new holding has no overview row yet. */ }
    try {
      const discovery = service.marketDiscovery ? service.marketDiscovery() : { results: [], watchlist: [], domestic: [] };
      const domestic = (discovery.domestic || []).find(row => row.instrument?.symbol === normalized && row.instrument?.currency === currency);
      if (domestic) return String(domestic.nav || domestic.price || '');
      const candidate = [...(discovery.results || []), ...(discovery.watchlist || [])].find(item => item.symbol === normalized && item.currency === currency);
      const quote = candidate && service.boardQuote ? service.boardQuote(candidate) : null;
      return quote?.priceText && quote.priceText !== '--' ? String(quote.priceText) : '';
    } catch (_) { return ''; }
  },
  recalculateCostPnl(changedField) {
    const marketPrice = numberValue(this.data.marketPrice), cost = numberValue(this.data.unitCost), percent = numberValue(this.data.pnlPercent);
    if (!marketPrice) return;
    if (changedField === 'unitCost' && cost) {
      const delta = marketPrice - cost; this.setData({ pnlMode: delta >= 0 ? 'profit' : 'loss', pnlModeIndex: delta >= 0 ? 0 : 1, pnlPercent: String(Number((Math.abs(delta) / cost * 100).toFixed(2))) });
      return;
    }
    if (changedField === 'pnlPercent' && percent !== null) {
      const denominator = 1 + (this.data.pnlMode === 'profit' ? 1 : -1) * percent / 100;
      if (denominator > 0) this.setData({ unitCost: String(Number((marketPrice / denominator).toFixed(4))) });
      return;
    }
    if (cost && percent === null) {
      const delta = marketPrice - cost; this.setData({ pnlMode: delta >= 0 ? 'profit' : 'loss', pnlModeIndex: delta >= 0 ? 0 : 1, pnlPercent: String(Number((Math.abs(delta) / cost * 100).toFixed(2))) });
    } else if (!cost && percent !== null) {
      const denominator = 1 + (this.data.pnlMode === 'profit' ? 1 : -1) * percent / 100;
      if (denominator > 0) this.setData({ unitCost: String(Number((marketPrice / denominator).toFixed(4))) });
    }
  },
  async deleteHolding() {
    const existing = this.data.existing;
    if (!existing || this.data.saving || this.data.pendingSave) return;
    this.setData({ saving: true, error: '' });
    try {
      // Use the original holding, never the unsaved identity fields in the editor.
      const input = { batchId: this._deleteBatchId || (this._deleteBatchId = `remove_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`), expectedRevision: this.data.expectedRevision, observedAt: this._deleteObservedAt || (this._deleteObservedAt = new Date().toISOString()), instrument: { symbol: existing.symbol, name: existing.name, market: existing.market, currency: existing.currency, assetType: existing.assetType, status: existing.status }, quantity: '0', unitCost: existing.unitCost || '', replaceApproved: true };
      const preview = service.previewHolding(input);
      const confirmed = await new Promise(resolve => wx.showModal({ title: '删除这项持仓？', content: `${existing.name || existing.symbol}（${existing.symbol}）将从当前持仓移除，历史交易保留。以后可重新添加。`, confirmText: '删除持仓', confirmColor: '#b43e36', success: result => resolve(!!result.confirm), fail: () => resolve(false) }));
      if (!confirmed) { this.setData({ saving: false }); return; }
      service.saveHolding({ ...input, contentToken: preview.contentToken });
      wx.showToast({ title: '持仓已删除', icon: 'success' });
      wx.switchTab({ url: '/pages/overview/index' });
    } catch (e) { this.setData({ saving: false, error: e.message }); showError(e); }
  },
  invalidate(update) { if (this.data.saving) return; this._token = ''; this.setData({ ...update, previewData: null, error: '' }); },
  onField(event) { const field = event.currentTarget.dataset.field; if (!['symbol', 'name', 'quantity', 'unitCost', 'pnlPercent'].includes(field)) return; const value = event.detail.value; this.invalidate({ [field]: value, ...(field === 'symbol' ? { status: 'unverified', instrumentKey: '', candidates: [] } : {}) }); if (field === 'symbol') this.setData({ marketPrice: this.findMarketPrice(value) }); if (field === 'unitCost' || field === 'pnlPercent') this.recalculateCostPnl(field); },
  onCurrency(event) { const index = Number(event.detail.value), currency = this.data.currencyOptions[index]; if (!currency) return; const marketPrice = this.findMarketPrice(this.data.symbol, currency); this.invalidate({ currency, currencyIndex: index, market: currencyMarket(currency), marketPrice, status: 'unverified', instrumentKey: '', candidates: [] }); this.recalculateCostPnl(); },
  onPnlMode(event) { const index = Number(event.detail.value); this.invalidate({ pnlModeIndex: index, pnlMode: index === 1 ? 'loss' : 'profit' }); if (this.data.pnlPercent) this.recalculateCostPnl('pnlPercent'); },
  fillCost() { const suggestion = this.data.costSuggestion, existing = this.data.existing; if (!suggestion || !existing || this.data.unitCost || this.data.saving || this.data.pendingSave) return; if (String(this.data.quantity).replaceAll(',', '') !== suggestion.quantity || this.data.symbol !== existing.symbol || this.data.market !== existing.market || this.data.currency !== existing.currency || this.data.assetType !== existing.assetType) { this.setData({ error: '持仓信息已变化，请重新打开校准页后计算成本。' }); return; } this.invalidate({ unitCost: suggestion.unitCost }); this.recalculateCostPnl('unitCost'); },
  onType(event) { const assetType = event.currentTarget.dataset.type, currency = assetType === 'FUND' ? 'CNY' : this.data.currency, marketPrice = this.findMarketPrice(this.data.symbol, currency); this.invalidate({ assetType, currency, currencyIndex: currencyIndex(currency), market: currencyMarket(currency), marketPrice, status: 'unverified', instrumentKey: '', candidates: [] }); this.recalculateCostPnl(); },
  async searchAsset() { if (this.data.symbol.trim().length < 2) { this.setData({ error: '请输入至少两个字符；也可以继续手动填写。' }); return; } this.setData({ searching: true }); try { const candidates = await service.searchMarket(this.data.symbol); this.setData({ candidates, error: candidates.length ? '' : '没有唯一匹配，可继续手动填写并保存为未核实标的。' }); } catch (e) { this.setData({ candidates: [], error: '标的搜索暂不可用，可继续手动填写。' }); } finally { this.setData({ searching: false }); } },
  async pickAsset(event) { const item = this.data.candidates[Number(event.currentTarget.dataset.index)]; if (!item) return; this.invalidate({ symbol: item.symbol, name: item.name, market: item.market, currency: item.currency, currencyIndex: currencyIndex(item.currency), assetType: item.asset_type, marketPrice: this.findMarketPrice(item.symbol, item.currency), status: 'verified', instrumentKey: item.instrument_key, candidates: [] }); try { await service.refreshDetailQuote?.(item); } catch (_) { /* Cached price remains a valid optional hint. */ } if (this.data.symbol === item.symbol) { this.setData({ marketPrice: this.findMarketPrice(item.symbol, item.currency) }); this.recalculateCostPnl(); } },
  preview() { if (this.data.saving) return; try { const result = service.previewHolding(request(this)); this._token = result.contentToken; const { contentToken, ...previewData } = result; this.setData({ previewData, error: '' }); } catch (e) { this._token = ''; this.setData({ previewData: null, error: e.message }); showError(e); } },
  submit() { if (this.data.saving || !this.data.previewData) return; this.setData({ saving: true }); try { service.saveHolding({ ...request(this), contentToken: this._token }); wx.showToast({ title: '持仓已保存', icon: 'success' }); wx.navigateBack({ fail: () => {} }); } catch (e) { this.setData({ saving: false, error: e.message }); showError(e); } },
});
