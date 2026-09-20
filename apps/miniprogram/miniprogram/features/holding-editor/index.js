const { service, showError } = require('../../lib/core');
function request(page) { return { batchId: page._batchId, expectedRevision: page.data.expectedRevision, observedAt: page._observedAt, instrument: { symbol: page.data.symbol, name: page.data.name, market: page.data.market, currency: page.data.currency, assetType: page.data.assetType, status: page.data.status, instrumentKey: page.data.instrumentKey || undefined }, quantity: page.data.quantity, unitCost: page.data.unitCost, replaceApproved: !!page.data.existing }; }
Page({
  data: { error: '', expectedRevision: 0, symbol: '', name: '', market: 'US', currency: 'USD', assetType: 'ETF', status: 'unverified', instrumentKey: '', quantity: '', unitCost: '', existing: null, candidates: [], searching: false, previewData: null, saving: false, pendingSave: false },
  onLoad(options = {}) {
    if (options.key) { const item = [...service.marketDiscovery().results, ...service.marketDiscovery().watchlist, ...(service.marketDiscovery().domestic || []).map(row => row.instrument)].find(item => item.instrument_key === decodeURIComponent(options.key)); if (item) this.setData({ symbol: item.symbol, name: item.name, market: item.market, currency: item.currency, assetType: item.asset_type, status: 'verified', instrumentKey: item.instrument_key }); }
    this._batchId = `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; this._observedAt = new Date().toISOString();
    try { const snapshot = service.snapshot(); const views = ['CNY', 'USD'].flatMap(currency => { try { return service.overview(undefined, currency).positions || []; } catch (_) { return []; } }); const existing = views.find(item => options.id ? item.id === options.id : item.symbol === String(options.symbol || this.data.symbol || '').toUpperCase() && item.market === this.data.market && item.currency === this.data.currency) || null; this.setData({ expectedRevision: snapshot.revision, existing, ...(existing ? { symbol: existing.symbol, name: existing.name, market: existing.market, currency: existing.currency, assetType: existing.assetType, status: existing.status, quantity: existing.quantity, unitCost: existing.unitCost || '' } : {}) }); } catch (e) { this.setData({ error: e.message }); }
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
  onField(event) { const field = event.currentTarget.dataset.field; if (['symbol', 'name', 'market', 'currency', 'quantity', 'unitCost'].includes(field)) this.invalidate({ [field]: event.detail.value, ...(['symbol', 'name', 'market', 'currency'].includes(field) ? { status: 'unverified', instrumentKey: '', candidates: [] } : {}) }); },
  onType(event) { this.invalidate({ assetType: event.currentTarget.dataset.type, status: 'unverified', instrumentKey: '', candidates: [] }); },
  async searchAsset() { if (this.data.symbol.trim().length < 2) { this.setData({ error: '请输入至少两个字符；也可以继续手动填写。' }); return; } this.setData({ searching: true }); try { const candidates = await service.searchMarket(this.data.symbol); this.setData({ candidates, error: candidates.length ? '' : '没有唯一匹配，可继续手动填写并保存为未核实标的。' }); } catch (e) { this.setData({ candidates: [], error: '标的搜索暂不可用，可继续手动填写。' }); } finally { this.setData({ searching: false }); } },
  pickAsset(event) { const item = this.data.candidates[Number(event.currentTarget.dataset.index)]; if (!item) return; this.invalidate({ symbol: item.symbol, name: item.name, market: item.market, currency: item.currency, assetType: item.asset_type, status: 'verified', instrumentKey: item.instrument_key, candidates: [] }); },
  preview() { if (this.data.saving) return; try { const result = service.previewHolding(request(this)); this._token = result.contentToken; const { contentToken, ...previewData } = result; this.setData({ previewData, error: '' }); } catch (e) { this._token = ''; this.setData({ previewData: null, error: e.message }); showError(e); } },
  submit() { if (this.data.saving || !this.data.previewData) return; this.setData({ saving: true }); try { service.saveHolding({ ...request(this), contentToken: this._token }); wx.showToast({ title: '持仓已保存', icon: 'success' }); wx.navigateBack({ fail: () => {} }); } catch (e) { this.setData({ saving: false, error: e.message }); showError(e); } },
});
