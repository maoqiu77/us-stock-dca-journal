const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', view: null, firstUse: null, clockAnomaly: null, marketLoading: false },
  onShow() {
    this.load(); this.startMarketRefresh(); this.refreshMarket();
  },
  load() {
    try {
      const view = service.overview();
      this.setData({ view: view.clockAnomaly ? null : view, clockAnomaly: view.clockAnomaly ? { asOf: view.knownAt, throughDate: view.throughDate, message: '设备时间早于已保存记录，请校准时间。' } : null, firstUse: service.firstUse(), error: '' });
    } catch (e) { this.setData({ error: e.message, view: null, clockAnomaly: null }); }
  },
  async refreshMarket() { this.setData({ marketLoading: true }); try { await service.refreshMarket(); this.load(); } catch (_) { this.load(); } finally { this.setData({ marketLoading: false }); } },
  startMarketRefresh() { if (typeof setInterval !== 'function' || this._marketTimer) return; this._marketTimer = setInterval(() => this.refreshMarket(), 60000); },
  stopMarketRefresh() { if (this._marketTimer && typeof clearInterval === 'function') clearInterval(this._marketTimer); this._marketTimer = null; service.invalidateMarketRequest(); },
  onHide() { this.stopMarketRefresh(); }, onUnload() { this.stopMarketRefresh(); },
  addTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  exploreMarket() { wx.navigateTo({ url: '/pages/market/index' }); },
  startWithTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  startWithOpening() { wx.navigateTo({ url: '/pages/opening/index' }); },
  showPosition(event) { wx.navigateTo({ url: `/pages/position-detail/index?symbol=${encodeURIComponent(event.currentTarget.dataset.symbol)}` }); },
});
