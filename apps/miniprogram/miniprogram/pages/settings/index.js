const { service, today, showError } = require('../../lib/core');
Page({
  data: { error: '', mode: '', trades: 0, reviews: 0, backupText: '', preview: null, importing: false },
  onShow() { try { const state = service.snapshot(); this.setData({ mode: state.mode, trades: service.records().filter(r => !r.voided).length, reviews: state.reviews.length, error: '' }); } catch (e) { this.setData({ error: e.message }); } },
  copyBackup() {
    wx.showModal({ title: '复制本地备份', content: '备份包含交易与复盘明文，请只粘贴到你信任的私人保存位置。', success: result => {
      if (!result.confirm) return;
      try { wx.setClipboardData({ data: service.exportBackup(), fail: showError }); } catch (e) { showError(e); }
    } });
  },
  exportFile() {
    try {
      const data = service.exportBackup(); const fileName = `交易日记备份-${today()}.json`;
      const path = `${wx.env.USER_DATA_PATH}/${fileName}`;
      // One stable dated path avoids creating a new file on every tap.
      wx.getFileSystemManager().writeFile({ filePath: path, data, encoding: 'utf8', success: () => {
        if (typeof wx.shareFileMessage !== 'function') { wx.showModal({ title: '文件已生成', content: '当前环境不支持文件分享，请使用“复制备份”导出。', showCancel: false }); return; }
        wx.shareFileMessage({ filePath: path, fileName, fail: error => { if (!String(error.errMsg).includes('cancel')) showError(Error('文件分享未完成，可使用复制备份。')); } });
      }, fail: () => showError(Error('备份文件保存失败，请使用复制备份或检查空间。')) });
    } catch (e) { showError(e); }
  },
  onBackupText(e) { this.setData({ backupText: e.detail.value, preview: null }); },
  previewBackup() {
    try { this.setData({ preview: service.previewBackup(this.data.backupText) }); } catch (e) { this.setData({ preview: null }); showError(e); }
  },
  chooseBackup() {
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: result => {
      const file = result.tempFiles[0]; if (!file) return;
      if (file.size > 800 * 1024) { showError(Error('备份文件过大，最多 800 KiB。')); return; }
      wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: result => {
        this.setData({ backupText: result.data, preview: null }); this.previewBackup();
      }, fail: () => showError(Error('无法读取备份文件。')) });
    }, fail: error => { if (!String(error.errMsg).includes('cancel')) showError(Error('选择文件失败，也可以粘贴备份内容。')); } });
  },
  restoreBackup() {
    if (!this.data.preview || this.data.importing) return;
    const text = this.data.backupText;
    wx.showModal({ title: '用备份替换当前账本？', content: `将恢复 ${this.data.preview.trades} 笔交易、${this.data.preview.reviews} 天复盘。当前本地账本保留为一个恢复点。`, confirmText: '确认恢复', success: result => {
      if (!result.confirm || this.data.importing) return;
      this.setData({ importing: true });
      try { service.restoreBackup(text); this.setData({ backupText: '', preview: null }); this.onShow(); wx.showToast({ title: '恢复成功' }); }
      catch (e) { showError(e); } finally { this.setData({ importing: false }); }
    } });
  },
  recoverPrevious() {
    wx.showModal({ title: '返回上一个恢复点？', content: '当前账本将被恢复点覆盖，恢复点本身保留。若需保留当前内容，请先导出备份。', success: r => {
      if (r.confirm) { try { service.recoverPrevious(); this.onShow(); } catch (e) { showError(e); } }
    } });
  },
  startEmpty() {
    wx.showModal({ title: '开始新的空账本？', content: '建议先导出备份。当前账本将保留为一个恢复点；新账本不会包含示例或历史交易。', confirmText: '新建账本', success: r => {
      if (r.confirm) { try { service.startEmpty(); this.onShow(); } catch (e) { showError(e); } }
    } });
  },
});
