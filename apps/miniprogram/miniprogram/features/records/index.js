const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', records: [], mode: '' },
  onShow() { try { this.setData({ records: service.records(false), mode: service.snapshot().mode, error: '' }); } catch (e) { this.setData({ error: e.message, records: [] }); } },
  addTrade() { wx.navigateTo({ url: '/features/entry/index' }); },
  editRecord(event) { const page = event.currentTarget.dataset.opening ? 'opening' : 'entry'; wx.navigateTo({ url: `/features/${page}/index?recordId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  showHistory(event) { wx.navigateTo({ url: `/features/revision-detail/index?recordId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  showPosition(event) { wx.navigateTo({ url: `/features/position-detail/index?symbol=${encodeURIComponent(event.currentTarget.dataset.symbol)}` }); },
  deleteRecord(event) { this.voidTrade(event); },
  voidTrade(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({ title: '删除这笔流水？', content: '将从当前流水中移除并重新计算持仓，审计记录仍会保留。若影响后续卖出，系统会拒绝删除。', confirmText: '确认删除', confirmColor: '#a94d43', success: result => {
      if (result.confirm) { try { service.voidTrade(id, event.currentTarget.dataset.revision); this.onShow(); } catch (e) { showError(e); } }
    } });
  },
});
