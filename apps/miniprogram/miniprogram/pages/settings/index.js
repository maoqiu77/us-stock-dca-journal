const { service, today, showError } = require('../../lib/core');
Page({
  data: { pendingSave: false, workspacePending: false, retryable: false, workspaceRetryable: false, error: '', mode: '', trades: 0, reviews: 0, conversations: 0, runs: 0, sources: 0, backupText: '', backupFileName: '', preview: null, importing: false, canExportRaw: false, clockAnomaly: null, horizon: '', maxSingleWeight: '', effectiveFrom: '' },
  onShow() { this.refreshPending(); try { const state = service.snapshot(), workspace = service.journal().read(), view = service.overview(), policy = workspace.policies.at(-1), parents = new Set(workspace.journal.map(item => item.parent_revision).filter(Boolean)), personalNotes = workspace.journal.filter(item => !parents.has(item.revision_id) && item.type === 'personal_note').length; this.setData({ mode: state.mode, trades: service.records().filter(r => !r.voided && !r.isOpening).length, reviews: personalNotes, conversations: workspace.conversations.length, runs: workspace.runs.length, sources: workspace.sources.length, horizon: policy?.status === 'confirmed' ? policy.horizon || '' : '', maxSingleWeight: policy?.status === 'confirmed' ? policy.max_single_weight || '' : '', effectiveFrom: policy?.status === 'confirmed' ? policy.effective_from : today(), error: '', canExportRaw: false, clockAnomaly: view.clockAnomaly ? { asOf: view.knownAt, throughDate: view.throughDate, message: '设备时间早于已保存记录，请校准时间。' } : null }); } catch (e) { this.setData({ error: e.message, canExportRaw: true, clockAnomaly: null }); } },
  refreshPending() { try { this.setData({ pendingSave: !!service.pendingSave?.(), workspacePending: !!service.workspacePending?.() }); } catch (e) { this.setData({ pendingSave: true }); showError(e); } },
  verifySave() { try { const result = service.verifyPending(); this.setData({ pendingSave: result === 'retryable', retryable: result === 'retryable' }); if (result === 'confirmed') { this.setData({ backupText: '', preview: null }); wx.showToast({ title: '已核验保存成功' }); this.onShow(); } if (result === 'none') showError(Error('当前没有待核验提交，请先检查记录后再操作。')); } catch (e) { this.setData({ pendingSave: true, retryable: false }); showError(e); } },
  retrySave() { if (!this.data.retryable) return; try { service.retryPending(); this.setData({ pendingSave: false, retryable: false, backupText: '', preview: null }); this.onShow(); wx.showToast({ title: '已保存' }); } catch (e) { this.setData({ retryable: false }); showError(e); } },
  verifyWorkspaceSave() { try { const result = service.verifyWorkspacePending(); this.setData({ workspacePending: result === 'retryable', workspaceRetryable: result === 'retryable' }); if (result === 'confirmed') { wx.showToast({ title: '工作区已核验' }); this.onShow(); } } catch (e) { showError(e); } },
  retryWorkspaceSave() { try { service.retryWorkspacePending(); this.setData({ workspacePending: false, workspaceRetryable: false }); this.onShow(); } catch (e) { showError(e); } },
  copyRaw() {
    wx.showModal({ title: '导出原始故障数据', content: '原始数据可能损坏，不保证是有效备份，也不会自动修复或覆盖当前账本。请仅交给可信的人排查。', confirmText: '继续导出', success: result => {
      if (!result.confirm) return; try { wx.setClipboardData({ data: service.exportRaw(), fail: showError }); } catch (e) { showError(e); }
    } });
  },
  exportRawFile() { try { const data = service.exportRaw(), fileName = `交易日记-原始故障数据-${today()}.txt`, path = `${wx.env.USER_DATA_PATH}/${fileName}`; wx.getFileSystemManager().writeFile({ filePath: path, data, encoding: 'utf8', success: () => wx.shareFileMessage ? wx.shareFileMessage({ filePath: path, fileName, fail: showError }) : showError(Error('当前环境不支持文件分享，请复制原始数据。')), fail: () => showError(Error('原始数据文件保存失败，请尝试复制。')) }); } catch (e) { showError(e); } },
  copyBackup() {
    wx.showModal({ title: '复制本地备份', content: '备份包含交易与复盘明文，请只粘贴到你信任的私人保存位置。', success: result => {
      if (!result.confirm) return;
      try { wx.setClipboardData({ data: service.exportFullBackup(), fail: showError }); } catch (e) { showError(e); }
    } });
  },
  exportFile() {
    try {
      const data = service.exportFullBackup(); const fileName = `交易日记-完整备份-v3-${today()}.json`;
      const path = `${wx.env.USER_DATA_PATH}/${fileName}`;
      // One stable dated path avoids creating a new file on every tap.
      wx.getFileSystemManager().writeFile({ filePath: path, data, encoding: 'utf8', success: () => {
        if (typeof wx.shareFileMessage !== 'function') { wx.showModal({ title: '文件已生成', content: '当前环境不支持文件分享，请使用“复制备份”导出。', showCancel: false }); return; }
        wx.shareFileMessage({ filePath: path, fileName, fail: error => { if (!String(error.errMsg).includes('cancel')) showError(Error('文件分享未完成，可使用复制备份。')); } });
      }, fail: () => showError(Error('备份文件保存失败，请使用复制备份或检查空间。')) });
    } catch (e) { showError(e); }
  },
  onBackupText(e) { this._backupFileText = ''; this.setData({ backupText: e.detail.value, backupFileName: '', preview: null }); },
  previewBackup() {
    try { this.setData({ preview: service.previewCompleteBackup(this._backupFileText || this.data.backupText) }); } catch (e) { this.setData({ preview: null }); showError(e); }
  },
  chooseBackup() {
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: result => {
      const file = result.tempFiles[0]; if (!file) return;
      if (file.size > 8 * 1024 * 1024) { showError(Error('完整备份文件过大，当前测试版文件导入上限为 8 MiB。')); return; }
      wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: result => {
        this._backupFileText = result.data; this.setData({ backupText: '', backupFileName: file.name || '已选完整备份', preview: null }); this.previewBackup();
      }, fail: () => showError(Error('无法读取备份文件。')) });
    }, fail: error => { if (!String(error.errMsg).includes('cancel')) showError(Error('选择文件失败，也可以粘贴备份内容。')); } });
  },
  restoreBackup() {
    if (!this.data.preview || this.data.importing) return;
    const text = this._backupFileText || this.data.backupText;
    wx.showModal({ title: '用备份替换当前完整工作区？', content: `将恢复 ${this.data.preview.openings} 条期初持仓、${this.data.preview.trades} 笔交易、${this.data.preview.personalNotes} 条个人记录、${this.data.preview.runs} 份分析。${this.data.preview.complete ? '这是 v3 完整备份。' : '这是旧备份，将创建新工作区。'}`, confirmText: '确认恢复', success: result => {
      if (!result.confirm || this.data.importing) return;
      this.setData({ importing: true });
      try { service.restoreCompleteBackup(text); this._backupFileText = ''; this.setData({ backupText: '', backupFileName: '', preview: null }); this.onShow(); wx.showToast({ title: '恢复成功' }); }
      catch (e) { this.refreshPending(); showError(e); } finally { this.setData({ importing: false }); }
    } });
  },
  onPolicyField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  onPolicyDate(e) { this.setData({ effectiveFrom: e.detail.value }); },
  confirmPolicy() { try { const raw = this.data.maxSingleWeight.trim(), normalized = raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw; service.journal().confirmPolicy({ effective_from: this.data.effectiveFrom || today(), horizon: this.data.horizon.trim() || null, max_single_weight: normalized || null }); this.onShow(); wx.showToast({ title: '投资计划已确认' }); } catch (e) { showError(e); } },
  recoverPrevious() {
    wx.showModal({ title: '返回上一个恢复点？', content: '当前账本将被恢复点覆盖，恢复点本身保留。若需保留当前内容，请先导出备份。', success: r => {
      if (r.confirm) { try { service.recoverPrevious(); this.onShow(); } catch (e) { this.refreshPending(); showError(e); } }
    } });
  },
  startEmpty() {
    wx.showModal({ title: '开始新的空账本？', content: '建议先导出备份。当前账本将保留为一个恢复点；新账本不会包含示例或历史交易。', confirmText: '新建账本', success: r => {
      if (r.confirm) { try { service.startEmpty(); this.onShow(); } catch (e) { this.refreshPending(); showError(e); } }
    } });
  },
});
