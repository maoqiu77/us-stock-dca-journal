const { service, showError } = require('../../lib/core');
Page({
  data: { query: '', results: [], watchlist: [], error: '', searching: false },
  onShow() { this.load(); },
  onUnload() { if (this._timer) clearTimeout(this._timer); service.cancelMarketSearch(); },
  load() { const view = service.marketDiscovery(); this.setData({ results: view.results, watchlist: view.watchlist, error: view.error || '' }); },
  onQuery(e) {
    const query = e.detail.value; this.setData({ query }); service.cancelMarketSearch(); if (this._timer) clearTimeout(this._timer);
    if (query.trim().length < 2) { this.setData({ results: [] }); return; }
    this._timer = setTimeout(async () => { this.setData({ searching: true }); try { await service.searchMarket(query); this.load(); } catch (error) { showError(error); } finally { this.setData({ searching: false }); } }, 300);
  },
  add(e) { const item = this.data.results[Number(e.currentTarget.dataset.index)]; if (item) { service.addWatchlist(item); this.load(); } },
  remove(e) { service.removeWatchlist(e.currentTarget.dataset.key); this.load(); },
  open(e) { wx.navigateTo({ url: `/pages/market-detail/index?key=${encodeURIComponent(e.currentTarget.dataset.key)}` }); },
});
