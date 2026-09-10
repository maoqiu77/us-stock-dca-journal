const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', records: [], mode: '' },
  onShow() { try { this.setData({ records: service.records(), mode: service.snapshot().mode, error: '' }); } catch (e) { this.setData({ error: e.message, records: [] }); } },
  addTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  editRecord(event) { const page = event.currentTarget.dataset.opening ? 'opening' : 'entry'; wx.navigateTo({ url: `/pages/${page}/index?recordId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  showHistory(event) { wx.navigateTo({ url: `/pages/revision-detail/index?recordId=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  showPosition(event) { wx.navigateTo({ url: `/pages/position-detail/index?symbol=${encodeURIComponent(event.currentTarget.dataset.symbol)}` }); },
  voidTrade(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({ title: '作废这笔记录？', content: '将重新计算持仓，保留原始记录。若影响后续卖出，系统会拒绝作废。', confirmText: '确认作废', success: result => {
      if (result.confirm) { try { service.voidTrade(id, event.currentTarget.dataset.revision); this.onShow(); } catch (e) { showError(e); } }
    } });
  },
});
