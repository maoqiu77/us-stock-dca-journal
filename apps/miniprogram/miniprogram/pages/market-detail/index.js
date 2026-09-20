const { service, showError } = require('../../lib/core');
Page({
  data: { instrument: null, ranges: ['1M', '3M', '1Y'], range: '1M', style: 'line', chart: null, loading: false, error: '' },
  onLoad(options = {}) { this.key = decodeURIComponent(options.key || ''); const all = [...service.marketDiscovery().results, ...service.marketDiscovery().watchlist]; const instrument = all.find(item => item.instrument_key === this.key); this.setData({ instrument }); if (instrument) this.load(); else this.setData({ error: '标的身份已失效，请重新搜索。' }); },
  async load() { this.setData({ loading: true }); try { const chart = await service.marketBars(this.data.instrument, this.data.range); this.setData({ chart, error: chart.status === 'available' ? '' : '暂无真实历史行情。' }); } catch (error) { this.setData({ error: error.message }); } finally { this.setData({ loading: false }); } },
  setRange(e) { this.setData({ range: e.currentTarget.dataset.range }); this.load(); },
  setStyle(e) { this.setData({ style: e.currentTarget.dataset.style }); },
  toggle() { if (!this.data.instrument) return; const exists = service.marketDiscovery().watchlist.some(item => item.instrument_key === this.key); if (exists) service.removeWatchlist(this.key); else service.addWatchlist(this.data.instrument); wx.showToast({ title: exists ? '已删除自选' : '已加入自选', icon: 'none' }); },
  analyze() {
    const item = this.data.instrument;
    if (!item) return;
    wx.setStorageSync('portfolio.wechat.navigation-intent.v1', { type: 'instrument_research', symbol: item.symbol, instrumentKey: item.instrument_key, question: `帮我研究 ${item.symbol}`, expiresAt: Date.now() + 5 * 60 * 1000 });
    wx.switchTab({ url: '/pages/research/index' });
  },
});
