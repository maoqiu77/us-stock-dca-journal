const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', date: '', today: '', text: '', reviews: [], mode: '', dirty: false, generation: -1 },
  onShow() { this.setData({ today: today() }); if (!this.data.date) this.setData({ date: today() }); this.refresh(); },
  refresh() { try { const state = service.snapshot(); const generation = service.generation(); if (generation !== this.data.generation) this.setData({ dirty: false, generation }); const saved = state.reviews.find(r => r.date === this.data.date); this.setData({ reviews: state.reviews, mode: state.mode, error: '', ...(this.data.dirty ? {} : { text: saved ? saved.text : '' }) }); } catch (e) { this.setData({ error: e.message, reviews: [] }); } },
  selectDate(date) {
    const change = () => { this.setData({ date, dirty: false }); this.refresh(); };
    if (this.data.dirty) wx.showModal({ title: '放弃未保存的内容？', content: '切换日期会丢弃当前编辑内容。', success: r => { if (r.confirm) change(); } }); else change();
  },
  onDate(e) { this.selectDate(e.detail.value); },
  edit(e) { this.selectDate(e.currentTarget.dataset.date); },
  onText(e) { this.setData({ text: e.detail.value, dirty: true }); },
  save() { try { service.saveReview(this.data.date, this.data.text); this.setData({ dirty: false }); this.refresh(); wx.showToast({ title: '复盘已保存' }); } catch (e) { showError(e); } },
});
