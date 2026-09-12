const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', detail: null },
  onLoad(options = {}) { this.symbol = options.symbol || ''; this.load(); }, onShow() { if (this.symbol) this.load(); },
  load() { try { this.setData({ detail: service.positionDetail(this.symbol), error: '' }); } catch (e) { this.setData({ detail: null, error: e.message }); } },
  sell() { const item = this.data.detail; if (!item || item.quantity === '0' || item.clockAnomaly) return; wx.navigateTo({ url: `/pages/entry/index?kind=sell&symbol=${encodeURIComponent(item.symbol)}&assetType=${encodeURIComponent(item.assetType)}` }); },
  analyze() { const item = this.data.detail; if (item) wx.navigateTo({ url: `/pages/research/index?mode=instrument_research&symbol=${encodeURIComponent(item.symbol)}` }); },
  editRecord(event) { const id = event.currentTarget.dataset.id, opening = event.currentTarget.dataset.opening; wx.navigateTo({ url: `/${opening ? 'pages/opening/index' : 'pages/entry/index'}?recordId=${encodeURIComponent(id)}` }); },
  showHistory(event) { wx.navigateTo({ url: `/pages/revision-detail/index?recordId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
});
