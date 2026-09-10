const { service, today, showError } = require('../../lib/core');
Page({
  data: { kind: 'buy', symbol: '', assetType: 'ETF', date: '', today: '', quantity: '', price: '', fee: '0', note: '', saving: false },
  onLoad() { this.setData({ date: today(), today: today() }); },
  onField(event) { const field = event.currentTarget.dataset.field; if (['symbol', 'quantity', 'price', 'fee', 'note'].includes(field)) this.setData({ [field]: event.detail.value }); },
  onDate(event) { this.setData({ date: event.detail.value }); },
  onKind(event) { this.setData({ kind: event.currentTarget.dataset.kind }); },
  onType(event) { this.setData({ assetType: event.currentTarget.dataset.type }); },
  submit() {
    if (this.data.saving) return; this.setData({ saving: true });
    try { service.saveTrade(this.data); wx.showToast({ title: '已保存', icon: 'success' }); wx.navigateBack({ fail: () => wx.showModal({ title: '交易已保存', content: '请点击左上角返回查看记录，无需重复保存。', showCancel: false }) }); }
    catch (e) { this.setData({ saving: false }); showError(e); }
  },
});
