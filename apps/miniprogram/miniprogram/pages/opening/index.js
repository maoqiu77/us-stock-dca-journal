const { service, today, showError } = require('../../lib/core');
function input(page) { const value = { date: page.data.date, symbol: page.data.symbol, assetType: page.data.assetType, quantity: page.data.quantity, totalCost: page.data.totalCost, note: page.data.note }; if (page.data.recordId) Object.assign(value, { recordId: page.data.recordId, expectedRevision: page.data.expectedRevision }); return value; }
Page({
  data: { date: '', today: '', lockedDate: false, symbol: '', assetType: 'ETF', quantity: '', totalCost: '', note: '', recordId: '', expectedRevision: '', preview: null, saving: false },
  onLoad(options = {}) {
    try { const first = service.firstUse(); const update = { today: today(), date: first.openingDate || today(), lockedDate: !!first.openingDate };
      if (options.recordId) { const row = service.records().find(item => item.id === options.recordId && item.isOpening && !item.voided); if (!row) throw Error('期初记录不存在或已更新。'); Object.assign(update, { recordId: row.id, expectedRevision: row.revisionId, date: row.date, lockedDate: true, symbol: row.symbol, assetType: row.assetType, quantity: row.quantity, totalCost: row.totalCost, note: row.note }); }
      this.setData(update); } catch (e) { showError(e); }
  },
  invalidate(update) { this._previewToken = ''; this.setData({ ...update, preview: null }); },
  onField(event) { const field = event.currentTarget.dataset.field; if (['symbol', 'quantity', 'totalCost', 'note'].includes(field)) this.invalidate({ [field]: event.detail.value }); },
  onDate(event) { if (!this.data.lockedDate) this.invalidate({ date: event.detail.value }); },
  onType(event) { this.invalidate({ assetType: event.currentTarget.dataset.type }); },
  preview() { try { const result = service.previewOpening(input(this)); this._previewToken = result.contentToken; const { contentToken, ...display } = result; this.setData({ preview: display }); } catch (e) { this._previewToken = ''; this.setData({ preview: null }); showError(e); } },
  submit() { if (!this.data.preview) { showError(Error('请先预览并核对期初数量和确认总成本。')); return; } if (this.data.saving) return; this.setData({ saving: true }); try { service.saveOpening({ ...input(this), contentToken: this._previewToken }); wx.showToast({ title: '期初持仓已保存', icon: 'success' }); wx.navigateBack({ fail: () => wx.showModal({ title: '期初持仓已保存', content: '请点击左上角返回，无需重复保存。', showCancel: false }) }); } catch (e) { this._previewToken = ''; this.setData({ saving: false, preview: null }); showError(e); } },
});
