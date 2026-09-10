const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', records: [], mode: '' },
  onShow() { try { this.setData({ records: service.records(), mode: service.snapshot().mode, error: '' }); } catch (e) { this.setData({ error: e.message, records: [] }); } },
  addTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  voidTrade(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({ title: '作废这笔记录？', content: '将重新计算持仓，保留原始记录。若影响后续卖出，系统会拒绝作废。', confirmText: '确认作废', success: result => {
      if (result.confirm) { try { service.voidTrade(id); this.onShow(); } catch (e) { showError(e); } }
    } });
  },
});
