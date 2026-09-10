const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', view: null, firstUse: null, clockAnomaly: null },
  onShow() {
    try {
      const view = service.overview();
      this.setData({ view: view.clockAnomaly ? null : view, clockAnomaly: view.clockAnomaly ? { asOf: view.knownAt, throughDate: view.throughDate, message: '设备时间早于已保存记录，请校准时间。' } : null, firstUse: service.firstUse(), error: '' });
    } catch (e) { this.setData({ error: e.message, view: null, clockAnomaly: null }); }
  },
  addTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  startWithTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  startWithOpening() { wx.navigateTo({ url: '/pages/opening/index' }); },
  showPosition(event) { wx.navigateTo({ url: `/pages/position-detail/index?symbol=${encodeURIComponent(event.currentTarget.dataset.symbol)}` }); },
  loadDemo() {
    wx.showModal({ title: '体验示例账本', content: '将载入虚构交易，用于测试。金额不代表实际行情。', success: result => {
      if (result.confirm) { try { service.loadDemo(); this.onShow(); } catch (e) { showError(e); } }
    } });
  },
});
