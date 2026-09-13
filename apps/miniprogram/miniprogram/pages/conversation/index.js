const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', id: '', conversation: null, messages: [], runs: [], question: '', label: '', cloud: false, busy: false },
  onLoad(options = {}) { const capability = service.ai().capabilities(); this.setData({ id: options.id || '', label: capability.label, cloud: capability.realProviderConfigured }); this.refresh(); },
  onShow() { if (this.data.id) this.refresh(); },
  refresh() { try { const view = service.ai().conversation(this.data.id); this.setData({ conversation: view.conversation, messages: view.messages, runs: view.runs, error: '' }); } catch (e) { this.setData({ error: e.message }); } },
  onQuestion(e) { this.setData({ question: e.detail.value }); },
  async send() { if (this.data.busy) return; try { if (!this.data.question.trim()) throw Error('请先填写追问。'); this.setData({ busy: true }); let result; if (this.data.cloud) { const current = service.ai().conversation(this.data.id).conversation; const instrument = current.origin === 'instrument' && current.anchor_id ? service.ai().confirmResearchInstrument(current.anchor_id, 'STOCK') : undefined; const prepared = service.ai().prepare({ origin: current.origin, conversationId: current.id, anchorId: current.anchor_id, instrument, mode: 'follow_up', journalDate: today(), question: this.data.question, includeHistory: true }); result = await service.ai().submitPrepared(prepared); } else result = service.ai().followUp({ conversationId: this.data.id, journalDate: today(), question: this.data.question }); if (result?.conversation) { this.setData({ question: '' }); this.refresh(); wx.showToast({ title: this.data.cloud ? '已归档' : '已离线演示并归档' }); } } catch (e) { showError(e); } finally { this.setData({ busy: false }); } },
});
