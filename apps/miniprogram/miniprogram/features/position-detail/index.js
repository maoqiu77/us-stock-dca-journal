const moneyText = (value) => value === null || value === undefined || value === '' ? '--' : String(value).replace(/^\s*(?:[$¥]|USD|CNY)\s*/i, '').replace(/,/g, '');
const present = value => value !== null && value !== undefined && String(value).trim() !== '';
const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', detail: null, marketLoading: false, quote: null, bars: [], range: '3M', chartLoading: false, chartError: '', averages: [], marketStats: [], showScreenshotDetails: false },
  onLoad(options = {}) { this.symbol = options.symbol || ''; this.load(); }, onShow() { if (this.symbol) { this._visible = true; this.load(); this.presentQuote(); if (this.data.detail?.marketIdentity) this.loadMarketDetail(); this.refreshMarket(); clearInterval(this._quoteTimer); this._quoteTimer = setInterval(() => this.refreshQuote(), 20000); } },
  load() { try { const detail = service.positionDetail(this.symbol); const screenshot = detail.screenshotMetrics || {};
    const pnlFromScreenshot = !present(detail.unrealized) && present(screenshot.holdingPnlText);
    const amountFromScreenshot = !present(detail.marketValue) && present(screenshot.marketValueText);
    this.setData({ detail: { ...detail, pnlFromScreenshot, amountFromScreenshot,
      holdingPnlText: moneyText(pnlFromScreenshot ? screenshot.holdingPnlText : detail.unrealized, detail.currency || 'USD'),
      holdingAmountText: moneyText(amountFromScreenshot ? screenshot.marketValueText : detail.marketValue, detail.currency || 'USD'),
      hasRealized: present(detail.realized), costText: moneyText(detail.cost, detail.currency || 'USD'), unitCostText: moneyText(detail.unitCost, detail.currency || 'USD'), realizedText: moneyText(detail.realized, detail.currency || 'USD') }, error: '' }); } catch (e) { this.setData({ detail: null, error: e.message }); } },
  async refreshMarket() { this.setData({ marketLoading: true }); try { await service.refreshMarket(); this.load(); this.presentQuote(); } catch (_) { this.load(); } finally { this.setData({ marketLoading: false }); const key = this.data.detail?.marketIdentity?.instrument_key; if (key && key !== this._chartKey) this.loadMarketDetail(); } },
  onHide() { this._visible = false; clearInterval(this._quoteTimer); this._quoteTimer = null; this._chartRequest = (this._chartRequest || 0) + 1; service.invalidateMarketRequest(); }, onUnload() { this._visible = false; clearInterval(this._quoteTimer); this._quoteTimer = null; this._chartRequest = (this._chartRequest || 0) + 1; service.invalidateMarketRequest(); },
  async refreshQuote() { const instrument = this.data.detail?.marketIdentity; if (!instrument || this._quoteRefreshing) return; this._quoteRefreshing = true; try { await service.refreshDetailQuote?.(instrument); if (this._visible) this.presentQuote(); } finally { this._quoteRefreshing = false; } },
  toggleScreenshotDetails() { this.setData({ showScreenshotDetails: !this.data.showScreenshotDetails }); },
  presentQuote() {
    const instrument = this.data.detail?.marketIdentity;
    if (!instrument || instrument.market !== 'US' || !service.boardQuote) return;
    const quote = service.boardQuote(instrument), latest = this._bars?.slice(-1)[0];
    const compact = value => value == null ? '--' : Number(value) >= 1e8 ? (Number(value) / 1e8).toFixed(2) + '亿' : Number(value) >= 1e4 ? (Number(value) / 1e4).toFixed(2) + '万' : String(value);
    const quoteTime = quote.asOf ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(quote.asOf)) : '';
    this.setData({ quote, quoteTime, quoteSource: (quote.source || '').split(' / ')[0], marketStats: [
      { label: '最近日 K 开盘', value: latest?.open ?? '--' }, { label: '最近日 K 最高', value: latest?.high ?? '--' },
      { label: '最近日 K 最低', value: latest?.low ?? '--' }, { label: '昨收', value: quote.previousClose ?? '--' },
      { label: quote.volume == null ? '最近日 K 成交量' : '成交量', value: compact(quote.volume ?? latest?.volume) }, { label: '总市值', value: compact(quote.marketCap) },
    ] });
  },
  async loadMarketDetail() {
    const instrument = this.data.detail?.marketIdentity;
    if (!instrument || instrument.market !== 'US' || !service.marketBars) return;
    this._chartKey = instrument.instrument_key;
    const request = this._chartRequest = (this._chartRequest || 0) + 1;
    this.setData({ chartLoading: true, chartError: '' });
    try {
      const [result] = await Promise.all([service.marketBars(instrument, '1Y'), service.refreshDetailQuote?.(instrument)]);
      if (request !== this._chartRequest) return;
      this._bars = result.status === 'available' ? result.bars : [];
      this.setData({ chartAdjustment: result.adjustment === 'forward_adjusted' ? '前复权' : result.adjustment === 'split_adjusted' ? '拆股调整' : '不复权', chartSource: result.provider, chartAsOf: this._bars.slice(-1)[0]?.trading_date || '', chartError: this._bars.length ? '' : '日 K 数据暂不可用' });
      this.updateChart(); this.presentQuote();
    } catch (_) { if (request === this._chartRequest) this.setData({ chartError: '行情暂不可用，请稍后重试' }); }
    finally { if (request === this._chartRequest) this.setData({ chartLoading: false }); }
  },
  changeRange(event) { this.setData({ range: event.currentTarget.dataset.range }); this.updateChart(); },
  updateChart() {
    const all = this._bars || [], count = { '1M': 22, '3M': 66, '1Y': 260 }[this.data.range] || 66;
    const enriched = all.map((bar, i) => { const values = {}; for (const period of [5, 20, 60]) values['ma' + period] = i + 1 < period ? null : all.slice(i + 1 - period, i + 1).reduce((sum, b) => sum + Number(b.close), 0) / period; return { ...bar, ...values }; });
    const bars = enriched.slice(-count), last = bars[bars.length - 1];
    this.setData({ bars, startDate: bars[0]?.trading_date || '', endDate: last?.trading_date || '', averages: [5, 20, 60].map(period => ({ period, value: last?.['ma' + period] == null ? '--' : last['ma' + period].toFixed(3) })) });
  },
  sell() { const item = this.data.detail; if (!item || item.quantity === '0' || item.clockAnomaly) return; wx.navigateTo({ url: `/features/entry/index?kind=sell&symbol=${encodeURIComponent(item.symbol)}&assetType=${encodeURIComponent(item.assetType)}&currency=${encodeURIComponent(item.currency || 'USD')}` }); },
  addTrade() { const item = this.data.detail; if (item && !item.clockAnomaly) wx.navigateTo({ url: `/features/entry/index?kind=buy&symbol=${encodeURIComponent(item.symbol)}&assetType=${encodeURIComponent(item.assetType)}&currency=${encodeURIComponent(item.currency || 'USD')}` }); },
  calibrate() { const item = this.data.detail; if (item) wx.navigateTo({ url: `/features/holding-editor/index?id=${encodeURIComponent(item.id)}&symbol=${encodeURIComponent(item.symbol)}` }); },
  analyze() { const item = this.data.detail; if (!item) return; wx.setStorageSync('portfolio.wechat.navigation-intent.v1', { workspaceId: service.journal().read().instance_id, type: item.market && item.market !== 'US' ? 'holding_research' : 'instrument_research', holdingId: item.id, symbol: item.symbol, question: `帮我研究 ${item.symbol}`, expiresAt: Date.now() + 5 * 60 * 1000 }); wx.switchTab({ url: '/pages/research/index', fail: () => wx.removeStorageSync('portfolio.wechat.navigation-intent.v1') }); },
  marketDetail() { const item = this.data.detail?.marketIdentity; if (item) { service.addWatchlist(item); wx.navigateTo({ url: `/features/market-detail/index?key=${encodeURIComponent(item.instrument_key)}` }); } },
  editRecord(event) { const id = event.currentTarget.dataset.id, opening = event.currentTarget.dataset.opening; wx.navigateTo({ url: `/${opening ? 'features/opening/index' : 'features/entry/index'}?recordId=${encodeURIComponent(id)}` }); },
  showHistory(event) { wx.navigateTo({ url: `/features/revision-detail/index?recordId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
});
