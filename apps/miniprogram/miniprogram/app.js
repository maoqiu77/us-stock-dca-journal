const config = require('./config');
globalThis.__PORTFOLIO_CONFIG__ = config;
const WELCOME_KEY = 'portfolio.wechat.welcome.v1';
App({
  onLaunch() { if (config.aiTransport === 'cloud' || config.marketFunctionName) wx.cloud.init({ env: config.cloudEnvId, traceUser: true }); },
  onShow() {
    if (this._welcomeOpen || this._welcomeDone) return;
    try {
      if (wx.getStorageSync(WELCOME_KEY)) { this._welcomeDone = true; return; }
      const { service } = require('./lib/core');
      const date = service.journal().ensureWelcomeNote();
      this._welcomeOpen = true;
      this._welcomeDate = date;
      this.notifyWelcome();
    } catch (_) { wx.showToast({ title: '欢迎手记暂未保存，下次进入将重试', icon: 'none' }); }
  },
  notifyWelcome() { for (const listener of this._welcomeListeners || []) listener(!!this._welcomeOpen); },
  subscribeWelcome(listener) {
    if (!this._welcomeListeners) this._welcomeListeners = new Set();
    this._welcomeListeners.add(listener); listener(!!this._welcomeOpen);
    return () => this._welcomeListeners.delete(listener);
  },
  confirmWelcome() {
    const { service } = require('./lib/core');
    try { wx.setStorageSync(WELCOME_KEY, '1'); this._welcomeDone = true; }
    catch (_) { wx.showToast({ title: '欢迎状态保存失败，下次将重试', icon: 'none' }); }
    this._welcomeOpen = false; this.notifyWelcome();
    try {
      wx.setStorageSync('portfolio.wechat.navigation-intent.v1', { workspaceId: service.journal().read().instance_id, type: 'journal_date', date: this._welcomeDate, expiresAt: Date.now() + 5 * 60 * 1000 });
      wx.switchTab({ url: '/pages/research/index', fail: () => wx.removeStorageSync('portfolio.wechat.navigation-intent.v1') });
    } catch (_) { wx.showToast({ title: '可在 AI 手记中查看欢迎记录', icon: 'none' }); }
  },
});
