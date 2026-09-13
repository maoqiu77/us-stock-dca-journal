const config = require('./config');
globalThis.__PORTFOLIO_CONFIG__ = config;
App({ onLaunch() { if (config.aiTransport === 'cloud') wx.cloud.init({ env: config.cloudEnvId, traceUser: true }); } });
