const { service, today, showError } = require('../../lib/core');
function input(page) {
  const value = { kind: page.data.kind, symbol: page.data.symbol, assetType: page.data.assetType, currency: page.data.currency, date: page.data.date, amount: page.data.amount, quantity: page.data.quantity, price: page.data.price, fee: page.data.fee, note: page.data.note, position: Number(page.data.position) };
  if (page.data.recordId) { value.recordId = page.data.recordId; value.expectedRevision = page.data.expectedRevision; }
  return value;
}
Page({
  data: { kind: 'buy', symbol: '', assetType: 'ETF', currency: 'USD', date: '', today: '', amount: '', quantity: '', price: '', fee: '', note: '', recordId: '', expectedRevision: '', position: 0, availableQuantity: '—', preview: null, saving: false, pendingSave: false, retryable: false },
  onLoad(options = {}) {
    this.refreshPending();
    try {
      const rows = service.records(), data = { date: options.date || today(), today: today(), kind: options.kind || 'buy', symbol: options.symbol || '', assetType: options.assetType || 'ETF', currency: options.currency === 'CNY' ? 'CNY' : 'USD' };
      if (options.recordId) {
        const row = rows.find(item => item.id === options.recordId);
        if (!row || row.voided || row.isOpening) throw Error(row?.isOpening ? '请在期初持仓页更正这条记录。' : '记录不存在或已更新。');
        const ordered = rows.filter(item => !item.voided && item.date === row.date).sort((a, b) => a.sequence - b.sequence);
        Object.assign(data, { recordId: row.id, expectedRevision: row.revisionId, kind: row.kind, symbol: row.symbol, assetType: row.assetType, currency: row.currency || 'USD', date: row.date, position: Math.max(0, ordered.findIndex(item => item.id === row.id)), amount: row.amount, quantity: row.quantity, price: row.price, fee: row.fee, note: row.note });
      } else {
        if (data.symbol) {
          const known = rows.find(item => item.symbol === data.symbol.toUpperCase());
          if (known) { data.assetType = known.assetType; data.currency = known.currency || data.currency; }
          else {
            const asset = service.snapshot?.().holding_assets?.find(item => item.symbol === data.symbol.toUpperCase());
            if (asset) { data.assetType = asset.asset_type; data.currency = asset.currency === 'CNY' ? 'CNY' : 'USD'; }
          }
        }
        data.position = rows.filter(item => !item.voided && item.date === data.date).length;
      }
      this.setData(data); this.refreshContext();
    } catch (e) { showError(e); }
  },
  onShow() { this.refreshPending(); },
  refreshPending() {
    if (this._closedSubmission || this._identityUnavailable) return;
    try {
      const identity = service.pendingIdentity?.() || '', pendingSave = !!identity || !!service.pendingSave?.();
      if ((this._pendingIdentity && identity !== this._pendingIdentity && !(this._knownNoPending && !pendingSave)) || (this.data.pendingSave && !pendingSave && !this._knownNoPending)) {
        this._closedSubmission = true; this._previewToken = '';
        this.setData({ pendingSave: false, retryable: false, saving: true, preview: null });
        showError(Error('这笔提交已在其他页面处理，请返回记录页核对。本页输入保留，但不能当作新交易再次保存。')); return;
      }
      if (identity) { this._pendingIdentity = identity; this._knownNoPending = false; }
      this.setData({ pendingSave });
    } catch (e) { this.setData({ pendingSave: true }); showError(e); }
  },
  verifySave() {
    if (this._identityUnavailable) { showError(Error('无法确认本页提交身份，请到设置核验保存结果，再返回记录页检查。')); return; }
    this.refreshPending(); if (this.data.saving) return;
    try { const result = service.verifyPending(); this.setData({ retryable: result === 'retryable', pendingSave: result === 'retryable' });
      if (result === 'confirmed') { this.setData({ saving: true }); wx.showToast({ title: '已核验保存成功', icon: 'success' }); wx.navigateBack({ fail: () => {} }); }
      if (result === 'none') { this._previewToken = ''; this.setData({ preview: null, saving: false }); showError(Error('当前没有待核验提交。请先检查记录，确认没有保存后再重新预览。')); }
    } catch (e) { this.setData({ pendingSave: true, retryable: false }); showError(e); }
  },
  retrySave() { if (this._identityUnavailable) { this.verifySave(); return; } this.refreshPending(); if (this.data.saving || !this.data.retryable) return; try { service.retryPending(); this.verifySaveAfterRetry(); } catch (e) { this.setData({ retryable: false }); showError(e); } },
  verifySaveAfterRetry() { this.setData({ pendingSave: false, retryable: false, saving: true }); wx.showToast({ title: '已保存', icon: 'success' }); wx.navigateBack({ fail: () => {} }); },
  invalidate(update) { if (this.data.pendingSave || this.data.saving) return; this._previewToken = ''; this.setData({ ...update, preview: null }); },
  onField(event) {
    const field = event.currentTarget.dataset.field; if (!['symbol', 'amount', 'quantity', 'price', 'fee', 'note'].includes(field)) return;
    const update = { [field]: event.detail.value };
    if (field === 'symbol') { try { const symbol = event.detail.value.trim().toUpperCase(); const known = service.records().find(item => item.symbol === symbol); if (known) { update.assetType = known.assetType; update.currency = known.currency || this.data.currency; } else { const asset = service.snapshot?.().holding_assets?.find(item => item.symbol === symbol); if (asset) { update.assetType = asset.asset_type; update.currency = asset.currency === 'CNY' ? 'CNY' : 'USD'; } } } catch (e) { showError(e); return; } }
    if (['amount', 'quantity', 'price'].includes(field)) Object.assign(update, this.calculateTradeFields(field, event.detail.value));
    this.invalidate(update); if (field === 'symbol') this.refreshContext(update);
  },
  calculateTradeFields(field, value) {
    this._recentTradeFields = [...(this._recentTradeFields || []).filter(item => item !== field), field].slice(-2);
    const values = { amount: this.data.amount, quantity: this.data.quantity, price: this.data.price, [field]: value };
    const positive = key => Number(String(values[key] || '').replace(/,/g, '')) > 0;
    const valid = ['amount', 'quantity', 'price'].filter(positive);
    if (valid.length < 2) return {};
    const sources = valid.length === 2 ? valid : this._recentTradeFields.filter(item => valid.includes(item));
    if (sources.length < 2) return {};
    const target = ['amount', 'quantity', 'price'].find(item => !sources.includes(item));
    const amount = Number(values.amount), quantity = Number(values.quantity), price = Number(values.price);
    const calculated = target === 'amount' ? quantity * price : target === 'price' ? amount / quantity : amount / price;
    return target && Number.isFinite(calculated) && calculated > 0 ? { [target]: String(Number(calculated.toFixed(target === 'quantity' ? 6 : 4))) } : {};
  },
  onDate(event) { try { const date = event.detail.value, position = service.records().filter(row => !row.voided && row.date === date && row.id !== this.data.recordId).length; this.invalidate({ date, position }); this.refreshContext(); } catch (e) { showError(e); } },
  onKind(event) {
    const kind = event.currentTarget.dataset.kind;
    if (kind === 'observe') { this.observeOnly(); return; }
    this.invalidate({ kind }); this.refreshContext({ kind });
  },
  observeOnly() {
    const symbol = String(this.data.symbol || '').trim().toUpperCase();
    if (!symbol) { showError(Error('请先填写标的代码，再加入总览。')); return; }
    try {
      const catalog = service.marketDiscovery ? service.marketDiscovery() : { results: [], watchlist: [] };
      const candidate = [...(catalog.results || []), ...(catalog.watchlist || [])].find(item => item.symbol === symbol && item.asset_type === this.data.assetType);
      if (!candidate || !service.addWatchlist) throw Error('当前标的还没有行情目录匹配，请先在看板搜索后再加入总览。');
      service.addWatchlist(candidate);
      wx.showToast({ title: '已加入总览', icon: 'success' });
      wx.navigateBack({ fail: () => {} });
    } catch (e) { showError(e); }
  },
  onType(event) {
    const assetType = event.currentTarget.dataset.type;
    this.invalidate({ assetType, currency: assetType === 'FUND' ? 'CNY' : this.data.currency });
  },
  // Kept for compatibility with older saved page drafts; the selector is no longer rendered.
  onOrder(event) { const position = Number(event.detail.value); this.invalidate({ position }); this.refreshContext({ position }); },
  onCurrency(event) { const currency = event.currentTarget.dataset.currency === 'CNY' ? 'CNY' : 'USD'; this.invalidate({ currency }); },
  refreshContext(changes = {}) {
    try {
      const state = { ...this.data, ...changes }; const sameDay = service.records().filter(row => !row.voided && row.date === state.date && row.id !== state.recordId); const max = sameDay.length;
      const position = Math.min(Number(state.position) || 0, max); let availableQuantity = '—';
      if (state.symbol.trim()) availableQuantity = service.availableQuantity({ symbol: state.symbol, currency: state.currency, date: state.date, position, excludeRecordId: state.recordId || undefined });
      this.setData({ position, availableQuantity });
    } catch (e) { showError(e); }
  },
  preview() { if (this.data.pendingSave || this.data.saving) return; try { const result = service.previewTrade(input(this)); this._previewToken = result.contentToken; const { contentToken, ...display } = result; this.setData({ preview: display }); } catch (e) { this._previewToken = ''; this.setData({ preview: null }); showError(e); } },
  submit() {
    if (this.data.pendingSave || this.data.saving) return;
    if (!this.data.preview) { showError(Error('请先预览并核对金额、费用、现金流和回放后的持仓变化。')); return; }
    if (this.data.saving) return; this.setData({ saving: true });
    try { service.saveTrade({ ...input(this), contentToken: this._previewToken }); wx.showToast({ title: this.data.recordId ? '更正已保存' : '已保存', icon: 'success' }); wx.navigateBack({ fail: () => wx.showModal({ title: '记录已保存', content: '请点击左上角返回查看记录，无需重复保存。', showCancel: false }) }); }
    catch (e) { if (['SAVE_UNKNOWN', 'SAVE_NOT_WRITTEN', 'SAVE_PENDING', 'SAVE_CONFLICT'].includes(e.code)) { this._pendingIdentity = e.submissionIdentity || ''; this._identityUnavailable = !this._pendingIdentity; try { this._knownNoPending = service.pendingIdentity?.() === ''; } catch (_) { this._knownNoPending = false; } this.setData({ saving: false, pendingSave: true, retryable: false }); } else { this._previewToken = ''; this.setData({ saving: false, preview: null }); } showError(e); }
  },
});
