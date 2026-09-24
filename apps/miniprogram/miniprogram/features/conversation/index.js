const { conversationView } = require('../../utils/journal');
const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', id: '', conversation: null, messages: [], runs: [], question: '', previewData: null, label: '', cloud: false, busy: false, marketPreparing: false, noteMessageId: '', noteDraft: '', focusMessage: '', turns: [], nextQuestions: [], title: '', inputFocus: false },
  async onLoad(options = {}) { this.setData({ id: options.id || '', focusMessage: options.messageId || '' }); const capability = await service.ai().capabilities(); this.setData({ label: capability.label, cloud: capability.enabled && capability.providerConfigured && capability.enrolled }); this.refresh(); },
  onShow() { if (this.data.id) this.refresh(); },
  refresh() { this.setData({ selectedSource: null }); try {
    const view = service.ai().conversation(this.data.id);
    if (this._workspaceInstance && this._workspaceInstance !== view.conversation.workspace_instance_id) this.invalidate();
    this._workspaceInstance = view.conversation.workspace_instance_id;
    const display = conversationView(view);
    const previous = new Map((this.data.turns || []).map(turn => [turn.id, turn]));
    display.turns = display.turns.map(turn => ({ ...turn, expanded: previous.get(turn.id)?.expanded || false, questionOpen: previous.get(turn.id)?.questionOpen || false }));
    const focused = display.turns.find(turn => turn.userId === this.data.focusMessage);
    this.setData({ ...display, conversation: view.conversation, messages: view.messages, runs: view.runs, focusMessage: focused?.id || this.data.focusMessage, error: '' });
    if (this.data.focusMessage && !this._focusedOnce) { this._focusedOnce = true; wx.nextTick?.(() => wx.pageScrollTo({ selector: `#message-${this.data.focusMessage}`, duration: 0 })); }
  } catch (e) { this.setData({ error: e.message }); } },
  toggleTurn(e) { const { id, field } = e.currentTarget.dataset; if (!['expanded', 'questionOpen'].includes(field)) return; this.setData({ turns: this.data.turns.map(turn => turn.id === id ? { ...turn, [field]: !turn[field] } : turn) }); },
  chooseQuestion(e) { this.onQuestion({ detail: { value: e.currentTarget.dataset.question } }); this.setData({ inputFocus: true }); wx.pageScrollTo({ selector: '#follow-up', duration: 200 }); },
  supplement() { this.chooseQuestion({ currentTarget: { dataset: { question: '补充我的持仓：持有数量为___股，成本价为___，最大持仓为___股。请据此分析持仓情景。' } } }); },
  more() { wx.showActionSheet({ itemList: ['删除会话'], success: result => { if (result.tapIndex === 0) this.deleteConversation(); } }); },
  openSource(e) { try {
    const id = e.currentTarget.dataset.id;
    const detail = this.data.turns.flatMap(turn => turn.sources).find(source => source.id === id);
    const ids = detail?.sourceIds || [id];
    const sources = service.ai().conversation(this.data.id).sources || [];
    const selected = ids.map(sourceId => sources.find(source => source.id === sourceId));
    if (selected.some(source => !source) || !selected.length) throw Error('来源已失效或已删除。');
    this.setData({ selectedSource: { ...selected[0], content: selected.map(source => source.content).join('\n\n'), content_digest: selected.map(source => source.content_digest).join('\n') } });
  } catch (e) { this.setData({ selectedSource: null }); showError(e); } },
  closeSource() { this.setData({ selectedSource: null }); },
  invalidate() { this._draftRevision = (this._draftRevision || 0) + 1; this._previewRevision = null; this._confirmedInput = null; this._confirmedPreview = null; this.setData({ previewData: null }); },
  onQuestion(e) { this.setData({ question: e.detail.value }); this.invalidate(); },
  input() { const current = service.ai().conversation(this.data.id).conversation; const instrument = current.origin === 'instrument' && current.anchor_id ? service.ai().confirmResearchInstrument(current.anchor_id, 'STOCK') : undefined; return { origin: current.origin, conversationId: current.id, anchorId: current.anchor_id, instrument, mode: 'follow_up', journalDate: today(), question: this.data.question, includeHistory: true }; },
  async preview() { const revision=this._draftRevision||0; try { if (!this.data.question.trim()) throw Error('请先填写追问。'); const input = this.input(); const local = service.ai().previewContext(input); this.setData({marketPreparing:true,previewData:null,error:''}); let marketReceipt=null; if((input.origin==='portfolio'||input.origin==='instrument') && service.prepareAnalysisMarket)marketReceipt=await service.prepareAnalysisMarket('follow_up', input.origin==='instrument' ? input.anchorId : undefined); if(revision!==(this._draftRevision||0))return; const series=marketReceipt?.series||[]; const marketError=series.length&&!series.some(row=>row.status==='available'&&row.bars.length)?'研究 K 线暂不可用，请稍后重新获取。':''; const preview={...local,...(marketReceipt?{marketReceipt}:{})}; this._confirmedInput=input; this._confirmedPreview=preview; this._previewRevision=revision; this.setData({previewData:{...preview,marketRows:series.map(row=>({symbol:row.symbol,status:row.status,count:row.bars.length,reason:row.reason})),missingText:local.missingInformation.join('、')},error:marketError}); } catch (e) { if(revision===(this._draftRevision||0))this.setData({error:e.message}); } finally { if(revision===(this._draftRevision||0))this.setData({marketPreparing:false}); } },
  async send() { if (this.data.busy || this.data.marketPreparing || this.data.error) return; try { if (!this._confirmedInput || this._previewRevision !== (this._draftRevision || 0)) throw Error('请先查看本次追问将使用的信息。'); let capability = await service.ai().capabilities(); if (!capability.enabled || !capability.providerConfigured || !capability.enrolled) throw Error(capability.label); if (!capability.consented) { const accepted = await new Promise(resolve => wx.showModal({ title: '确认使用云端 AI', content: '本轮会把预览中的持仓信息、所选个人内容、问题和会话历史发送到本项目云服务和模型服务。你可以取消并继续使用本地记录。', confirmText: '同意并继续', success: result => resolve(result.confirm), fail: () => resolve(false) })); if (!accepted) throw Error('已取消云端处理。'); capability = await service.ai().acceptConsent(capability.consentVersion); } if (!capability.authorized) throw Error(capability.label); this.setData({ busy: true }); const prepared = service.ai().prepare(this._confirmedInput, this._confirmedPreview); this._confirmedInput = null; this._confirmedPreview = null; this._previewRevision = null; this.setData({ previewData: null }); const result = await service.ai().submitPrepared(prepared); if (result?.conversation) { this.setData({ question: '' }); this.refresh(); wx.showToast({ title: '已保存' }); } else wx.showToast({ title: '已提交，请到投研页查询', icon: 'none' }); } catch (e) { this.setData({ error: e.message }); showError(e); } finally { this.setData({ busy: false }); } },
  startSaveNote(e) { const message = this.data.messages.find(item => item.id === e.currentTarget.dataset.id && item.role === 'assistant'); if (message) this.setData({ noteMessageId: message.id, noteDraft: '' }); },
  onNoteDraft(e) { this.setData({ noteDraft: e.detail.value }); },
  cancelSaveNote() { this.setData({ noteMessageId: '', noteDraft: '' }); },
  confirmSaveNote() { try { service.journal().savePersonalNote(today(), this.data.noteDraft); this.cancelSaveNote(); wx.showToast({ title: '想法已保存' }); } catch (e) { showError(e); } },
  deleteConversation() { wx.showModal({ title: '删除这段会话？', content: '会话原文及依赖它的 AI 内容会被清除，删除后不可恢复；持仓和交易流水不会受影响。', confirmText: '删除', success: result => { if (!result.confirm) return; try { service.journal().deleteConversation(this.data.id); wx.switchTab({ url: '/pages/research/index' }); } catch (e) { showError(e); } } }); },
});
