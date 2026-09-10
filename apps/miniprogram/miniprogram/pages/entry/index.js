const { service, today, showError } = require('../../lib/core');
function input(page) {
  const value = { kind: page.data.kind, symbol: page.data.symbol, assetType: page.data.assetType, date: page.data.date, quantity: page.data.quantity, price: page.data.price, fee: page.data.fee, note: page.data.note, position: Number(page.data.position) };
  if (page.data.recordId) { value.recordId = page.data.recordId; value.expectedRevision = page.data.expectedRevision; }
  return value;
}
Page({
  data: { kind: 'buy', symbol: '', assetType: 'ETF', date: '', today: '', quantity: '', price: '', fee: '0', note: '', recordId: '', expectedRevision: '', position: 0, orderChoices: ['第 1 笔'], availableQuantity: '—', preview: null, saving: false },
  onLoad(options = {}) {
    try {
      const rows = service.records(), data = { date: options.date || today(), today: today(), kind: options.kind || 'buy', symbol: options.symbol || '', assetType: options.assetType || 'ETF' };
      if (options.recordId) {
        const row = rows.find(item => item.id === options.recordId);
        if (!row || row.voided || row.isOpening) throw Error(row?.isOpening ? '请在期初持仓页更正这条记录。' : '记录不存在或已更新。');
        const ordered = rows.filter(item => !item.voided && item.date === row.date).sort((a, b) => a.sequence - b.sequence);
        Object.assign(data, { recordId: row.id, expectedRevision: row.revisionId, kind: row.kind, symbol: row.symbol, assetType: row.assetType, date: row.date, position: Math.max(0, ordered.findIndex(item => item.id === row.id)), quantity: row.quantity, price: row.price, fee: row.fee, note: row.note });
      } else {
        if (data.symbol) { const known = rows.find(item => item.symbol === data.symbol.toUpperCase()); if (known) data.assetType = known.assetType; }
        data.position = rows.filter(item => !item.voided && item.date === data.date).length;
      }
      this.setData(data); this.refreshContext();
    } catch (e) { showError(e); }
  },
  invalidate(update) { this._previewToken = ''; this.setData({ ...update, preview: null }); },
  onField(event) {
    const field = event.currentTarget.dataset.field; if (!['symbol', 'quantity', 'price', 'fee', 'note'].includes(field)) return;
    const update = { [field]: event.detail.value };
    if (field === 'symbol') { try { const symbol = event.detail.value.trim().toUpperCase(); const known = service.records().find(item => item.symbol === symbol); if (known) update.assetType = known.assetType; } catch (e) { showError(e); return; } }
    this.invalidate(update); if (field === 'symbol') this.refreshContext(update);
  },
  onDate(event) { try { const date = event.detail.value, position = service.records().filter(row => !row.voided && row.date === date && row.id !== this.data.recordId).length; this.invalidate({ date, position }); this.refreshContext(); } catch (e) { showError(e); } },
  onKind(event) { this.invalidate({ kind: event.currentTarget.dataset.kind }); this.refreshContext({ kind: event.currentTarget.dataset.kind }); },
  onType(event) { this.invalidate({ assetType: event.currentTarget.dataset.type }); },
  onOrder(event) { const position = Number(event.detail.value); this.invalidate({ position }); this.refreshContext({ position }); },
  refreshContext(changes = {}) {
    try {
      const state = { ...this.data, ...changes }; const sameDay = service.records().filter(row => !row.voided && row.date === state.date && row.id !== state.recordId); const max = sameDay.length;
      const position = Math.min(Number(state.position) || 0, max); let availableQuantity = '—';
      if (state.symbol.trim()) availableQuantity = service.availableQuantity({ symbol: state.symbol, date: state.date, position, excludeRecordId: state.recordId || undefined });
      this.setData({ orderChoices: Array.from({ length: max + 1 }, (_, index) => `第 ${index + 1} 笔`), position, availableQuantity });
    } catch (e) { showError(e); }
  },
  preview() { try { const result = service.previewTrade(input(this)); this._previewToken = result.contentToken; const { contentToken, ...display } = result; this.setData({ preview: display }); } catch (e) { this._previewToken = ''; this.setData({ preview: null }); showError(e); } },
  submit() {
    if (!this.data.preview) { showError(Error('请先预览并核对金额、费用、现金流和回放后的持仓变化。')); return; }
    if (this.data.saving) return; this.setData({ saving: true });
    try { service.saveTrade({ ...input(this), contentToken: this._previewToken }); wx.showToast({ title: this.data.recordId ? '更正已保存' : '已保存', icon: 'success' }); wx.navigateBack({ fail: () => wx.showModal({ title: '记录已保存', content: '请点击左上角返回查看记录，无需重复保存。', showCancel: false }) }); }
    catch (e) { this._previewToken = ''; this.setData({ saving: false, preview: null }); showError(e); }
  },
});
