const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', capability: null, mode: 'portfolio_review', journalDate: '', symbol: '', question: '我的持仓有哪些需要注意？', previewData: null, recent: [], pending: [], includeJournal: true, includeTradeReasons: true, includePolicy: true, includeHistory: true, busy: false, marketPreparing: false, historyOpen: false, month: '', selectedDate: '', calendarDays: [], historyItems: [], noteOpen: false, noteText: '' },
  onLoad(options = {}) { this.setData({ journalDate: options.date || today(), mode: options.mode || (options.symbol ? 'instrument_research' : 'portfolio_review'), symbol: options.symbol || '', question: options.mode === 'daily_review' ? '请根据已选的当日记录帮我复盘。' : this.data.question }); },
  async onShow() {
    try {
      this.consumeIntent();
      const state = service.journal().read();
      if (this._workspaceInstance && this._workspaceInstance !== state.instance_id) this.invalidate();
      this._workspaceInstance = state.instance_id;
      const label = run => run.execution_kind === 'real' ? (run.data_mode === 'demo' ? '真实模型 · 示例数据' : '真实模型') : (run.data_mode === 'demo' ? '离线合成 · 示例数据' : '离线合成 · 个人数据');
      this.setData({ capability: await service.ai().capabilities(), pending: service.ai().pending(), recent: state.runs.slice().reverse().slice(0, 5).map(run => ({ id: run.id, conversationId: run.conversation_id, date: run.journal_date, summary: run.result.summary, label: label(run) })), error: '' });
    } catch (e) { this.setData({ error: e.message }); }
  },
  consumeIntent() {
    const key = 'portfolio.wechat.navigation-intent.v1', intent = wx.getStorageSync(key);
    if (!intent) return;
    wx.removeStorageSync(key);
    if (!intent.expiresAt || intent.expiresAt < Date.now()) return;
    if (intent.type === 'instrument_research') this.setData({ mode: 'instrument_research', symbol: intent.symbol || '', question: intent.question || '请帮我研究这个标的。' });
    else if (intent.type === 'journal_date') { this.setData({ journalDate: intent.date || today(), selectedDate: intent.date || today(), historyOpen: true }); this.loadHistory(intent.date || today()); }
    else this.setData({ mode: 'portfolio_review', symbol: '', question: intent.question || '我的持仓有哪些需要注意？' });
    this.invalidate();
  },
  newConversation() { this.setData({ mode: 'portfolio_review', symbol: '', question: '', previewData: null, noteOpen: false }); this.invalidate(); },
  toggleHistory() {
    const open = !this.data.historyOpen, date = this.data.selectedDate || today(), month = date.slice(0, 7);
    this.setData({ historyOpen: open, selectedDate: date, month });
    if (open) { this.loadCalendar(month); this.loadHistory(date); }
  },
  loadCalendar(month) { try { const result = service.journal().calendarMonth(month), marked = new Set(Array.isArray(result) ? result.map(item => item.day) : result.days), [year, monthNumber] = month.split('-').map(Number), count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(); this.setData({ month, calendarDays: Array.from({ length: count }, (_, index) => { const day = `${month}-${String(index + 1).padStart(2, '0')}`; return { day, label: String(index + 1), hasItems: marked.has(day) }; }) }); } catch (e) { this.setData({ error: e.message }); } },
  loadHistory(date) { try { this.setData({ selectedDate: date, journalDate: date, historyItems: service.journal().history(date), error: '' }); } catch (e) { this.setData({ error: e.message, historyItems: [] }); } },
  changeMonth(delta) { const [year, month] = this.data.month.split('-').map(Number), value = new Date(Date.UTC(year, month - 1 + delta, 1)), next = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`; this.loadCalendar(next); },
  previousMonth() { this.changeMonth(-1); },
  nextMonth() { this.changeMonth(1); },
  selectHistoryDay(e) { this.loadHistory(e.currentTarget.dataset.day); },
  openHistoryItem(e) { const item = this.data.historyItems.find(candidate => candidate.id === e.currentTarget.dataset.id); if (item?.conversationId) wx.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(item.conversationId)}&messageId=${encodeURIComponent(item.id)}` }); },
  deleteHistoryItem(e) {
    const item = this.data.historyItems.find(candidate => candidate.id === e.currentTarget.dataset.id);
    if (!item || item.kind !== 'personal_note') return;
    wx.showModal({ title: '删除这条个人手记？', content: '原文和依赖它生成的 AI 内容会被清除，删除后不可恢复；交易流水不会受影响。', confirmText: '删除', success: result => { if (!result.confirm) return; try { service.journal().deletePersonalNote(item.id); this.loadCalendar(this.data.month); this.loadHistory(this.data.selectedDate); } catch (error) { showError(error); } } });
  },
  startNote() { this.setData({ noteOpen: true, noteText: '' }); },
  cancelNote() { this.setData({ noteOpen: false, noteText: '' }); },
  onNote(e) { this.setData({ noteText: e.detail.value }); },
  saveNote() { try { service.journal().savePersonalNote(this.data.selectedDate || today(), this.data.noteText); this.setData({ noteOpen: false, noteText: '' }); if (this.data.historyOpen) { this.loadCalendar(this.data.month || today().slice(0, 7)); this.loadHistory(this.data.selectedDate || today()); } wx.showToast({ title: '手记已保存' }); } catch (e) { showError(e); } },
  invalidate() { this._draftRevision = (this._draftRevision || 0) + 1; this._previewRevision = null; this._confirmedInput = null; this._confirmedPreview = null; this.setData({ previewData: null, marketPreparing: false }); },
  selectPortfolio() { this.setData({ mode: 'portfolio_review' }); this.invalidate(); },
  selectInstrument() { this.setData({ mode: 'instrument_research' }); this.invalidate(); },
  onSymbol(e) { this.setData({ symbol: e.detail.value.toUpperCase() }); this.invalidate(); },
  onQuestion(e) { this.setData({ question: e.detail.value }); this.invalidate(); },
  toggleSelections(e) { const selected = new Set(e.detail.value); this.setData({ includeJournal: selected.has('includeJournal'), includeTradeReasons: selected.has('includeTradeReasons'), includePolicy: selected.has('includePolicy') }); this.invalidate(); },
  input() { const instrument = this.data.mode === 'instrument_research' ? service.ai().confirmResearchInstrument(this.data.symbol, 'STOCK') : undefined; return { origin: this.data.mode === 'instrument_research' ? 'instrument' : this.data.mode === 'daily_review' ? 'daily_review' : 'portfolio', mode: this.data.mode, journalDate: this.data.journalDate, question: this.data.question, anchorId: instrument?.symbol ?? (this.data.mode === 'daily_review' ? this.data.journalDate : null), instrument, includeJournal: this.data.includeJournal, includeTradeReasons: this.data.includeTradeReasons, includePolicy: this.data.includePolicy, includeHistory: this.data.includeHistory }; },
  preview() { try { const input = this.input(), local = service.ai().previewContext(input), revision = this._draftRevision || 0; this._confirmedInput = input; this._confirmedPreview = local; this._previewRevision = revision; this.setData({ previewData: { ...local, missingText: local.missingInformation.join('、'), marketQuotes: [], marketExpiresAt: '' }, error: '' }); if (!service.prepareAnalysisMarket) return; this.setData({ marketPreparing: true }); Promise.resolve(service.prepareAnalysisMarket(input.mode, input.instrument?.symbol)).then(marketReceipt => { if (this._previewRevision !== revision || !marketReceipt) return; const preview = { ...local, marketReceipt }; this._confirmedPreview = preview; this.setData({ previewData: { ...preview, missingText: local.missingInformation.filter(item => item !== '实时报价').join('、'), marketQuotes: marketReceipt.quotes, marketExpiresAt: marketReceipt.expires_at } }); }).catch(e => this.setData({ error: e.message })).finally(() => this.setData({ marketPreparing: false })); } catch (e) { this._confirmedInput = null; this._confirmedPreview = null; this._previewRevision = null; this.setData({ error: e.message, marketPreparing: false }); } },
  async runCloud() {
    if (this.data.busy || this.data.marketPreparing) return;
    try {
      if (!this._confirmedInput || this._previewRevision !== (this._draftRevision || 0)) throw Error('请先查看本次分析内容，再确认发送。');
      let capability = await service.ai().capabilities();
      if (!capability.enabled || !capability.providerConfigured || !capability.enrolled) throw Error(capability.label);
      if (!capability.consented) {
        const accepted = await new Promise(resolve => wx.showModal({ title: '确认使用云端 AI', content: '本轮会把你预览中的持仓数量与成本、所选个人记录和交易理由、投资计划、问题，以及勾选的会话历史发送到本项目云服务和模型服务。不会发送模型密钥，也不会自动执行交易。你可以取消并继续使用本地记账。', confirmText: '同意并继续', cancelText: '取消', success: result => resolve(result.confirm), fail: () => resolve(false) }));
        if (!accepted) throw Error('已取消云端处理；本地记录和历史仍可使用。');
        capability = await service.ai().acceptConsent(capability.consentVersion);
      }
      if (!capability.authorized) throw Error(capability.label);
      this.setData({ busy: true }); const prepared = service.ai().prepare(this._confirmedInput, this._confirmedPreview); this._confirmedInput = null; this._confirmedPreview = null; this._previewRevision = null; this.setData({ previewData: null }); const result = await service.ai().submitPrepared(prepared);
      if (result?.conversation) { wx.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(result.conversation.id)}` }); }
      else { this.onShow(); wx.showToast({ title: '已提交，可在待完成任务中查询', icon: 'none' }); }
    } catch (e) { this.setData({ error: e.message }); showError(e); } finally { this.setData({ busy: false }); }
  },
  async recover(e) { if (this.data.busy) return; try { this.setData({ busy: true }); await service.ai().recoverPending(e.currentTarget.dataset.id); this.onShow(); } catch (error) { showError(error); } finally { this.setData({ busy: false }); } },
  openConversation(e) { wx.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }); },
});
