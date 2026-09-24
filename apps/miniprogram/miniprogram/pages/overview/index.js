const { service, showError } = require('../../lib/core');
function displayHoldings(view) {
  const present = value => value !== null && value !== undefined && String(value).trim() !== '';
  return { ...view, positions: (view.positions || []).map(item => {
    const snapshot = item.screenshotMetrics || {};
    const amountFromScreenshot = !present(item.marketValue) && present(snapshot.marketValueText);
    const pnlFromScreenshot = !present(item.unrealized) && present(snapshot.holdingPnlText);
    const amount = amountFromScreenshot ? snapshot.marketValueText : item.marketValue;
    const pnl = pnlFromScreenshot ? snapshot.holdingPnlText : item.unrealized;
    const cleanMoney = value => String(value).replace(/^\s*(?:[$¥]|USD|CNY)\s*/i, '').replace(/,/g, '');
    const moneyText = value => present(value) ? cleanMoney(value) : '--';
    const signedMoneyText = value => { if (!present(value)) return '--'; const text = cleanMoney(value); return text.startsWith('+') || text.startsWith('-') ? text : Number(text) > 0 ? `+${text}` : text; };
    const percentText = value => { if (!present(value)) return '--'; const text = String(value), numeric = Number(text.replace('%', '')); return text.startsWith('+') || text.startsWith('-') ? text : Number.isFinite(numeric) && numeric > 0 ? `+${text}` : text; };
    const pnlText = signedMoneyText(pnl), pnlPercentText = percentText(item.pnlPercent), dailyPnlText = signedMoneyText(item.dailyPnl), dailyPnlPercentText = percentText(item.dailyPnlPercent);
    return { ...item, amountText: moneyText(amount), pnlText, quantityText: present(item.quantity) ? `${item.quantity}${item.assetType === 'FUND' ? ' 份' : ' 股'}` : '--', currentPriceText: moneyText(item.marketPrice), unitCostText: moneyText(item.unitCost), pnlPercentText, dailyPnlText, dailyPnlPercentText, pnlNegative: pnlText.startsWith('-'), pnlPercentNegative: pnlPercentText.startsWith('-'), dailyPnlNegative: dailyPnlText.startsWith('-'), dailyPnlPercentNegative: dailyPnlPercentText.startsWith('-'), amountFromScreenshot, pnlFromScreenshot };
  }) , holdingsScrollHeight: 62 + (view.positions || []).reduce((height, item) => height + 150 + (item.checkpointConflict ? 60 : 0), 0) };
}
Page({
  data: { error: '', view: null, firstUse: null, clockAnomaly: null, marketLoading: false, currencyIndex: 0 },
  onShow() {
    this.load(); this.startMarketRefresh(); this.refreshMarket();
  },
  load() {
    try {
      const selected = this.data.view?.selectedCurrency;
      const view = displayHoldings(service.overview(undefined, selected));
      const pnlValue = view.displayPnl?.value;
      const displayPnlText = pnlValue === null || pnlValue === undefined ? '--' : (String(pnlValue).startsWith('-') || String(pnlValue).startsWith('+') ? String(pnlValue) : Number(pnlValue) > 0 ? `+${pnlValue}` : String(pnlValue));
      this.setData({ view: view.clockAnomaly ? null : { ...view, displayPnlText }, currencyIndex: Math.max(0, (view.currencies || []).indexOf(view.selectedCurrency)), clockAnomaly: view.clockAnomaly ? { asOf: view.knownAt, throughDate: view.throughDate, message: '设备时间早于已保存记录，请校准时间。' } : null, firstUse: service.firstUse(), error: '' });
    } catch (e) { this.setData({ error: e.message, view: null, clockAnomaly: null }); }
  },
  async refreshMarket() { this.setData({ marketLoading: true }); try { await service.refreshMarket(); this.load(); } catch (_) { this.load(); } finally { this.setData({ marketLoading: false }); } },
  startMarketRefresh() { if (typeof setInterval !== 'function' || this._marketTimer) return; this._marketTimer = setInterval(() => this.refreshMarket(), 60000); },
  stopMarketRefresh() { if (this._marketTimer && typeof clearInterval === 'function') clearInterval(this._marketTimer); this._marketTimer = null; service.invalidateMarketRequest(); },
  onHide() { this.stopMarketRefresh(); }, onUnload() { this.stopMarketRefresh(); },
  addHolding() { wx.showActionSheet({ itemList: ['手动添加', '截图导入'], success: result => wx.navigateTo({ url: result.tapIndex === 1 ? '/features/holding-import/index' : '/features/holding-editor/index' }) }); },
  addTrade() { wx.navigateTo({ url: '/features/entry/index' }); },
  showRecords() { wx.navigateTo({ url: '/features/records/index' }); },
  showSettings() { wx.navigateTo({ url: '/features/settings/index' }); },
  onCurrency(event) { const index = Number(event.detail.value), currency = this.data.view?.currencies?.[index]; if (!currency) return; try { const view = displayHoldings(service.overview(undefined, currency)); const pnlValue = view.displayPnl?.value; const displayPnlText = pnlValue === null || pnlValue === undefined ? '--' : (String(pnlValue).startsWith('-') || String(pnlValue).startsWith('+') ? String(pnlValue) : Number(pnlValue) > 0 ? `+${pnlValue}` : String(pnlValue)); this.setData({ view: { ...view, displayPnlText }, currencyIndex: index }); } catch (e) { this.setData({ error: e.message }); } },
  cycleCurrency() { const count = this.data.view?.currencies?.length || 0; if (count > 1) this.onCurrency({ detail: { value: (this.data.currencyIndex + 1) % count } }); },
  analyzeHoldings() {
    wx.setStorageSync('portfolio.wechat.navigation-intent.v1', { workspaceId: service.journal().read().instance_id, type: 'portfolio_review', question: '我的持仓有哪些需要注意？', expiresAt: Date.now() + 5 * 60 * 1000 });
    if (wx.switchTab) wx.switchTab({ url: '/pages/research/index', fail: () => wx.removeStorageSync('portfolio.wechat.navigation-intent.v1') });
  },
  exploreMarket() { wx.switchTab({ url: '/pages/market/index' }); },
  startWithTrade() { wx.navigateTo({ url: '/features/entry/index' }); },
  startWithOpening() { this.addHolding(); },
  showPosition(event) { wx.navigateTo({ url: `/features/position-detail/index?symbol=${encodeURIComponent(event.currentTarget.dataset.symbol)}` }); },
});
