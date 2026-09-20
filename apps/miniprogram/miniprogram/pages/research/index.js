const { historyCard, questionTitle } = require('../../utils/journal');
const PICKS = { US: [{symbol:'AAPL',name:'苹果',assetType:'STOCK'},{symbol:'NVDA',name:'英伟达',assetType:'STOCK'},{symbol:'MSFT',name:'微软',assetType:'STOCK'},{symbol:'QQQ',name:'纳指100 ETF',assetType:'ETF'}], CN:[{symbol:'588000',name:'科创50 ETF',assetType:'ETF'},{symbol:'600519',name:'贵州茅台',assetType:'STOCK'},{symbol:'300750',name:'宁德时代',assetType:'STOCK'},{symbol:'002594',name:'比亚迪',assetType:'STOCK'}], HK:[{symbol:'00700',name:'腾讯控股',assetType:'STOCK'},{symbol:'09988',name:'阿里巴巴',assetType:'STOCK'},{symbol:'02800',name:'盈富基金',assetType:'ETF'},{symbol:'03690',name:'美团',assetType:'STOCK'}] };
const PERIODS = [{id:'1day',label:'日线'},{id:'60min',label:'60分'},{id:'30min',label:'30分'},{id:'15min',label:'15分'},{id:'5min',label:'5分'},{id:'1min',label:'1分'}];
const { service, today, showError } = require('../../lib/core');
Page({
  data: { market:'US', markets:[{id:'CN',label:'A股'},{id:'HK',label:'港股'},{id:'US',label:'美股'}], picks:PICKS.US, periods:PERIODS, period:'1day', auxiliary:[], auxiliaryOptions:PERIODS.slice(1), assetType:'STOCK', quantity:'', costPrice:'', maxQuantity:'', includePositions:true, planText:'', domesticInstrument: null, holdingId: '', error: '', capability: null, mode: 'portfolio_review', journalDate: '', symbol: '', question: '我的持仓有哪些需要注意？', previewData: null, recent: [], pending: [], includeJournal: false, includeTradeReasons: false, includePolicy: true, includeHistory: false, busy: false, marketPreparing: false, historyOpen: false, weekdays: ['一', '二', '三', '四', '五', '六', '日'], month: '', selectedDate: '', calendarDays: [], historyItems: [], noteOpen: false, noteText: '' },
  onLoad(options = {}) { this.setData({ journalDate: options.date || today(), mode: options.mode || (options.symbol ? 'instrument_research' : 'portfolio_review'), symbol: options.symbol || '', question: options.mode === 'daily_review' ? '请根据已选的当日记录帮我复盘。' : this.data.question }); },
  onHide() { this.invalidate(); },
  onUnload() { this.invalidate(); },
  async onShow() {
    try {
      const state = service.journal().read();
      if (this._workspaceInstance && this._workspaceInstance !== state.instance_id) this.newConversation();
      this._workspaceInstance = state.instance_id;
      this.consumeIntent();
      const policy = state.policies?.at(-1); if(this._policyRevision !== policy?.revision_id) this.invalidate(); this._policyRevision=policy?.revision_id; this.setData({planText:policy?.status === 'confirmed' ? policy.description || [policy.horizon, policy.max_single_weight ? '最大单标的权重 '+Number(policy.max_single_weight)*100+'%' : ''].filter(Boolean).join('；') : ''});
      this.setData({ recent: service.journal().conversationHistory().slice(0, 5).map(historyCard), error: '' });
      this.reconcilePending().catch(() => {});
      this.setData({ capability: await service.ai().capabilities() });
      if (this.data.historyOpen) { this.loadCalendar(this.data.month || (this.data.selectedDate || today()).slice(0, 7)); this.loadHistory(this.data.selectedDate || today()); }

    } catch (e) { this.setData({ error: e.message }); }
  },
  async reconcilePending() {
    if (this._recovering) return;
    this._recovering = true;
    try {
      for (const item of service.ai().pending()) {
        try { await service.ai().recoverPending(item.requestId); } catch (_) { /* Keep this request available for a later visit. */ }
      }
      this.setData({ recent: service.journal().conversationHistory().slice(0, 5).map(historyCard) });
      if (this.data.historyOpen) { this.loadCalendar(this.data.month); this.loadHistory(this.data.selectedDate); }
    } finally { this._recovering = false; }
  },
  consumeIntent() {
    const key = 'portfolio.wechat.navigation-intent.v1', intent = wx.getStorageSync(key);
    if (!intent) return;
    wx.removeStorageSync(key);
    if (!intent.expiresAt || intent.expiresAt < Date.now() || intent.workspaceId !== service.journal().read().instance_id) return;
    if (!['domestic_research', 'holding_research', 'instrument_research', 'journal_date', 'portfolio_review'].includes(intent.type)) return;
    this.setData({ domesticInstrument: null, holdingId: '' });
    if (intent.type === 'domestic_research') { const row = (service.marketDiscovery().domestic || []).find(row => row.instrument.instrument_key === intent.instrumentKey); if (!row) return; this.setData({ mode: 'portfolio_review', domesticInstrument: row.instrument, question: `帮我研究 ${row.instrument.name}（${row.instrument.symbol}）；本次未提供授权行情，不要虚构价格和净值。` }); }
    else if (intent.type === 'holding_research') { const detail = service.positionDetail(intent.holdingId); this.setData({ mode: 'portfolio_review', holdingId: detail.id, question: intent.question || '分析这项持仓' }); }
    else if (intent.type === 'instrument_research') this.setData({ mode: 'instrument_research', market:'US', picks:PICKS.US, symbol: intent.symbol || '', assetType: 'STOCK' });
    else if (intent.type === 'journal_date') { this.setData({ journalDate: intent.date || today(), selectedDate: intent.date || today(), historyOpen: true }); this.loadHistory(intent.date || today()); }
    else this.setData({ mode: 'portfolio_review', symbol: '', question: intent.question || '我的持仓有哪些需要注意？' });
    this.invalidate();
  },
  newConversation() { this.setData({ historyOpen: false, domesticInstrument: null, holdingId: '', mode: 'portfolio_review', includePositions:true, includePolicy:true, quantity:'', costPrice:'', maxQuantity:'', symbol: '', question: '', previewData: null, noteOpen: false }); this.invalidate(); },
  showAnalysis() { this.setData({ historyOpen: false }); },
  showRecords() { const date = this.data.selectedDate || today(); this.setData({ historyOpen: true }); this.loadCalendar(date.slice(0, 7)); this.loadHistory(date); },
  goToday() { this.loadCalendar(today().slice(0, 7)); this.loadHistory(today()); },
  toggleHistory() {
    const open = !this.data.historyOpen, date = this.data.selectedDate || today(), month = date.slice(0, 7);
    this.setData({ historyOpen: open, selectedDate: date, month });
    if (open) { this.loadCalendar(month); this.loadHistory(date); }
  },
  loadCalendar(month) { try {
    const result = service.journal().calendarMonth(month), marked = new Set(Array.isArray(result) ? result.map(item => item.day) : result.days);
    const [year, monthNumber] = month.split('-').map(Number), count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const offset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
    const cells = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
      const number = index - offset + 1, day = number > 0 && number <= count ? `${month}-${String(number).padStart(2, '0')}` : '';
      return { id: `${month}-${index}`, day, label: day ? String(number) : '', hasItems: marked.has(day), isToday: day === today() };
    });
    this.setData({ month, calendarDays: cells });
  } catch (e) { this.setData({ error: e.message }); } },
  loadHistory(date) { try { this.setData({ selectedDate: date, journalDate: date, historyItems: service.journal().conversationHistory(date).map(historyCard), error: '' }); } catch (e) { this.setData({ error: e.message, historyItems: [] }); } },
  changeMonth(delta) { const [year, month] = this.data.month.split('-').map(Number), value = new Date(Date.UTC(year, month - 1 + delta, 1)), next = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`; this.loadCalendar(next); this.loadHistory(next === today().slice(0, 7) ? today() : `${next}-01`); },
  previousMonth() { this.changeMonth(-1); },
  nextMonth() { this.changeMonth(1); },
  selectHistoryDay(e) { if (e.currentTarget.dataset.day) this.loadHistory(e.currentTarget.dataset.day); },
  openHistoryItem(e) { const item = this.data.historyItems.find(candidate => candidate.id === e.currentTarget.dataset.id); if (item?.conversationId) wx.navigateTo({ url: `/features/conversation/index?id=${encodeURIComponent(item.conversationId)}&messageId=${encodeURIComponent(item.messageId)}` }); },
  viewNote(e) { const item = this.data.historyItems.find(row => row.id === e.currentTarget.dataset.id); if (item?.kind === 'personal_note') wx.showModal({ title: '个人手记', content: item.summary, showCancel: false }); },
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
  selectPortfolio() { this.setData({ domesticInstrument: null, holdingId: '' }); this.setData({ mode: 'portfolio_review', includePositions:true, includePolicy:true }); this.invalidate(); },
  selectInstrument() { this.setData({ domesticInstrument: null, holdingId: '', mode: 'instrument_research' }); this.invalidate(); },
  selectMarket(e) { const market=e.currentTarget.dataset.market; if (!PICKS[market]) return; this.setData({market,picks:PICKS[market],symbol:'',assetType:'STOCK',quantity:'',costPrice:'',maxQuantity:''}); this.invalidate(); },
  pickInstrument(e) { const item=this.data.picks.find(x=>x.symbol===e.currentTarget.dataset.symbol); if(item){this.setData({symbol:item.symbol,assetType:item.assetType});this.invalidate();} },
  selectPeriod(e) { const period=e.currentTarget.dataset.period; this.setData({period,auxiliary:this.data.auxiliary.filter(p=>p!==period)}); this.periodOptions();this.invalidate(); },
  selectAuxiliary(e) { const period=e.currentTarget.dataset.period; const auxiliary=this.data.auxiliary.includes(period)?this.data.auxiliary.filter(p=>p!==period):[...this.data.auxiliary,period];this.setData({auxiliary});this.periodOptions();this.invalidate(); },
  periodOptions() { this.setData({auxiliaryOptions:PERIODS.filter(p=>p.id!==this.data.period).map(p=>({...p,selected:this.data.auxiliary.includes(p.id)}))}); },
  onParameter(e) { const field=e.currentTarget.dataset.field;if(['quantity','costPrice','maxQuantity'].includes(field)){this.setData({[field]:e.detail.value});this.invalidate();} },
  editPlan() { wx.navigateTo({url:'/features/settings/index'}); },
  onSymbol(e) { this.setData({ symbol: e.detail.value.trim().toUpperCase(), assetType:'STOCK' }); this.invalidate(); },
  onQuestion(e) { this.setData({ question: e.detail.value }); this.invalidate(); },
  toggleSelections(e) { const selected = new Set(e.detail.value); this.setData({ includePositions: selected.has('includePositions'), includeJournal: false, includeTradeReasons: false, includePolicy: selected.has('includePolicy'), includeHistory:false }); this.invalidate(); },
  input() {
    const research=this.data.mode==='instrument_research';
    const instrument=research?service.ai().confirmResearchInstrument(this.data.symbol,this.data.assetType,this.data.market):undefined;
    let question=this.data.question;
    if(research){
      for(const field of ['quantity','costPrice','maxQuantity']) {const value=this.data[field].trim();if(value && (!/^\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Number(value)>1e12))throw Error('持仓参数请填写有效的非负数字。');}
      if(this.data.quantity.trim() && Number(this.data.quantity)>0 && (!this.data.costPrice.trim()||Number(this.data.costPrice)<=0))throw Error('填写持有数量后，请填写有效成本价。');
      if(this.data.maxQuantity.trim() && this.data.quantity.trim() && Number(this.data.maxQuantity)<Number(this.data.quantity))throw Error('最大持仓不能小于当前持有数量。');
      const label=id=>PERIODS.find(p=>p.id===id)?.label||id;
      question=`请分析 ${this.data.market} 市场的 ${instrument.symbol} 股票或 ETF。主周期：${label(this.data.period)}；辅助周期：${this.data.auxiliary.map(label).join('、')||'无'}。用户填写的持仓参数（未校验的个人输入）：持有数量 ${this.data.quantity.trim()||'未提供'} 股；成本价 ${this.data.costPrice.trim()||'未提供'} ${this.data.market==='US'?'USD':this.data.market==='HK'?'HKD':'CNY'}；最大持仓 ${this.data.maxQuantity.trim()||'未提供'} 股。请结合服务端提供的各周期行情，分析趋势、MA5/MA20/MA60、支撑阻力、风险与持仓情景，区分事实和条件假设。未提供或不可用的周期不得臆测，前复权价格不能直接作为实际成交或盈亏依据。不得自动交易。`;
    }
    return {domesticInstrument:this.data.domesticInstrument||undefined,holdingId:this.data.holdingId||undefined,origin:research?'instrument':this.data.mode==='daily_review'?'daily_review':'portfolio',mode:this.data.mode,journalDate:this.data.journalDate,question,anchorId:instrument ? `${instrument.market}:${instrument.symbol}` : (this.data.mode==='daily_review'?this.data.journalDate:null),instrument,includePositions:research?false:this.data.includePositions,includeJournal:false,includeTradeReasons:false,includePolicy:research?false:this.data.includePolicy,includeHistory:false};
  },
  async preview() {
    const revision=this._draftRevision||0;
    try {
      this._confirmedInput=null;this._confirmedPreview=null;this._previewRevision=null;
      const input=this.input(), local=service.ai().previewContext(input);
      this.setData({previewData:null,error:'',marketPreparing:input.mode==='instrument_research'});
      let marketReceipt=null, researchRows=[];
      if(input.mode==='instrument_research'){
        const selection={market:this.data.market,symbol:input.instrument.symbol,period:this.data.period,auxiliary:this.data.auxiliary};
        const result=await service.researchSnapshot(selection);
        if(revision!==(this._draftRevision||0))return;
        researchRows=result.series.map(row=>({period:PERIODS.find(p=>p.id===row.period)?.label||row.period,provider:row.provider,status:row.status,reason:row.reason,count:row.bars.length,asOf:row.bars.slice(-1)[0]?.time||'',adjustment:row.adjustment==='forward_adjusted'?'前复权':row.adjustment==='split_adjusted'?'拆股调整':'不复权'}));
        if(result.series[0]?.status!=='available') {this.setData({previewData:{...local,researchRows,missingText:local.missingInformation.join('、')},error:'主周期行情不可用，请稍后重新获取。'});return;}
        marketReceipt={...result,quotes:[]};
      } else if(service.prepareAnalysisMarket && input.includePositions && !input.holdingId && !input.domesticInstrument){
        // Public quotes may be unavailable for AI; the local holding/plan preview stays useful.
        try{marketReceipt=await service.prepareAnalysisMarket(input.mode,input.instrument?.symbol);}catch(_){}
      }
      if(revision!==(this._draftRevision||0))return;
      const preview={...local,...(marketReceipt?{marketReceipt}:{})};this._confirmedInput=input;this._confirmedPreview=preview;this._previewRevision=revision;
      this.setData({previewData:{...preview,researchRows,missingText:local.missingInformation.join('、'),marketQuotes:marketReceipt?.quotes||[],marketExpiresAt:marketReceipt?.expires_at||''},error:''});
    }catch(e){if(revision===(this._draftRevision||0))this.setData({error:e.message});}
    finally{if(revision===(this._draftRevision||0))this.setData({marketPreparing:false});}
  },
  async runCloud() {
    if (this.data.busy || this.data.marketPreparing) return;
    try {
      if (!this._confirmedInput || this._previewRevision !== (this._draftRevision || 0)) throw Error('请先查看本次分析内容，再确认发送。');
      let capability = await service.ai().capabilities();
      if (!capability.enabled || !capability.providerConfigured || !capability.enrolled) throw Error(capability.label);
      if (!capability.consented) {
        const accepted = await new Promise((resolve, reject) => wx.showModal({ title: '确认使用云端 AI', content: '本轮会把你预览中的持仓数量与成本、所选个人记录和交易理由、投资计划、问题，以及勾选的会话历史发送到本项目云服务和模型服务。不会发送模型密钥，也不会自动执行交易。你可以取消并继续使用本地记账。', confirmText: '同意继续', cancelText: '取消', success: result => resolve(!!result.confirm), fail: () => reject(Error('云处理确认弹窗未能打开，请重试。')) }));
        if (!accepted) { this.setData({ error: '' }); return; }
        capability = await service.ai().acceptConsent(capability.consentVersion);
      }
      if (!capability.authorized) throw Error(capability.label);
      this.setData({ busy: true }); const prepared = service.ai().prepare(this._confirmedInput, this._confirmedPreview); this._confirmedInput = null; this._confirmedPreview = null; this._previewRevision = null; this.setData({ previewData: null }); const result = await service.ai().submitPrepared(prepared);
      if (result?.conversation) { wx.navigateTo({ url: `/features/conversation/index?id=${encodeURIComponent(result.conversation.id)}` }); }
      else { this.onShow(); wx.showToast({ title: '已提交，稍后返回查看结果', icon: 'none' }); }
    } catch (e) { this.setData({ error: e.message }); showError(e); } finally { this.setData({ busy: false }); }
  },
  async recover(e) { if (this.data.busy) return; try { this.setData({ busy: true }); await service.ai().recoverPending(e.currentTarget.dataset.id); this.onShow(); } catch (error) { showError(error); } finally { this.setData({ busy: false }); } },
  openConversation(e) { wx.navigateTo({ url: `/features/conversation/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }); },
});
