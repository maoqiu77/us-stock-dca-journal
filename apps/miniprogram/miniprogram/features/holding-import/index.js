const { service, showError, normalizeScreenshotMetrics, normalizeScreenshotDocument } = require('../../lib/core');
const requestId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const decimalLike = value => /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(String(value || '').trim());
function allPositions() {
  const seen = new Map();
  for (const currency of ['CNY', 'USD']) {
    try { for (const item of service.overview(undefined, currency).positions || []) seen.set(item.id, item); } catch (_) { /* unavailable currency */ }
  }
  return [...seen.values()];
}
Page({
  data: { error: '', capability: null, images: [], progress: '', failedImages: [], imagePath: '', imageSize: 0, mimeType: 'image/png', stage: 'select', rows: [], document: null, documents: [], busy: false, expectedRevision: 0, previewData: null, selectedCount: 0 },
  draftKey() { return 'portfolio.wechat.holding-review.v1.' + (service.journal ? service.journal().read().instance_id : service.snapshot().portfolio?.id || 'local'); },
  persistDraft() { try { if (this.data.stage !== 'review' || this._ownerKey && this._ownerKey !== this.draftKey()) return; const text = JSON.stringify({ version: 1, revision: this.data.expectedRevision, rows: this.data.rows, documents: this.data.documents, document: this.data.document, drafts: this._drafts || [], batchId: this._batchId || '', observedAt: this._observedAt || '' }); if (text.length > 300000) throw Error('draft_too_large'); wx.setStorageSync(this.draftKey(), text); if (wx.getStorageSync(this.draftKey()) !== text) throw Error('draft_readback_failed'); } catch (_) { this.setData({ error: '草稿未能保存，请保持本页打开。' }); } },
  onHide() { this.persistDraft(); },
  onUnload() { this.persistDraft(); },
  async onLoad() {
    this._ownerKey = this.draftKey();
    try { const draft = JSON.parse(wx.getStorageSync(this.draftKey()) || 'null'); if (draft?.version === 1 && Array.isArray(draft.rows) && draft.revision === service.snapshot().revision) { this._drafts = draft.drafts || []; this._batchId = draft.batchId; this._observedAt = draft.observedAt; this.setData({ rows: draft.rows.map(row => ({ ...row, screenshotMetrics: normalizeScreenshotMetrics({ ...(row.screenshotMetrics || {}), ...(row.screenshotMetrics?.source ? { source: normalizeScreenshotDocument(row.screenshotMetrics.source) } : {}) }) })), documents: (draft.documents || []).map(normalizeScreenshotDocument), document: draft.document || null, stage: 'review', selectedCount: draft.rows.filter(r => r.selected).length }); } } catch (_) { /* Invalid or expired local draft never modifies holdings. */ }
    try { const vision = service.vision(); this.setData({ expectedRevision: service.snapshot().revision, capability: vision ? await vision.capabilities() : { enabled: false, providerConfigured: false, maxBytes: 4194304, maxRows: 20 } }); }
    catch (_) { this.setData({ capability: { enabled: false, providerConfigured: false, maxBytes: 4194304, maxRows: 20 } }); }
  },
  chooseImage() {
    if (this.data.busy) return;
    wx.chooseMedia({ count: 9, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: result => {
      const files = result.tempFiles || []; if (!files.length) return;
      const max = this.data.capability?.maxBytes || 4194304;
      if (files.some(file => file.size > max)) { this.setData({ error: '有图片超过大小限制，请裁剪后重新选择。' }); return; }
      const images = files.map((file, index) => ({ path: file.tempFilePath, size: file.size, number: index + 1, mimeType: /\.jpe?g$/i.test(file.tempFilePath) ? 'image/jpeg' : 'image/png' }));
      if (this.data.stage === 'review') { this.persistDraft(); try { wx.setStorageSync(this.draftKey() + '.previous', wx.getStorageSync(this.draftKey())); } catch (_) { this.setData({ error: '未完成草稿无法保留，请先完成当前核对。' }); return; } }
      this._drafts = []; this._batchId = ''; this._observedAt = ''; this._token = '';
      this.setData({ images, imagePath: images[0].path, rows: [], selectedCount: 0, document: null, documents: [], stage: 'select', failedImages: [], progress: '', previewData: null, error: '' });
    } });
  },
  async confirmDisclosure() { return await new Promise(resolve => wx.showModal({ title: '确认发送截图', content: `将发送 ${this.data.images.length} 张截图至本项目的识别服务。请先遮挡姓名、账号等信息。核对并确认导入后才会保存持仓。`, confirmText: '开始识别', cancelText: '取消', success: value => resolve(!!value.confirm), fail: () => resolve(false) })); },
  async startRecognition() {
    if (this.data.busy || !this.data.images.length) return;
    const vision = service.vision();
    if (!vision || !this.data.capability?.enabled || !this.data.capability?.providerConfigured) { this.setData({ error: '截图识别暂不可用，可先手动添加。' }); return; }
    this.setData({ busy: true, error: '' });
    if (!await this.confirmDisclosure()) { this.setData({ busy: false }); return; }
    const failedImages = [], drafts = this._drafts || [];
    try {
      for (const file of this.data.images) {
        if (drafts.some(item => item.number === file.number)) continue;
        this.setData({ progress: `正在识别第 ${file.number}/${this.data.images.length} 张` });
        try {
          const draft = await vision.recognizeFile({ uploadRequestId: requestId('upload'), recognitionRequestId: requestId('recognize'), tempFilePath: file.path, size: file.size, mimeType: file.mimeType });
          drafts.push({ number: file.number, rows: draft.document && draft.document.pageType !== 'holdings' ? [] : draft.rows, document: draft.document || null, truncated: !!draft.truncated });
        } catch (error) { failedImages.push({ number: file.number, message: error.message || '识别失败' }); }
      }
      this._drafts = drafts;
      // Preserve successful images on retry; never send them twice.
      const resolved = await this.resolveRows(drafts.slice().sort((a, b) => a.number - b.number).flatMap(draft => draft.rows.map((row, index) => ({ ...row, source: draft.document || undefined, sourceImage: draft.number, sourceRow: index + 1 }))));
      const previous = new Map(this.data.rows.map(row => [row.rowId, row]));
      const rows = resolved.map(row => previous.get(row.rowId) || row);
      this._token = '';
      const document = drafts.find(item => item.document)?.document || null;
      this.setData({ rows, document, documents: drafts.map(d => ({ number: d.number, ...(d.document || {}), truncated: d.truncated })), previewData: null, failedImages, stage: rows.length || document ? 'review' : 'select', selectedCount: rows.filter(item => item.selected).length, progress: `已识别 ${drafts.length}/${this.data.images.length} 张`, error: failedImages.length ? `${failedImages.length} 张识别失败，可重试失败图片或先导入成功的结果。` : '' });
    } catch (error) { this.setData({ error: error.message }); showError(error); }
    finally { this.setData({ busy: false }); this.persistDraft(); }
  },
  async resolveRows(input) {
    const positions = allPositions(), accountLabels = new Set(input.map(item => item.accountLabel).filter(Boolean));
    const rows = [];
    for (let index = 0; index < input.length; index++) {
      const raw = input[index], code = String(raw.code || '').trim().toUpperCase(), name = String(raw.name || '').trim(), issues = [], candidates = [];
      const unsupported = ['OPTION', 'OTHER'].includes(raw.assetType) || /\b(CALL|PUT)\b/i.test(name + ' ' + code) || /^-/.test(raw.quantityText || '');
      if (unsupported) issues.push('此类资产暂不计入持仓，原始信息已保留');
      if (!raw.currency) issues.push('币种需要补充');
      if (raw.currency && !['CNY','USD'].includes(raw.currency)) issues.push('当前仅支持人民币和美元持仓，原始信息已保留');
      if ((code || name) && !unsupported) { try { candidates.push(...await service.searchMarket(code || name)); } catch (_) { /* manual resolution stays available */ } }
      const exact = candidates.filter(item => item.symbol === code && (!raw.currency || item.currency === raw.currency));
      const match = exact.length === 1 ? exact[0] : null;
      const instrument = match ? { symbol: match.symbol, name: match.name, market: match.market, currency: match.currency, assetType: match.asset_type, status: 'verified', instrumentKey: match.instrument_key } : { symbol: code, name, market: raw.market || (raw.currency === 'CNY' ? 'CN' : raw.currency === 'USD' ? 'US' : ''), currency: raw.currency || '', assetType: ['STOCK', 'ETF', 'FUND'].includes(raw.assetType) ? raw.assetType : raw.currency === 'CNY' && /^\d{6}$/.test(code) && /基金|混合|QDII|联接|债券|股票.*[A-C]$/i.test(name) && !/ETF/i.test(name) ? 'FUND' : /ETF/i.test(name) ? 'ETF' : 'STOCK', status: 'unverified', instrumentKey: '' };
      const existing = positions.find(item => item.symbol === instrument.symbol && item.market === instrument.market && item.currency === instrument.currency) || null;
      if (!raw.quantityText || !decimalLike(raw.quantityText) || /[万萬]/.test(raw.quantityText)) issues.push('数量需要确认');
      if (raw.costBasis === 'average_cost' && raw.unitCostText && !decimalLike(raw.unitCostText)) issues.push('成本需要确认');
      if (!match) issues.push('需要确认标的');

      rows.push({ screenshotMetrics: { marketValueText: raw.marketValueText || '', holdingPnlText: raw.holdingPnlText || '', holdingReturnRateText: raw.holdingReturnRateText || '', dailyChangeRateText: raw.dailyChangeRateText || '', navText: raw.navText || '', navDateText: raw.navDateText || '', originalFields: raw.originalFields || [], ...(raw.source ? { source: raw.source } : {}) }, unsupported, observationIssues: raw.issues || [], rowId: raw.sourceImage ? `image_${raw.sourceImage}_row_${raw.sourceRow}` : `row_${index + 1}`, sourceImage: raw.sourceImage || 1, editing: false, ...instrument, name: instrument.name || name, symbol: instrument.symbol || code, quantity: raw.quantityText || '', unitCost: raw.costBasis === 'average_cost' ? raw.unitCostText || '' : '', costBasis: raw.costBasis, accountLabel: raw.accountLabel || raw.source?.accountLabel || '', selected: issues.length === 0 && !unsupported && accountLabels.size <= 1, replaceApproved: false, costRemovalApproved: false, existing, issues, candidates });
    }
    const seen = new Set();
    for (const row of rows) {
      const key = `${row.symbol || row.name}|${row.market}|${row.currency}`;
      row.duplicate = seen.has(key); seen.add(key);
      if (row.duplicate) row.selected = false;
    }
    return rows;
  },
  updateRows(rows) { this._token = ''; this.setData({ rows, previewData: null, selectedCount: rows.filter(item => item.selected).length, error: '' }); this.persistDraft(); },
  onMetric(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), field = event.currentTarget.dataset.field, rows = this.data.rows.slice(); if (!rows[index] || !["marketValueText", "holdingPnlText", "holdingReturnRateText", "dailyChangeRateText", "navText", "navDateText"].includes(field)) return; rows[index] = { ...rows[index], screenshotMetrics: { ...rows[index].screenshotMetrics, [field]: event.detail.value } }; this.updateRows(rows); },
  toggleDocuments() { this.setData({ showDocuments: !this.data.showDocuments }); },
  toggleEdit(event) { const rows = this.data.rows.slice(), index = Number(event.currentTarget.dataset.index); if (!rows[index]) return; rows[index] = { ...rows[index], editing: !rows[index].editing }; this.setData({ rows }); this.persistDraft(); },
  onRowField(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), field = event.currentTarget.dataset.field, rows = this.data.rows.slice(); if (!rows[index] || !['name', 'symbol', 'market', 'currency', 'quantity', 'unitCost'].includes(field)) return; const identity = ['name', 'symbol', 'market', 'currency'].includes(field), issues = rows[index].issues.filter(item => !item.includes(field === 'quantity' ? '数量' : field === 'unitCost' ? '成本' : field === 'currency' ? '币种' : '标的')); if (identity && !issues.some(item => item.includes('标的'))) issues.push('需要确认标的'); rows[index] = { ...rows[index], [field]: event.detail.value, ...(identity ? { status: 'unverified', instrumentKey: '' } : {}), issues }; if (identity) { rows[index].existing = allPositions().find(item => item.symbol === rows[index].symbol.trim().toUpperCase() && item.market === rows[index].market.trim().toUpperCase() && item.currency === rows[index].currency.trim().toUpperCase()) || null; rows[index].replaceApproved = false; rows[index].costRemovalApproved = false; rows[index].selected = false; } this.updateRows(rows); },
  pickCandidate(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), candidateIndex = Number(event.currentTarget.dataset.candidate), rows = this.data.rows.slice(), row = rows[index], candidate = row?.candidates?.[candidateIndex]; if (!row || !candidate || row.unsupported) return; rows[index] = { ...row, symbol: candidate.symbol, name: candidate.name, market: candidate.market, currency: candidate.currency, assetType: candidate.asset_type, status: 'verified', instrumentKey: candidate.instrument_key, issues: row.issues.filter(item => !item.includes('标的')) }; rows[index].existing = allPositions().find(item => item.symbol === candidate.symbol && item.market === candidate.market && item.currency === candidate.currency) || null; rows[index].replaceApproved = false; rows[index].costRemovalApproved = false; rows[index].selected = rows[index].issues.length === 0; this.updateRows(rows); },
  setAssetType(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), assetType = event.currentTarget.dataset.type, rows = this.data.rows.slice(); if (!rows[index] || rows[index].unsupported || !['STOCK', 'ETF', 'FUND'].includes(assetType)) return; rows[index] = { ...rows[index], assetType }; this.updateRows(rows); },
  toggleRow(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(), row = rows[index]; if (!row || row.unsupported) return; let next = row; if (row.name?.trim() && row.symbol?.trim() && row.market?.trim() && /^[A-Za-z]{3}$/.test(row.currency?.trim() || '')) next = { ...row, issues: row.issues.filter(item => !item.includes('标的')), status: row.status === 'unverified' ? 'unverified' : row.status }; const selected = !next.selected; rows[index] = { ...next, selected: selected && next.issues.length === 0, ...(selected && next.existing ? { replaceApproved: true } : {}) }; this.updateRows(rows); },
  confirmReplace(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(); if (!rows[index]) return; rows[index] = { ...rows[index], replaceApproved: true, selected: true }; this.updateRows(rows); },
  confirmCostRemoval(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(); if (!rows[index]) return; rows[index] = { ...rows[index], costRemovalApproved: true }; this.updateRows(rows); },
  confirmManual(event) { if (this.data.busy) return; const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(), row = rows[index]; if (!row || row.unsupported || !row.symbol.trim() || !row.name.trim() || !row.market.trim() || !/^[A-Za-z]{3}$/.test(row.currency.trim())) { this.setData({ error: '请完整填写名称、代码、市场和三位币种。' }); return; } rows[index] = { ...row, status: 'unverified', issues: row.issues.filter(item => !item.includes('标的')), replaceApproved: !!row.existing, selected: row.issues.filter(item => !item.includes('标的')).length === 0 }; this.updateRows(rows); },
  request() { return { batchId: this._batchId || (this._batchId = requestId('screenshot')), expectedRevision: this.data.expectedRevision, observedAt: this._observedAt || (this._observedAt = new Date().toISOString()), rows: this.data.rows.filter(item => item.selected).map(item => ({ rowId: item.rowId, screenshotMetrics: item.screenshotMetrics, instrument: { symbol: item.symbol, name: item.name, market: item.market, currency: item.currency, assetType: item.assetType, status: item.status, instrumentKey: item.instrumentKey || undefined }, quantity: item.quantity, unitCost: item.unitCost, replaceApproved: item.replaceApproved, costRemovalApproved: item.costRemovalApproved })) }; },
  async preview() { if (this.data.busy) return; try { if (this._ownerKey && this._ownerKey !== this.draftKey()) throw Error('工作区已变化，请重新打开导入页。'); const selected = this.data.rows.filter(item => item.selected); if (!selected.length) throw Error('请至少选择一项有效持仓。'); if (selected.length > 20) throw Error('每批最多导入 20 项，请取消部分选择后分批导入。'); if (selected.some(item => item.unsupported || item.issues.length)) throw Error('请先解决已选行的标的、数量、成本或替换确认问题。'); const accountLabels = new Set(selected.map(item => item.accountLabel || item.screenshotMetrics.source?.accountLabel).filter(Boolean)); if (accountLabels.size > 1) throw Error('请选择同一账户的持仓导入。');
      this.updateRows(this.data.rows.map(row => row.selected ? { ...row, replaceApproved: !!row.existing, costRemovalApproved: !!row.existing && !row.unitCost && row.quantity.replace(/,/g, '') !== String(row.existing.quantity) } : row));
      const result = service.previewHoldingImport(this.request()); this._token = result.contentToken; this.setData({ previewData: result, error: '', busy: true });
      const content = selected.map(row => `${row.name || row.symbol}：${row.existing ? row.existing.quantity + ' → ' : ''}${row.quantity}${row.unitCost ? '，单位成本 ' + row.unitCost : '，未提供成本'}${row.screenshotMetrics?.holdingReturnRateText ? '，持有收益率 ' + row.screenshotMetrics.holdingReturnRateText : ''}${row.screenshotMetrics?.dailyChangeRateText ? '，日涨幅 ' + row.screenshotMetrics.dailyChangeRateText : ''}`).join('\n');
      const confirmed = await new Promise(resolve => wx.showModal({ title: `导入 ${selected.length} 项持仓？`, content: content + '\n已有持仓会更新为上述数量，不会新增买卖记录。数量变化且未提供成本时，成本将变为未知。', confirmText: '确认导入', success: value => resolve(!!value.confirm), fail: () => resolve(false) }));
      this.setData({ busy: false }); if (confirmed) this.submit();
    } catch (error) { this.setData({ error: error.message }); showError(error); } },
  submit() { if (this.data.busy || !this.data.previewData) return; this.setData({ busy: true }); try { if (this._ownerKey && this._ownerKey !== this.draftKey()) throw Error('工作区已变化，请重新打开导入页。'); const result = service.saveHoldingImport({ ...this.request(), contentToken: this._token }); const remaining = this.data.rows.filter(row => !row.selected); this._batchId = ''; this._observedAt = ''; this.setData({ rows: remaining, selectedCount: 0, expectedRevision: service.snapshot().revision, stage: remaining.length ? 'review' : 'select' }); if (remaining.length) this.persistDraft(); else wx.removeStorageSync(this.draftKey()); wx.showToast({ title: `已导入 ${result.imported} 项`, icon: 'success' }); wx.navigateBack(); } catch (error) { this.setData({ busy: false, error: error.message }); showError(error); } },
});
