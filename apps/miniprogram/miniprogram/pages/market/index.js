const { service, showError } = require('../../lib/core');
function dateRange(rows) { const dates = rows.map(row => row.tradeDate || row.navDate).filter(Boolean).sort(); return !dates.length ? '--' : dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + ' 至 ' + dates[dates.length - 1]; }
Page({
  data: { etfLayout: 'list', domesticDateRange: '', domesticUpdated: '', benchmarks: [], etfSort: '', etfAscending: false, managing: false, manageSelected: [], dragKey: '', dragOffsets: [], dropSlot: -1, dragTop: 0, dragItem: null, manageScroll: 0, logoErrors: {}, domesticRows: [], domesticReason: '', domesticLoading: false, segment: 'watch', refreshing: false, query: '', results: [], watchlist: [], error: '', searching: false },
  onShow() { this._visible = true; this.load(); if (this.data.segment === 'watch') this.refresh(); else this.loadDomestic(); },
  onHide() { this.cancelDrag(); this.closeManage(); this._visible = false; if (this._timer) clearTimeout(this._timer); service.cancelMarketSearch(); },
  onUnload() { this.cancelDrag(); this._visible = false; this._domesticRequest = (this._domesticRequest || 0) + 1; if (this._timer) clearTimeout(this._timer); service.cancelMarketSearch(); },
  load() { const view = service.marketDiscovery(); this.setData({ results: view.results, watchlist: view.watchlist.map(item => ({ ...service.boardQuote(item), logoFailed: !!this.data.logoErrors[item.instrument_key], manageSelected: this.data.manageSelected.includes(item.instrument_key) })), error: view.error || '' }); },
  async segment(e) { const segment = e.currentTarget.dataset.segment; this.setData({ segment }); if (segment === 'watch') { this._domesticRequest = (this._domesticRequest || 0) + 1; this.setData({ domesticLoading: false }); return this.refresh(); } await this.loadDomestic(segment); },
  async loadDomestic(segment = this.data.segment) { if (this.data.domesticLoading && this._loadingSegment === segment) return; const request = this._domesticRequest = (this._domesticRequest || 0) + 1; this._loadingSegment = segment; this.setData({ domesticLoading: true, domesticRows: [], benchmarks: [], domesticReason: '', domesticUpdated: '' }); try { const result = await service.domesticBoard(segment); if (request === this._domesticRequest && this._visible && this.data.segment === segment) this.setData({ benchmarks: (result.benchmarks || []).map(item => ({ ...item, changeText: item.change == null ? '--' : (item.change > 0 ? '+' : '') + item.change.toFixed(2), percentText: item.changePct == null ? '--' : (item.changePct > 0 ? '+' : '') + item.changePct.toFixed(2) + '%', direction: item.changePct > 0 ? 'rise' : item.changePct < 0 ? 'fall' : 'flat' })), domesticRows: result.rows.map(row => ({ ...row, instrument_key: row.instrument.instrument_key, valueText: row.instrument.asset_type === 'ETF' ? row.price || '--' : row.nav || '--', changeText: row.changePct == null ? '--' : row.changePct.toFixed(2) + '%', premiumText: (row.metrics ? row.metrics.quotedPremiumPct : row.premiumPct) == null ? '--' : (row.metrics ? row.metrics.quotedPremiumPct : row.premiumPct).toFixed(2) + '%', percentileText: row.metrics?.percentile60 == null ? '--' : row.metrics.percentile60.toFixed(2) + '%', sharesText: row.metrics?.shares == null ? '--' : (row.metrics.shares / 10000).toFixed(2), sharesChangeText: row.metrics?.sharesChange == null ? '--' : (row.metrics.sharesChange / 10000).toFixed(2), premiumDirection: (row.metrics ? row.metrics.quotedPremiumPct : row.premiumPct) > 0 ? 'rise' : (row.metrics ? row.metrics.quotedPremiumPct : row.premiumPct) < 0 ? 'fall' : 'flat', cnDirection: row.changePct == null ? 'flat' : row.changePct > 0 ? 'rise' : row.changePct < 0 ? 'fall' : 'flat' })), domesticReason: result.reason, domesticDateRange: dateRange(result.rows), domesticUpdated: result.rows.map(row => row.fetchedAt).sort().slice(-1)[0] || '' }); if (request === this._domesticRequest && this._visible && this.data.segment === segment && this.data.etfSort) this.applyEtfSort(); } finally { if (request === this._domesticRequest) this.setData({ domesticLoading: false }); } },
  changeEtfLayout(e) { const layout = e.currentTarget.dataset.layout; if (['list', 'cards'].includes(layout)) this.setData({ etfLayout: layout }); },
  sortEtf(e) { const key = e.currentTarget.dataset.sort; if (!['symbol', 'changePct', 'quotedPremiumPct', 'shares'].includes(key)) return; this.setData({ etfSort: key, etfAscending: this.data.etfSort === key ? !this.data.etfAscending : false }); this.applyEtfSort(); },
  applyEtfSort() { const key = this.data.etfSort, ascending = this.data.etfAscending; const value = row => key === 'symbol' ? row.instrument.symbol : key === 'changePct' ? row.changePct : row.metrics?.[key]; const rows = this.data.domesticRows.slice().sort((a, b) => { const x = value(a), y = value(b); if (x == null) return y == null ? 0 : 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * (ascending ? 1 : -1); }); this.setData({ domesticRows: rows }); },
  refreshDomestic() { this.loadDomestic(); },
  async refresh() { if (this.data.refreshing) return; this.setData({ refreshing: true }); try { await service.refreshBoard(); if (this._visible) this.load(); } finally { this.setData({ refreshing: false }); } },
  onQuery(e) {
    const query = e.detail.value; this.setData({ query }); service.cancelMarketSearch(); if (this._timer) clearTimeout(this._timer);
    if (query.trim().length < 2) { this.setData({ results: [] }); return; }
    this._timer = setTimeout(async () => { this.setData({ searching: true }); try { await service.searchMarket(query); if (this._visible) this.load(); } catch (error) { showError(error); } finally { this.setData({ searching: false }); } }, 300);
  },
  add(e) { const item = this.data.results[Number(e.currentTarget.dataset.index)]; if (item) { service.addWatchlist(item); this.load(); this.refresh(); } },
  toggleManage() {
    if (this.data.managing) return this.closeManage();
    this._manageScroll = 0;
    this._manageRects = null;
    this.setData({ managing: true, manageSelected: [], manageScroll: 0 }, () => { wx.createSelectorQuery().in(this).select('.manage-scroll').boundingClientRect().select('.manage-row').boundingClientRect().exec(rects => { this._manageRects = rects; }); });
    wx.hideTabBar({ animation: false });
  },
  closeManage() { this.cancelDrag(); if (this.data.managing) { this.setData({ managing: false }); wx.showTabBar({ animation: false }); } },
  selectManaged(e) { const key = e.currentTarget.dataset.key; const keys = this.data.manageSelected; this.setData({ manageSelected: keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key] }); this.markManaged(); },
  markManaged() { this.setData({ watchlist: this.data.watchlist.map(item => ({ ...item, manageSelected: this.data.manageSelected.includes(item.instrument_key) })) }); },
  selectAllManaged() { this.setData({ manageSelected: this.data.manageSelected.length === this.data.watchlist.length ? [] : this.data.watchlist.map(item => item.instrument_key) }); this.markManaged(); },
  deleteManaged() { for (const key of this.data.manageSelected) service.removeWatchlist(key); this.setData({ manageSelected: [] }); this.load(); },
  pinManaged(e) { const key = e.currentTarget.dataset.key, index = this.data.watchlist.findIndex(item => item.instrument_key === key); service.moveWatchlist(key, -index); this.load(); this.markManaged(); },
  manageScrolled(e) { this._manageScroll = e.detail.scrollTop; if (this._drag) this.updateDrag(this._drag.y); },
  startDrag(e) {
    if (!this.data.managing || !e.touches.length) return;
    this.cancelDrag();
    const key = e.currentTarget.dataset.key, y = e.touches[0].clientY;
    const token = this._dragToken = {};
    const activate = rects => {
      if (this._dragToken !== token || !this.data.managing || !rects[0] || !rects[1]) return;
      const index = this.data.watchlist.findIndex(item => item.instrument_key === key);
      if (index < 0) return;
      this._drag = { key, index, y, box: rects[0], height: rects[1].height };
      this.setData({ dragKey: key, dragItem: this.data.watchlist[index] });
      this.updateDrag(y);
      this._dragTimer = setInterval(() => {
        const drag = this._drag; if (!drag) return;
        const delta = drag.y < drag.box.top + 56 ? -14 : drag.y > drag.box.bottom - 56 ? 14 : 0;
        if (!delta) return;
        const max = Math.max(0, this.data.watchlist.length * drag.height - drag.box.height);
        this._manageScroll = Math.max(0, Math.min(max, (this._manageScroll || 0) + delta));
        this.setData({ manageScroll: this._manageScroll }); this.updateDrag(drag.y);
      }, 32);
    };
    if (this._manageRects?.[0] && this._manageRects?.[1]) activate(this._manageRects);
    else wx.createSelectorQuery().in(this).select('.manage-scroll').boundingClientRect().select('.manage-row').boundingClientRect().exec(activate);
  },
  moveDrag(e) { if (this._drag && e.touches.length) this.updateDrag(e.touches[0].clientY); },
  updateDrag(y) {
    const drag = this._drag; if (!drag) return; drag.y = y;
    const slot = Math.max(0, Math.min(this.data.watchlist.length, Math.floor((y - drag.box.top + (this._manageScroll || 0)) / drag.height + 0.5)));
    const target = slot > drag.index ? slot - 1 : slot;
    // Keep keyed rows mounted during the gesture so the handle retains touch ownership.
    // Only crossed neighbours move; persistence happens once, on release.
    const update = {};
    if (drag.target !== target) {
      drag.target = target;
      update.dragOffsets = this.data.watchlist.map((item, index) =>
        index >= target && index < drag.index ? drag.height :
        index > drag.index && index <= target ? -drag.height : 0);
    }
    this.setData({ ...update, dropSlot: slot, dragTop: Math.max(drag.box.top, Math.min(drag.box.bottom - drag.height, y - drag.height / 2)) });
  },
  endDrag(e) {
    if (this._drag && e?.changedTouches?.length) this.updateDrag(e.changedTouches[0].clientY);
    const drag = this._drag, slot = this.data.dropSlot;
    this.cancelDrag();
    if (!drag) return;
    const target = slot > drag.index ? slot - 1 : slot;
    try { service.moveWatchlist(drag.key, target - drag.index); this.load(); this.markManaged(); } catch (error) { showError(error); this.load(); }
  },
  cancelDrag() { this._dragToken = null; this._drag = null; if (this._dragTimer) clearInterval(this._dragTimer); this._dragTimer = null; this.setData({ dragKey: '', dragItem: null, dragOffsets: [], dropSlot: -1 }); },
  swallowTouch() {},
  logoError(e) { const key = e.currentTarget.dataset.key; this.setData({ logoErrors: { ...this.data.logoErrors, [key]: true } }); this.load(); },
  move(e) { service.moveWatchlist(e.currentTarget.dataset.key, Number(e.currentTarget.dataset.offset)); this.load(); },
  remove(e) { const key = e.currentTarget.dataset.key; service.removeWatchlist(key); this.load(); },
  open(e) { wx.navigateTo({ url: `/features/market-detail/index?key=${encodeURIComponent(e.currentTarget.dataset.key)}` }); },
});
