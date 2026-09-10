const { service, showError } = require('../../lib/core');
Page({
  data: { error: '', view: null },
  onShow() { try { this.setData({ view: service.overview(), error: '' }); } catch (e) { this.setData({ error: e.message, view: null }); } },
  addTrade() { wx.navigateTo({ url: '/pages/entry/index' }); },
  loadDemo() {
    wx.showModal({ title: '体验示例账本', content: '将载入虚构交易，用于测试。金额不代表实际行情。', success: result => {
      if (result.confirm) { try { service.loadDemo(); this.onShow(); } catch (e) { showError(e); } }
    } });
  },
});
