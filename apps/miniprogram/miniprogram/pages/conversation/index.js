const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', id: '', conversation: null, messages: [], runs: [], question: '', label: '' },
  onLoad(options = {}) { this.setData({ id: options.id || '', label: service.ai().capabilities().label }); this.refresh(); },
  onShow() { if (this.data.id) this.refresh(); },
  refresh() { try { const view = service.ai().conversation(this.data.id); this.setData({ conversation: view.conversation, messages: view.messages, runs: view.runs, error: '' }); } catch (e) { this.setData({ error: e.message }); } },
  onQuestion(e) { this.setData({ question: e.detail.value }); },
  send() { try { if (!this.data.question.trim()) throw Error('请先填写追问。'); const result = service.ai().followUp({ conversationId: this.data.id, journalDate: today(), question: this.data.question }); this.setData({ question: '' }); this.refresh(); wx.showToast({ title: '已离线演示并归档' }); return result; } catch (e) { showError(e); } },
});
