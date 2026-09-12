const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', date: '', today: '', text: '', timeline: [], visible: [], filter: 'all', mode: '', dirty: false, workspaceToken: '', editingId: '', editingRevision: '' },
  onShow() { this.setData({ today: today() }); if (!this.data.date) this.setData({ date: today() }); this.refresh(); },
  refresh() { try { const state = service.journal().read(), token = `${state.instance_id}:${state.root_generation}`; if (this.data.workspaceToken && token !== this.data.workspaceToken) this.setData({ dirty: false, text: '', editingId: '', editingRevision: '' }); const timeline = service.journalTimeline(this.data.date); this.setData({ timeline, visible: this.filtered(timeline, this.data.filter), mode: service.snapshot().mode, workspaceToken: token, error: '' }); } catch (e) { this.setData({ error: e.message, timeline: [], visible: [] }); } },
  filtered(items, filter) { if (filter === 'mine') return items.filter(item => item.kind === 'personal_note' || item.kind === 'user_decision'); if (filter === 'ai') return items.filter(item => item.kind === 'analysis'); if (filter === 'trade') return items.filter(item => item.kind === 'trade'); return items; },
  selectDate(date) { const change = () => { this.setData({ date, dirty: false, text: '', editingId: '', editingRevision: '' }); this.refresh(); }; if (this.data.dirty) wx.showModal({ title: '放弃未保存的内容？', content: '切换日期会丢弃当前编辑内容。', success: result => { if (result.confirm) change(); } }); else change(); },
  onDate(e) { this.selectDate(e.detail.value); },
  setFilter(e) { const filter = e.currentTarget.dataset.filter; this.setData({ filter, visible: this.filtered(this.data.timeline, filter) }); },
  onText(e) { this.setData({ text: e.detail.value, dirty: true }); },
  newNote() { this.setData({ text: '', editingId: '', editingRevision: '', dirty: false }); },
  edit(e) { const item = this.data.timeline.find(candidate => candidate.id === e.currentTarget.dataset.id); if (item?.kind === 'personal_note') this.setData({ text: item.body, editingId: item.id, editingRevision: item.revisionId, dirty: false }); },
  save() { try { service.journal().savePersonalNote(this.data.date, this.data.text, this.data.editingId || undefined, this.data.editingRevision || undefined); this.setData({ dirty: false, text: '', editingId: '', editingRevision: '' }); this.refresh(); wx.showToast({ title: '记录已保存' }); } catch (e) { showError(e); } },
  askAi() { wx.navigateTo({ url: `/pages/research/index?mode=daily_review&date=${encodeURIComponent(this.data.date)}` }); },
  continueConversation(e) { wx.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }); },
  openTrade(e) { wx.navigateTo({ url: `/pages/entry/index?recordId=${encodeURIComponent(e.currentTarget.dataset.id)}` }); },
});
