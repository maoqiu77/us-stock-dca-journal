const moneyText = (value, currency) => value === null || value === undefined || value === '' ? '--' : `${currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency + ' '}${value}`;
const present = value => value !== null && value !== undefined && String(value).trim() !== '';
const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', detail: null, marketLoading: false },
  onLoad(options = {}) { this.symbol = options.symbol || ''; this.load(); }, onShow() { if (this.symbol) { this.load(); this.refreshMarket(); } },
  load() { try { const detail = service.positionDetail(this.symbol); const screenshot = detail.screenshotMetrics || {};
    const pnlFromScreenshot = !present(detail.unrealized) && present(screenshot.holdingPnlText);
    const amountFromScreenshot = !present(detail.marketValue) && present(screenshot.marketValueText);
    this.setData({ detail: { ...detail, pnlFromScreenshot, amountFromScreenshot,
      holdingPnlText: moneyText(pnlFromScreenshot ? screenshot.holdingPnlText : detail.unrealized, detail.currency || 'USD'),
      holdingAmountText: moneyText(amountFromScreenshot ? screenshot.marketValueText : detail.marketValue, detail.currency || 'USD'),
      hasRealized: present(detail.realized), costText: moneyText(detail.cost, detail.currency || 'USD'), unitCostText: moneyText(detail.unitCost, detail.currency || 'USD'), realizedText: moneyText(detail.realized, detail.currency || 'USD') }, error: '' }); } catch (e) { this.setData({ detail: null, error: e.message }); } },
  async refreshMarket() { this.setData({ marketLoading: true }); try { await service.refreshMarket(); this.load(); } catch (_) { this.load(); } finally { this.setData({ marketLoading: false }); } },
  onHide() { service.invalidateMarketRequest(); }, onUnload() { service.invalidateMarketRequest(); },
  sell() { const item = this.data.detail; if (!item || item.quantity === '0' || item.clockAnomaly) return; wx.navigateTo({ url: `/pages/entry/index?kind=sell&symbol=${encodeURIComponent(item.symbol)}&assetType=${encodeURIComponent(item.assetType)}` }); },
  addTrade() { const item = this.data.detail; if (item && !item.clockAnomaly) wx.navigateTo({ url: `/pages/entry/index?kind=buy&symbol=${encodeURIComponent(item.symbol)}&assetType=${encodeURIComponent(item.assetType)}` }); },
  calibrate() { const item = this.data.detail; if (item) wx.navigateTo({ url: `/pages/holding-editor/index?id=${encodeURIComponent(item.id)}&symbol=${encodeURIComponent(item.symbol)}` }); },
  analyze() { const item = this.data.detail; if (!item) return; wx.setStorageSync('portfolio.wechat.navigation-intent.v1', { type: 'instrument_research', symbol: item.symbol, question: `帮我研究 ${item.symbol}`, expiresAt: Date.now() + 5 * 60 * 1000 }); wx.switchTab({ url: '/pages/research/index' }); },
  marketDetail() { const item = this.data.detail?.marketIdentity; if (item) { service.addWatchlist(item); wx.navigateTo({ url: `/pages/market-detail/index?key=${encodeURIComponent(item.instrument_key)}` }); } },
  editRecord(event) { const id = event.currentTarget.dataset.id, opening = event.currentTarget.dataset.opening; wx.navigateTo({ url: `/${opening ? 'pages/opening/index' : 'pages/entry/index'}?recordId=${encodeURIComponent(id)}` }); },
  showHistory(event) { wx.navigateTo({ url: `/pages/revision-detail/index?recordId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
});
