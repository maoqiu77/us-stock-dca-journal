const { service, today, showError } = require('../../lib/core');
function input(page) { const value = { date: page.data.date, symbol: page.data.symbol, assetType: page.data.assetType, quantity: page.data.quantity, totalCost: page.data.totalCost, note: page.data.note }; if (page.data.recordId) Object.assign(value, { recordId: page.data.recordId, expectedRevision: page.data.expectedRevision }); return value; }
Page({
  data: { date: '', today: '', lockedDate: false, symbol: '', assetType: 'ETF', quantity: '', totalCost: '', note: '', recordId: '', expectedRevision: '', preview: null, saving: false, pendingSave: false, retryable: false },
  onLoad(options = {}) {
    this.refreshPending();
    try { const first = service.firstUse(); const update = { today: today(), date: first.openingDate || today(), lockedDate: !!first.openingDate };
      if (options.recordId) { const row = service.records().find(item => item.id === options.recordId && item.isOpening && !item.voided); if (!row) throw Error('期初记录不存在或已更新。'); Object.assign(update, { recordId: row.id, expectedRevision: row.revisionId, date: row.date, lockedDate: true, symbol: row.symbol, assetType: row.assetType, quantity: row.quantity, totalCost: row.totalCost, note: row.note }); }
      this.setData(update); } catch (e) { showError(e); }
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
  onField(event) { const field = event.currentTarget.dataset.field; if (['symbol', 'quantity', 'totalCost', 'note'].includes(field)) this.invalidate({ [field]: event.detail.value }); },
  onDate(event) { if (!this.data.lockedDate) this.invalidate({ date: event.detail.value }); },
  onType(event) { this.invalidate({ assetType: event.currentTarget.dataset.type }); },
  preview() { if (this.data.pendingSave || this.data.saving) return; try { const result = service.previewOpening(input(this)); this._previewToken = result.contentToken; const { contentToken, ...display } = result; this.setData({ preview: display }); } catch (e) { this._previewToken = ''; this.setData({ preview: null }); showError(e); } },
  submit() {
    if (this.data.pendingSave || this.data.saving) return; if (!this.data.preview) { showError(Error('请先预览并核对期初数量和确认总成本。')); return; } if (this.data.saving) return; this.setData({ saving: true }); try { service.saveOpening({ ...input(this), contentToken: this._previewToken }); wx.showToast({ title: '期初持仓已保存', icon: 'success' }); wx.navigateBack({ fail: () => wx.showModal({ title: '期初持仓已保存', content: '请点击左上角返回，无需重复保存。', showCancel: false }) }); } catch (e) { if (['SAVE_UNKNOWN', 'SAVE_NOT_WRITTEN', 'SAVE_PENDING', 'SAVE_CONFLICT'].includes(e.code)) { this._pendingIdentity = e.submissionIdentity || ''; this._identityUnavailable = !this._pendingIdentity; try { this._knownNoPending = service.pendingIdentity?.() === ''; } catch (_) { this._knownNoPending = false; } this.setData({ saving: false, pendingSave: true, retryable: false }); } else { this._previewToken = ''; this.setData({ saving: false, preview: null }); } showError(e); } },
});
