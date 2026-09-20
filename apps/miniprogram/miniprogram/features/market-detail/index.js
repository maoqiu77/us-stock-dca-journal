const { service } = require('../../lib/core');
Page({
 data: { instrument: null, quote: null, error: '', bars: [], range: '3M', loading: false, chartError: '', stats: [], averages: [] },
 onLoad(options = {}) {
   try { this.key = decodeURIComponent(options.key || ''); } catch (_) { this.key = ''; }
   const view = service.marketDiscovery();
   const domestic = (view.domestic || []).find(row => row.instrument.instrument_key === this.key);
   const instrument = [...(domestic ? [domestic.instrument] : []), ...view.results, ...view.watchlist].find(item => item.instrument_key === this.key);
   this.setData({ instrument: instrument || null, domestic: domestic || null, error: instrument ? '' : '标的身份已失效，请重新搜索。' });
   if (instrument) { this.present(); if (instrument.market === 'US') this.loadChart(); }
 },
 onUnload() { this._request = (this._request || 0) + 1; },
 present() {
   const item = this.data.instrument, row = this.data.domestic;
   const compact = value => value == null ? '--' : Number(value) >= 1e8 ? (Number(value) / 1e8).toFixed(2) + '亿' : Number(value) >= 1e4 ? (Number(value) / 1e4).toFixed(2) + '万' : String(value);
   const stat = (label, value, note = '') => ({ label, value: value == null ? '--' : String(value), note });
   let quote, stats;
   if (row) {
     quote = { priceText: item.asset_type === 'ETF' ? row.price || '--' : row.nav || '--', changeText: row.changePct == null ? '--' : (row.changePct > 0 ? '+' : '') + row.changePct.toFixed(2) + '%', direction: row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : 'flat', asOf: row.tradeDate || row.navDate || '', qualityLabel: row.quality === 'stale' ? '缓存已过期' : item.asset_type === 'ETF' ? '参考行情 · 非实时' : '正式单位净值', source: row.source };
     stats = [stat('单位净值', row.nav, row.navDate || '')];
     if (item.asset_type === 'ETF') stats.push(stat('参考折溢价', row.metrics?.quotedPremiumPct == null ? null : row.metrics.quotedPremiumPct.toFixed(2) + '%', row.metrics?.label || ''), stat('基金份额', compact(row.metrics?.shares), row.metrics?.sharesDate || ''), stat('交易所', item.exchange === 'XSHG' ? '上交所' : '深交所'));
   } else {
     quote = service.boardQuote(item);
     const latest = (this._bars || []).slice(-1)[0];
     stats = [stat('最近交易日开盘', latest?.open, latest?.trading_date || ''), stat('最高', latest?.high, latest?.trading_date || ''), stat('最低', latest?.low, latest?.trading_date || ''), stat('昨收', quote.previousClose), stat('成交量（股）', compact(quote.volume ?? latest?.volume), quote.volume == null ? latest?.trading_date || '' : ''), stat(item.asset_type === 'ETF' ? '市场总值' : '总市值', compact(quote.marketCap), item.currency)];
   }
   this.setData({ quote, stats });
 },
 async loadChart() {
   const request = this._request = (this._request || 0) + 1;
   this.setData({ loading: true, chartError: '' });
   try {
     // Load a full year once so MA60 has warm-up observations before the visible range.
     const [result] = await Promise.all([service.marketBars(this.data.instrument, '1Y'), service.refreshDetailQuote?.(this.data.instrument)]);
     if (request !== this._request) return;
     this._bars = result.status === 'available' ? result.bars : [];
     this.setData({ chartAdjustment: result.adjustment === 'forward_adjusted' ? '前复权' : result.adjustment === 'split_adjusted' ? '拆股调整' : '不复权', chartSource: result.provider, chartAsOf: result.bars?.slice(-1)[0]?.trading_date || '', chartError: this._bars.length ? '' : '日 K 数据暂不可用' + (result.reason ? '（' + result.reason + '）' : '') });
     this.updateChart(); this.present();
   } catch (_) { if (request === this._request) this.setData({ chartError: '日 K 数据暂不可用，请稍后重试' }); }
   finally { if (request === this._request) this.setData({ loading: false }); }
 },
 changeRange(event) { this.setData({ range: event.currentTarget.dataset.range }); this.updateChart(); },
 updateChart() {
   const all = this._bars || [], count = { '1M': 22, '3M': 66, '1Y': 260 }[this.data.range] || 66;
   const enriched = all.map((bar, i) => { const values = {}; for (const period of [5, 20, 60]) values['ma' + period] = i + 1 < period ? null : all.slice(i + 1 - period, i + 1).reduce((sum, b) => sum + Number(b.close), 0) / period; return { ...bar, ...values }; });
   const bars = enriched.slice(-count), last = bars[bars.length - 1];
   this.setData({ bars, startDate: bars[0]?.trading_date || '', endDate: last?.trading_date || '', averages: [5, 20, 60].map(period => ({ period, value: last?.['ma' + period] == null ? '--' : last['ma' + period].toFixed(3) })) });
 },
 toggle() { if (!this.data.instrument) return; if (this.data.domestic) return wx.showToast({ title: '国内目录直接在分类中查看', icon: 'none' }); const exists = service.marketDiscovery().watchlist.some(item => item.instrument_key === this.key); if (exists) service.removeWatchlist(this.key); else service.addWatchlist(this.data.instrument); wx.showToast({ title: exists ? '已取消关注' : '已关注', icon: 'none' }); },
 addHolding() { wx.navigateTo({ url: `/features/holding-editor/index?key=${encodeURIComponent(this.key)}` }); },
 analyze() { const item = this.data.instrument; if (!item) return; wx.setStorageSync('portfolio.wechat.navigation-intent.v1', { workspaceId: service.journal().read().instance_id, type: item.market === 'CN' ? 'domestic_research' : 'instrument_research', symbol: item.symbol, instrumentKey: item.instrument_key, question: `帮我研究 ${item.symbol}`, expiresAt: Date.now() + 300000 }); wx.switchTab({ url: '/pages/research/index', fail: () => wx.removeStorageSync('portfolio.wechat.navigation-intent.v1') }); },
});
