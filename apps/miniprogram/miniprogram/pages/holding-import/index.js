const { service, showError } = require('../../lib/core');
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
  data: { error: '', capability: null, imagePath: '', imageSize: 0, mimeType: 'image/png', stage: 'select', rows: [], busy: false, expectedRevision: 0, previewData: null, selectedCount: 0 },
  async onLoad() {
    try { const vision = service.vision(); this.setData({ expectedRevision: service.snapshot().revision, capability: vision ? await vision.capabilities() : { enabled: false, providerConfigured: false, maxBytes: 4194304, maxRows: 20 } }); }
    catch (_) { this.setData({ capability: { enabled: false, providerConfigured: false, maxBytes: 4194304, maxRows: 20 } }); }
  },
  chooseImage() {
    if (this.data.busy) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: result => {
      const file = result.tempFiles && result.tempFiles[0]; if (!file) return;
      const max = this.data.capability?.maxBytes || 4194304;
      if (file.size > max) { this.setData({ error: '压缩后图片仍超过 4 MiB，请裁剪或分张。' }); return; }
      const path = file.tempFilePath || '', lower = path.toLowerCase();
      this.setData({ imagePath: path, imageSize: file.size, mimeType: lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png', rows: [], stage: 'select', previewData: null, error: '' });
    } });
  },
  async confirmDisclosure() { return await new Promise(resolve => wx.showModal({ title: '确认发送截图', content: '截图将发送至本项目的识别服务。请先遮挡姓名、账号等信息。识别结果不会直接写入持仓。', confirmText: '开始识别', cancelText: '取消', success: value => resolve(!!value.confirm), fail: () => resolve(false) })); },
  async startRecognition() {
    if (this.data.busy || !this.data.imagePath) return;
    const vision = service.vision();
    if (!vision || !this.data.capability?.enabled || !this.data.capability?.providerConfigured) { this.setData({ error: '截图识别暂不可用，可先手动添加。' }); return; }
    if (!await this.confirmDisclosure()) return;
    this.setData({ busy: true, error: '' });
    try {
      const draft = await vision.recognizeFile({ uploadRequestId: requestId('upload'), recognitionRequestId: requestId('recognize'), tempFilePath: this.data.imagePath, size: this.data.imageSize, mimeType: this.data.mimeType });
      const rows = await this.resolveRows(draft.rows); this.setData({ rows, stage: 'review', selectedCount: rows.filter(item => item.selected).length });
    } catch (error) { this.setData({ error: error.message }); showError(error); }
    finally { this.setData({ busy: false }); }
  },
  async resolveRows(input) {
    const positions = allPositions(), accountLabels = new Set(input.map(item => item.accountLabel).filter(Boolean));
    const rows = [];
    for (let index = 0; index < input.length; index++) {
      const raw = input[index], code = String(raw.code || '').trim().toUpperCase(), name = String(raw.name || '').trim(), issues = [], candidates = [];
      if (code) { try { candidates.push(...await service.searchMarket(code)); } catch (_) { /* manual resolution stays available */ } }
      const exact = candidates.filter(item => item.symbol === code && (!raw.currency || item.currency === raw.currency));
      const match = exact.length === 1 ? exact[0] : null;
      const instrument = match ? { symbol: match.symbol, name: match.name, market: match.market, currency: match.currency, assetType: match.asset_type, status: 'verified', instrumentKey: match.instrument_key } : { symbol: code, name, market: raw.currency === 'CNY' ? 'CN' : 'US', currency: raw.currency || 'USD', assetType: 'ETF', status: 'unverified', instrumentKey: '' };
      const existing = positions.find(item => item.symbol === instrument.symbol && item.market === instrument.market && item.currency === instrument.currency) || null;
      if (!raw.quantityText || !decimalLike(raw.quantityText) || /[万萬]/.test(raw.quantityText)) issues.push('数量需要确认');
      if (raw.unitCostText && !decimalLike(raw.unitCostText)) issues.push('成本需要确认');
      if (raw.costBasis !== 'average_cost' && raw.unitCostText) issues.push(raw.costBasis === 'breakeven' ? '盈亏平衡价不能直接作为平均成本' : '成本口径需要确认');
      if (!match) issues.push('需要确认标的');
      if (accountLabels.size > 1) issues.push('截图包含多个账户，请分批处理');
      rows.push({ rowId: `row_${index + 1}`, ...instrument, name: instrument.name || name, symbol: instrument.symbol || code, quantity: raw.quantityText || '', unitCost: raw.costBasis === 'average_cost' ? raw.unitCostText || '' : '', costBasis: raw.costBasis, accountLabel: raw.accountLabel || '', selected: issues.length === 0 && !existing, replaceApproved: false, costRemovalApproved: false, existing, issues, candidates });
    }
    return rows;
  },
  updateRows(rows) { this._token = ''; this.setData({ rows, previewData: null, selectedCount: rows.filter(item => item.selected).length, error: '' }); },
  onRowField(event) { const index = Number(event.currentTarget.dataset.index), field = event.currentTarget.dataset.field, rows = this.data.rows.slice(); if (!rows[index] || !['name', 'symbol', 'market', 'currency', 'quantity', 'unitCost'].includes(field)) return; const identity = ['name', 'symbol', 'market', 'currency'].includes(field), issues = rows[index].issues.filter(item => !item.includes(field === 'quantity' ? '数量' : field === 'unitCost' ? '成本' : '标的')); if (identity && !issues.some(item => item.includes('标的'))) issues.push('需要确认标的'); rows[index] = { ...rows[index], [field]: event.detail.value, ...(identity ? { status: 'unverified', instrumentKey: '' } : {}), issues }; this.updateRows(rows); },
  pickCandidate(event) { const index = Number(event.currentTarget.dataset.index), candidateIndex = Number(event.currentTarget.dataset.candidate), rows = this.data.rows.slice(), row = rows[index], candidate = row?.candidates?.[candidateIndex]; if (!row || !candidate) return; rows[index] = { ...row, symbol: candidate.symbol, name: candidate.name, market: candidate.market, currency: candidate.currency, assetType: candidate.asset_type, status: 'verified', instrumentKey: candidate.instrument_key, issues: row.issues.filter(item => !item.includes('标的')) }; rows[index].selected = rows[index].issues.length === 0 && !rows[index].existing; this.updateRows(rows); },
  setAssetType(event) { const index = Number(event.currentTarget.dataset.index), assetType = event.currentTarget.dataset.type, rows = this.data.rows.slice(); if (!rows[index] || !['STOCK', 'ETF', 'FUND'].includes(assetType)) return; rows[index] = { ...rows[index], assetType }; this.updateRows(rows); },
  toggleRow(event) { const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(); if (!rows[index]) return; rows[index] = { ...rows[index], selected: !rows[index].selected }; this.updateRows(rows); },
  confirmReplace(event) { const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(); if (!rows[index]) return; rows[index] = { ...rows[index], replaceApproved: true, selected: true }; this.updateRows(rows); },
  confirmCostRemoval(event) { const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(); if (!rows[index]) return; rows[index] = { ...rows[index], costRemovalApproved: true }; this.updateRows(rows); },
  confirmManual(event) { const index = Number(event.currentTarget.dataset.index), rows = this.data.rows.slice(), row = rows[index]; if (!row || !row.symbol.trim() || !row.name.trim() || !row.market.trim() || !/^[A-Za-z]{3}$/.test(row.currency.trim())) { this.setData({ error: '请完整填写名称、代码、市场和三位币种。' }); return; } rows[index] = { ...row, status: 'unverified', issues: row.issues.filter(item => !item.includes('标的')), selected: row.issues.filter(item => !item.includes('标的')).length === 0 && !row.existing }; this.updateRows(rows); },
  request() { return { batchId: this._batchId || (this._batchId = requestId('screenshot')), expectedRevision: this.data.expectedRevision, observedAt: this._observedAt || (this._observedAt = new Date().toISOString()), rows: this.data.rows.filter(item => item.selected).map(item => ({ rowId: item.rowId, instrument: { symbol: item.symbol, name: item.name, market: item.market, currency: item.currency, assetType: item.assetType, status: item.status, instrumentKey: item.instrumentKey || undefined }, quantity: item.quantity, unitCost: item.unitCost, replaceApproved: item.replaceApproved, costRemovalApproved: item.costRemovalApproved })) }; },
  preview() { try { const selected = this.data.rows.filter(item => item.selected); if (!selected.length) throw Error('请至少选择一项有效持仓。'); if (selected.some(item => item.issues.length || item.existing && !item.replaceApproved)) throw Error('请先解决已选行的标的、数量、成本或替换确认问题。'); const result = service.previewHoldingImport(this.request()); this._token = result.contentToken; this.setData({ previewData: result, error: '' }); } catch (error) { this.setData({ error: error.message }); showError(error); } },
  submit() { if (this.data.busy || !this.data.previewData) return; this.setData({ busy: true }); try { const result = service.saveHoldingImport({ ...this.request(), contentToken: this._token }); wx.showToast({ title: `已导入 ${result.imported} 项`, icon: 'success' }); wx.navigateBack(); } catch (error) { this.setData({ busy: false, error: error.message }); showError(error); } },
});
