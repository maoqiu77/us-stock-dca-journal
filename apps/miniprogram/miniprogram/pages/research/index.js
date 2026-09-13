const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', capability: null, mode: 'portfolio_review', journalDate: '', symbol: '', question: '我的持仓有哪些需要注意？', previewData: null, result: null, conversationId: '', recent: [], candidateUnavailable: false, includeJournal: true, includeTradeReasons: true, includePolicy: true, includeHistory: true, busy: false },
  onLoad(options = {}) { this.setData({ journalDate: options.date || today(), mode: options.mode || (options.symbol ? 'instrument_research' : 'portfolio_review'), symbol: options.symbol || '', question: options.mode === 'daily_review' ? '请根据已选的当日记录帮我复盘。' : this.data.question }); },
  onShow() { try { const state = service.journal().read(); this.setData({ capability: service.ai().capabilities(), recent: state.runs.slice().reverse().slice(0, 5).map(run => ({ id: run.id, conversationId: run.conversation_id, date: run.journal_date, summary: run.result.summary, demo: run.execution_kind === 'fake' })), error: '' }); } catch (e) { this.setData({ error: e.message }); } },
  selectPortfolio() { this.setData({ mode: 'portfolio_review', candidateUnavailable: false, previewData: null, result: null }); },
  selectInstrument() { this.setData({ mode: 'instrument_research', candidateUnavailable: false, previewData: null, result: null }); },
  selectCandidate() { this.setData({ candidateUnavailable: true, previewData: null, result: null }); },
  onSymbol(e) { this.setData({ symbol: e.detail.value.toUpperCase(), previewData: null }); },
  onQuestion(e) { this.setData({ question: e.detail.value, previewData: null }); },
  toggleSelection(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value.length > 0, previewData: null }); this._prepared = null; },
  preview() { try { const instrument = this.data.mode === 'instrument_research' ? service.ai().confirmResearchInstrument(this.data.symbol, 'STOCK') : undefined; const anchorId = instrument?.symbol ?? (this.data.mode === 'daily_review' ? this.data.journalDate : null); this._prepared = service.ai().prepare({ origin: this.data.mode === 'instrument_research' ? 'instrument' : this.data.mode === 'daily_review' ? 'daily_review' : 'portfolio', mode: this.data.mode, journalDate: this.data.journalDate, question: this.data.question, anchorId, instrument, includeJournal: this.data.includeJournal, includeTradeReasons: this.data.includeTradeReasons, includePolicy: this.data.includePolicy, includeHistory: this.data.includeHistory }); const preview = this._prepared.preview; this.setData({ previewData: { ...preview, missingText: preview.missingInformation.join('、'), digest: this._prepared.envelope.payload_digest.slice(0, 12) }, error: '' }); } catch (e) { this._prepared = null; this.setData({ result: null, error: e.message }); } },
  runDemo() {
    try {
      if (!this._prepared) this.preview();
      if (!this._prepared) throw Error(this.data.error || '未能准备分析。');
      const result = service.ai().runPreparedFake(this._prepared);
      this._prepared = null;
      this.setData({ result: result.result, conversationId: result.conversation.id, error: '' });
      wx.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(result.conversation.id)}` });
    } catch (e) { this.setData({ result: null, error: e.message }); showError(e); }
  },
  async runCloud() { if (this.data.busy) return; try { if (!this._prepared) this.preview(); if (!this._prepared) return; this.setData({ busy: true }); const result = await service.ai().submitPrepared(this._prepared); if (result?.conversation) { this._prepared = null; wx.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(result.conversation.id)}` }); } else wx.showToast({ title: '已提交，稍后查询', icon: 'none' }); } catch (e) { showError(e); } finally { this.setData({ busy: false }); } },
  openConversation(e) { wx.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }); },
});
