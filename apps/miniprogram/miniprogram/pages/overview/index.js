const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', view: null, firstUse: null, clockAnomaly: null, marketLoading: false, currencyIndex: 0 },
  onShow() {
    this.load(); this.startMarketRefresh(); this.refreshMarket();
  },
  load() {
    try {
      const selected = this.data.view?.selectedCurrency;
      const view = service.overview(undefined, selected);
      this.setData({ view: view.clockAnomaly ? null : view, currencyIndex: Math.max(0, (view.currencies || []).indexOf(view.selectedCurrency)), clockAnomaly: view.clockAnomaly ? { asOf: view.knownAt, throughDate: view.throughDate, message: '设备时间早于已保存记录，请校准时间。' } : null, firstUse: service.firstUse(), error: '' });
    } catch (e) { this.setData({ error: e.message, view: null, clockAnomaly: null }); }
  },
  async refreshMarket() { this.setData({ marketLoading: true }); try { await service.refreshMarket(); this.load(); } catch (_) { this.load(); } finally { this.setData({ marketLoading: false }); } },
  startMarketRefresh() { if (typeof setInterval !== 'function' || this._marketTimer) return; this._marketTimer = setInterval(() => this.refreshMarket(), 60000); },
  stopMarketRefresh() { if (this._marketTimer && typeof clearInterval === 'function') clearInterval(this._marketTimer); this._marketTimer = null; service.invalidateMarketRequest(); },
  onHide() { this.stopMarketRefresh(); }, onUnload() { this.stopMarketRefresh(); },
  addHolding() { wx.showActionSheet({ itemList: ['手动添加', '截图导入'], success: result => wx.navigateTo({ url: result.tapIndex === 1 ? '/pages/holding-import/index' : '/pages/holding-editor/index' }) }); },
  addTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  showRecords() { wx.navigateTo({ url: '/pages/records/index' }); },
  showSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },
  onCurrency(event) { const index = Number(event.detail.value), currency = this.data.view?.currencies?.[index]; if (!currency) return; try { const view = service.overview(undefined, currency); this.setData({ view, currencyIndex: index }); } catch (e) { this.setData({ error: e.message }); } },
  analyzeHoldings() {
    wx.setStorageSync('portfolio.wechat.navigation-intent.v1', { type: 'portfolio_review', question: '我的持仓有哪些需要注意？', expiresAt: Date.now() + 5 * 60 * 1000 });
    if (wx.switchTab) wx.switchTab({ url: '/pages/research/index' });
  },
  exploreMarket() { wx.navigateTo({ url: '/pages/market/index' }); },
  startWithTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  startWithOpening() { this.addHolding(); },
  showPosition(event) { wx.navigateTo({ url: `/pages/position-detail/index?symbol=${encodeURIComponent(event.currentTarget.dataset.symbol)}` }); },
});
