import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = new URL('../miniprogram/', import.meta.url);
function page(name, service, wxOverrides = {}) {
  const calls = { routes: [], switched: [], notices: [], titles: [] };
  const storage = new Map();
  const wx = { navigateTo: value => calls.routes.push(value.url), switchTab: value => calls.switched.push(value.url), navigateBack: () => {}, setNavigationBarTitle: value => calls.titles.push(value.title), showToast: value => calls.notices.push(value), showModal: value => { calls.notices.push(value); value.success?.({ confirm: true }); }, showActionSheet: value => value.success?.({ tapIndex: 0 }), setStorageSync: (key, value) => storage.set(key, value), getStorageSync: key => storage.get(key), removeStorageSync: key => storage.delete(key), ...wxOverrides };
  const context = vm.createContext({ module: { exports: {} }, console, wx, require: () => ({ service, today: () => '2026-09-10', showError: error => calls.notices.push({ content: error.message }) }), Page: definition => { context.result = definition; definition.setData = update => Object.assign(definition.data, update); } });
  vm.runInContext(`(function(){${readFileSync(new URL(`pages/${name}/index.js`, source), 'utf8')}\n})()`, context);
  return { controller: context.result, calls };
}

test('Phase 1 navigation has exactly holdings, AI journal and board tabs while records stays a secondary page', () => {
  const app = JSON.parse(readFileSync(new URL('app.json', source), 'utf8'));
  assert.deepEqual(app.tabBar.list.map(item => [item.pagePath, item.text]), [
    ['pages/overview/index', '持仓'],
    ['pages/research/index', 'AI 手记'],
    ['pages/market/index', '看板'],
  ]);
  assert.ok(app.pages.includes('pages/records/index'));
  assert.ok(!app.tabBar.list.some(item => item.pagePath === 'pages/records/index'));
});

test('holdings and position headers keep actions below the title on narrow screens', () => {
  const css = readFileSync(new URL('app.wxss', source), 'utf8');
  const overview = readFileSync(new URL('pages/overview/index.wxml', source), 'utf8');
  const detail = readFileSync(new URL('pages/position-detail/index.wxml', source), 'utf8');
  assert.match(css, /\.page-header-actions\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.page-header-actions button\s*\{[^}]*min-width:\s*0/);
  assert.match(overview, /class="page-header"[\s\S]*?class="actions page-header-actions compact"/);
  assert.match(detail, /class="page-header"[\s\S]*?class="actions page-header-actions"/);
  assert.doesNotMatch(overview, /class="row"><view><view class="eyebrow">PORTFOLIO/);
  assert.doesNotMatch(detail, /class="row"><view><view class="title">\{\{detail\.name/);
});

test('holdings page add menu exposes manual and screenshot routes while records stays secondary', () => {
  const service = { overview: () => ({ clockAnomaly: false, currencies: ['USD'], selectedCurrency: 'USD', positions: [], market: { total: 0, covered: 0 }, marketValue: null, unrealizedPnl: null }), firstUse: () => ({ isEmpty: true }), refreshMarket: async () => {}, invalidateMarketRequest: () => {} };
  let choice = 0;
  const { controller, calls } = page('overview', service, { showActionSheet: value => value.success?.({ tapIndex: choice }) });
  controller.onShow();
  controller.addHolding(); choice = 1; controller.addHolding(); controller.showRecords(); controller.showSettings();
  assert.deepEqual(calls.routes, ['/pages/holding-editor/index', '/pages/holding-import/index', '/pages/records/index', '/pages/settings/index']);
});

test('screenshot import uploads only after explicit disclosure consent and produces an editable draft', async () => {
  let consent = false, recognizeCalls = 0;
  const vision = { capabilities: async () => ({ enabled: true, providerConfigured: true, maxBytes: 4194304, maxRows: 20 }), recognizeFile: async () => { recognizeCalls++; return { requestId: 'recognize_12345678', status: 'review_required', rows: [{ name: 'QQQ', code: 'QQQ', quantityText: '20', unitCostText: null, costBasis: 'unknown', currency: 'USD', accountLabel: null }] }; } };
  const service = { vision: () => vision, snapshot: () => ({ revision: 0 }), overview: () => ({ positions: [] }), searchMarket: async () => [] };
  const { controller } = page('holding-import', service, {
    chooseMedia: value => value.success({ tempFiles: [{ tempFilePath: '/tmp/holding.png', size: 120, fileType: 'image' }] }),
    showModal: value => value.success?.({ confirm: consent }),
  });
  await controller.onLoad(); controller.chooseImage();
  await controller.startRecognition(); assert.equal(recognizeCalls, 0);
  consent = true; await controller.startRecognition();
  assert.equal(recognizeCalls, 1); assert.equal(controller.data.rows.length, 1);
  assert.equal(controller.data.rows[0].selected, false);
  assert.ok(controller.data.rows[0].issues.some(item => item.includes('标的')));
});

test('screenshot review requires an explicit catalog choice and invalidates identity after manual edits', async () => {
  const candidates = [
    { instrument_key: 'US:XNAS:ABC', symbol: 'ABC', name: 'ABC Nasdaq', market: 'US', currency: 'USD', asset_type: 'STOCK' },
    { instrument_key: 'US:XNYS:ABC', symbol: 'ABC', name: 'ABC NYSE', market: 'US', currency: 'USD', asset_type: 'STOCK' },
  ];
  const service = { vision: () => null, snapshot: () => ({ revision: 0 }), overview: () => ({ positions: [] }), searchMarket: async () => candidates };
  const { controller } = page('holding-import', service); await controller.onLoad();
  const rows = await controller.resolveRows([{ name: 'ABC', code: 'ABC', quantityText: '2', unitCostText: '10', costBasis: 'average_cost', currency: 'USD', accountLabel: null }]);
  controller.setData({ rows }); controller.pickCandidate({ currentTarget: { dataset: { index: 0, candidate: 1 } } });
  assert.equal(controller.data.rows[0].instrumentKey, 'US:XNYS:ABC');
  assert.equal(controller.data.rows[0].status, 'verified');
  controller.onRowField({ currentTarget: { dataset: { index: 0, field: 'symbol' } }, detail: { value: 'ABD' } });
  assert.equal(controller.data.rows[0].instrumentKey, '');
  assert.equal(controller.data.rows[0].status, 'unverified');
  assert.ok(controller.data.rows[0].issues.includes('需要确认标的'));
});

test('manual holding page previews and saves a non-trade checkpoint', () => {
  const seen = [];
  const service = {
    snapshot: () => ({ revision: 4 }),
    overview: () => ({ positions: [] }),
    previewHolding: input => { seen.push(['preview', input]); return { before: { quantity: '0', unitCost: null }, after: { quantity: '2', unitCost: null }, createsTrade: false, contentToken: 'token' }; },
    saveHolding: input => { seen.push(['save', input]); return { kind: 'committed', revision: 5 }; },
    pendingSave: () => false,
    pendingIdentity: () => '',
  };
  const { controller } = page('holding-editor', service);
  controller.onLoad({});
  controller.setData({ symbol: 'QQQ', name: '纳指 ETF', quantity: '2', unitCost: '' });
  controller.preview(); controller.submit();
  assert.deepEqual(seen.map(item => item[0]), ['preview', 'save']);
  assert.equal(seen[1][1].contentToken, 'token');
  assert.equal(seen[1][1].expectedRevision, 4);
});

test('manual holding page reuses the market catalog but keeps offline manual entry available', async () => {
  const service = {
    snapshot: () => ({ revision: 0 }), overview: () => ({ positions: [] }), pendingSave: () => false, pendingIdentity: () => '',
    searchMarket: async () => [{ instrument_key: 'US:XNAS:QQQ', symbol: 'QQQ', name: 'Invesco QQQ', market: 'US', currency: 'USD', asset_type: 'ETF' }],
  };
  const { controller } = page('holding-editor', service); controller.onLoad({}); controller.setData({ symbol: 'qqq' });
  await controller.searchAsset(); controller.pickAsset({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(controller.data.name, 'Invesco QQQ');
  assert.equal(controller.data.status, 'verified');
  assert.equal(controller.data.instrumentKey, 'US:XNAS:QQQ');
});

test('research preview is readonly and editing invalidates the exact confirmed draft', async () => {
  const seen = []; const ai = {
    capabilities: () => ({ realProviderConfigured: true, enabled: true, providerConfigured: true, enrolled: true, consented: true, authorized: true, label: '真实模型服务' }),
    pending: () => [],
    previewContext: input => { seen.push(['preview', input]); return { facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] }; },
    prepare: (input, preview) => { seen.push(['prepare', input, preview]); return { conversation: { id: 'conversation-1' }, envelope: { payload_digest: 'a'.repeat(64) } }; },
    submitPrepared: async prepared => ({ conversation: prepared.conversation }),
    confirmResearchInstrument: symbol => ({ symbol, instrument_ref: 'instrument-1' }),
  };
  const service = { ai: () => ai, journal: () => ({ read: () => ({ instance_id: 'instance-1', runs: [] }) }) };
  const { controller } = page('research', service); controller.onLoad(); await controller.onShow(); controller.preview();
  assert.deepEqual(seen.map(item => item[0]), ['preview']);
  controller.onQuestion({ detail: { value: '新问题' } });
  await controller.runCloud();
  assert.deepEqual(seen.map(item => item[0]), ['preview']);
  assert.ok(controller.data.error.includes('查看'));
  controller.preview(); const confirmedPreview = controller._confirmedPreview; await controller.runCloud();
  assert.equal(seen.at(-1)[0], 'prepare'); assert.equal(seen.at(-1)[1].question, '新问题'); assert.equal(seen.at(-1)[2], confirmedPreview);
});

test('research checkbox group applies the actual selected values and invalidates preview', () => {
  const service = { ai: () => ({ capabilities: () => ({ realProviderConfigured: true, label: '' }), pending: () => [], previewContext: () => ({ facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] }) }), journal: () => ({ read: () => ({ runs: [] }) }) };
  const { controller } = page('research', service); controller.onLoad(); controller.preview();
  controller.toggleSelections({ detail: { value: ['includeJournal', 'includePolicy'] } });
  assert.equal(controller.data.includeJournal, true); assert.equal(controller.data.includeTradeReasons, false); assert.equal(controller.data.includePolicy, true); assert.equal(controller.data.previewData, null);
});

test('holdings and market analysis links create one-time drafts without sending AI requests', async () => {
  const storage = new Map();
  const sharedWx = { setStorageSync: (key, value) => storage.set(key, value), getStorageSync: key => storage.get(key), removeStorageSync: key => storage.delete(key) };
  const overviewService = { overview: () => ({ clockAnomaly: false, currencies: ['USD'], selectedCurrency: 'USD', positions: [], market: { total: 0, covered: 0 }, marketValue: null, unrealizedPnl: null }), firstUse: () => ({ isEmpty: true }), refreshMarket: async () => {}, invalidateMarketRequest: () => {} };
  const overview = page('overview', overviewService, sharedWx);
  overview.controller.analyzeHoldings();
  assert.deepEqual(overview.calls.switched, ['/pages/research/index']);

  let previews = 0;
  const ai = { capabilities: async () => ({ label: '服务关闭' }), pending: () => [], previewContext: () => { previews++; return {}; } };
  const research = page('research', { ai: () => ai, journal: () => ({ read: () => ({ instance_id: 'i', runs: [] }) }) }, sharedWx);
  research.controller.onLoad(); await research.controller.onShow();
  assert.equal(research.controller.data.mode, 'portfolio_review');
  assert.equal(research.controller.data.question, '我的持仓有哪些需要注意？');
  assert.equal(previews, 0);
  assert.equal(storage.size, 0);

  const position = page('position-detail', { positionDetail: () => ({ id: 'holding-1', symbol: 'QQQ', assetType: 'ETF', quantity: '2' }), refreshMarket: async () => {}, invalidateMarketRequest: () => {} }, sharedWx);
  position.controller.onLoad({ symbol: 'QQQ' }); position.controller.analyze();
  assert.deepEqual(position.calls.switched, ['/pages/research/index']);
  assert.equal(storage.get('portfolio.wechat.navigation-intent.v1').symbol, 'QQQ');
  storage.clear();

  const instrument = { instrument_key: 'US:XNAS:QQQ', symbol: 'QQQ', name: 'Invesco QQQ' };
  const marketService = { marketDiscovery: () => ({ results: [instrument], watchlist: [] }), marketBars: async () => ({ status: 'unavailable' }) };
  const detail = page('market-detail', marketService, sharedWx);
  detail.controller.onLoad({ key: encodeURIComponent(instrument.instrument_key) }); detail.controller.analyze();
  assert.deepEqual(detail.calls.switched, ['/pages/research/index']);
  assert.equal(storage.get('portfolio.wechat.navigation-intent.v1').symbol, 'QQQ');
});

test('AI journal keeps personal notes and dated history local until the user explicitly asks AI', async () => {
  const saved = [];
  const journal = {
    read: () => ({ instance_id: 'instance-1', runs: [] }),
    calendarMonth: month => [{ day: `${month}-10`, count: 2 }],
    history: date => [{ id: 'note-1', kind: 'personal_note', body: '本地记录', day: date }],
    savePersonalNote: (date, text) => saved.push([date, text]),
  };
  const ai = { capabilities: async () => ({ label: '服务关闭' }), pending: () => [] };
  const { controller } = page('research', { ai: () => ai, journal: () => journal });
  controller.onLoad({}); await controller.onShow(); controller.toggleHistory();
  assert.equal(controller.data.calendarDays.find(item => item.day === '2026-09-10').hasItems, true);
  controller.selectHistoryDay({ currentTarget: { dataset: { day: '2026-09-10' } } });
  assert.equal(controller.data.historyItems[0].body, '本地记录');
  controller.startNote(); controller.onNote({ detail: { value: '今天不追高' } }); controller.saveNote();
  assert.deepEqual(saved, [['2026-09-10', '今天不追高']]);
});

test('conversation deletion and saving an assistant message as a personal note are explicit', async () => {
  const deleted = []; const saved = [];
  const conversation = { id: 'conversation-1', origin: 'portfolio', anchor_id: null, workspace_instance_id: 'instance-1' };
  const messages = [{ id: 'assistant-1', role: 'assistant', content: '先控制仓位。' }];
  const journal = { deleteConversation: id => deleted.push(id), saveAiMessageAsNote: (id, date, text) => saved.push([id, date, text]) };
  const ai = { capabilities: async () => ({ label: '服务关闭', enabled: false }), conversation: () => ({ conversation, messages, runs: [], sources: [] }) };
  const { controller, calls } = page('conversation', { ai: () => ai, journal: () => journal });
  await controller.onLoad({ id: conversation.id });
  controller.startSaveNote({ currentTarget: { dataset: { id: 'assistant-1' } } });
  controller.onNoteDraft({ detail: { value: '控制仓位，不追高。' } }); controller.confirmSaveNote();
  assert.deepEqual(saved, [['assistant-1', '2026-09-10', '控制仓位，不追高。']]);
  controller.deleteConversation();
  assert.deepEqual(deleted, ['conversation-1']);
  assert.deepEqual(calls.switched, ['/pages/research/index']);
  assert.match(calls.notices.find(item => item.title === '删除这段会话？').content, /不可恢复/);
});

test('follow-up requires a fresh readonly preview before creating the request', async () => {
  const seen = []; const conversation = { id: 'conversation-1', origin: 'portfolio', anchor_id: null };
  const ai = { capabilities: () => ({ realProviderConfigured: true, enabled: true, providerConfigured: true, enrolled: true, consented: true, authorized: true, label: '' }), conversation: () => ({ conversation, messages: [], runs: [] }), pending: () => [], previewContext: input => { seen.push(['preview', input]); return { facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] }; }, prepare: input => { seen.push(['prepare', input]); return { conversation, envelope: { payload_digest: 'a'.repeat(64) } }; }, submitPrepared: async prepared => ({ conversation: prepared.conversation }) };
  const { controller } = page('conversation', { ai: () => ai }); controller.onLoad({ id: conversation.id }); controller.onQuestion({ detail: { value: '继续分析' } });
  await controller.send(); assert.deepEqual(seen, []);
  controller.preview(); assert.equal(seen[0][0], 'preview'); await controller.send(); assert.equal(seen[1][0], 'prepare');
});

test('a submitted pending request cannot be sent again as a new request', async () => {
  let prepares = 0; const preview = { facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] };
  const ai = { capabilities: () => ({ realProviderConfigured: true, enabled: true, providerConfigured: true, enrolled: true, consented: true, authorized: true, label: '' }), pending: () => [], previewContext: () => preview, prepare: () => { prepares++; return { conversation: { id: 'conversation-1' }, envelope: { payload_digest: 'a'.repeat(64) } }; }, submitPrepared: async () => ({ requestId: 'request-1', status: 'running' }) };
  const service = { ai: () => ai, journal: () => ({ read: () => ({ instance_id: 'instance-1', runs: [] }) }) };
  const { controller } = page('research', service); controller.onLoad(); await controller.onShow(); controller.preview(); await controller.runCloud(); await controller.runCloud();
  assert.equal(prepares, 1); assert.ok(controller.data.error.includes('先查看'));
});

test('settings labels and restores the current v7 backup and owns its navigation title', () => {
  const workspace = { policies: [], journal: [], conversations: [], runs: [], sources: [] };
  const service = {
    snapshot: () => ({ mode: 'personal' }), journal: () => ({ read: () => workspace }), overview: () => ({ clockAnomaly: null }), records: () => [],
    ai: () => ({ capabilities: async () => ({ label: '服务关闭', usage: null }) }), pendingSave: () => null, workspacePending: () => null,
    previewCompleteBackup: () => ({ version: 7, openings: 0, trades: 0, personalNotes: 0, runs: 0, complete: true }), restoreCompleteBackup: () => {},
  };
  const { controller, calls } = page('settings', service);
  controller.onShow();
  assert.deepEqual(calls.titles, ['数据与设置']);
  const template = readFileSync(new URL('pages/settings/index.wxml', source), 'utf8');
  assert.match(template, /导出 v7 完整备份/);
  controller.setData({ preview: service.previewCompleteBackup(), backupText: '{}' });
  controller.restoreBackup();
  assert.match(calls.notices.find(item => item.title === '用备份替换当前完整工作区？').content, /这是 v7 完整备份/);
});

test('multi-image import keeps successful drafts, retries failures only and leaves duplicate rows unselected', async () => {
  const sent = []; let fail = true;
  const vision = { capabilities: async () => ({ enabled: true, providerConfigured: true }), recognizeFile: async input => {
    sent.push(input.tempFilePath);
    if (input.tempFilePath === '/2.jpg' && fail) throw Error('暂时失败');
    return { rows: [{ name: 'Example ETF', code: 'ABC', quantityText: '2', unitCostText: '10', costBasis: 'average_cost', currency: 'USD' }] };
  } };
  const candidate = { symbol: 'ABC', name: 'Example ETF', market: 'US', currency: 'USD', asset_type: 'ETF', instrument_key: 'US:XNAS:ABC' };
  const service = { vision: () => vision, snapshot: () => ({ revision: 0 }), overview: () => ({ positions: [] }), searchMarket: async () => [candidate] };
  const { controller } = page('holding-import', service, { chooseMedia: args => { assert.equal(args.count, 9); args.success({ tempFiles: [1, 2].map(i => ({ tempFilePath: `/${i}.jpg`, size: 100 })) }); } });
  await controller.onLoad(); controller.chooseImage(); await controller.startRecognition();
  assert.equal(controller.data.rows.length, 1); assert.equal(controller.data.failedImages.length, 1);
  controller.onRowField({ currentTarget: { dataset: { index: 0, field: 'quantity' } }, detail: { value: '3' } });
  fail = false; await controller.startRecognition();
  assert.deepEqual(sent, ['/1.jpg', '/2.jpg', '/2.jpg']);
  assert.equal(controller.data.rows[0].quantity, '3');
  assert.equal(controller.data.rows[1].selected, false); assert.equal(controller.data.rows[1].duplicate, true);
  assert.equal(controller.data.failedImages.length, 0);
});

test('one confirmation selects an unmatched existing holding and approves its update; final modal controls writes', async () => {
  let saves = 0, confirm = false;
  const service = { overview: () => ({ positions: [{ id: 'abc', symbol: 'ABC', market: 'US', currency: 'USD', quantity: '1' }] }), searchMarket: async () => [], previewHoldingImport: input => { assert.equal(input.rows[0].replaceApproved, true); return { contentToken: 'token' }; }, saveHoldingImport: input => { assert.equal(input.contentToken, 'token'); saves++; return { imported: 1 }; } };
  const { controller } = page('holding-import', service, { showModal: args => args.success({ confirm }) });
  controller.setData({ rows: await controller.resolveRows([{ name: 'Example ETF', code: 'ABC', quantityText: '2', costBasis: 'unknown', currency: 'USD' }]) });
  controller.confirmManual({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(controller.data.rows[0].selected, true); assert.equal(controller.data.rows[0].replaceApproved, true);
  assert.equal(controller.data.rows[0].issues.length, 0);
  await controller.preview(); assert.equal(saves, 0);
  confirm = true; await controller.preview(); assert.equal(saves, 1);
});

test('fund detail formats CNY, zero and missing values without leaking null or a dollar prefix', () => {
  const service = { positionDetail: () => ({ currency: 'CNY', quantity: '2', cost: '100.00', unitCost: '50.0000', realized: null }) };
  const { controller } = page('position-detail', service); controller.onLoad({ symbol: '012345' });
  assert.equal(controller.data.detail.costText, '¥100.00'); assert.equal(controller.data.detail.realizedText, '--');
  service.positionDetail = () => ({ currency: 'USD', cost: null, unitCost: null, realized: '0.00' }); controller.load();
  assert.equal(controller.data.detail.costText, '--'); assert.equal(controller.data.detail.unitCostText, '--'); assert.equal(controller.data.detail.realizedText, '$0.00');
});

test('compact holding cards fall back to screenshot amounts, preserve zero and navigate to detail by id', () => {
  let positions = [{ id: 'fund-id', symbol: '012345', currency: 'CNY', marketValue: null, unrealized: null, screenshotMetrics: { marketValueText: '2,000.00', holdingPnlText: '+50.00' } }];
  const service = { overview: () => ({ positions, currencies: ['CNY', 'USD'], selectedCurrency: 'CNY' }), firstUse: () => ({}) };
  const { controller, calls } = page('overview', service); controller.load();
  assert.equal(controller.data.view.positions[0].amountText, '¥2,000.00');
  assert.equal(controller.data.view.positions[0].pnlText, '¥+50.00');
  assert.equal(controller.data.view.positions[0].amountFromScreenshot, true);
  positions = [{ ...positions[0], marketValue: '2100.00', unrealized: '0.00' }];
  controller.onCurrency({ detail: { value: 1 } });
  assert.equal(controller.data.view.positions[0].pnlText, '¥0.00');
  assert.equal(controller.data.view.positions[0].pnlFromScreenshot, false);
  positions = [{ ...positions[0], marketValue: null, unrealized: null, screenshotMetrics: {} }]; controller.load();
  assert.equal(controller.data.view.positions[0].amountText, '--');
  controller.showPosition({ currentTarget: { dataset: { symbol: 'fund-id' } } });
  assert.ok(calls.routes[0].endsWith('symbol=fund-id'));
});

test('position summary shows screenshot holding profit without relabeling it realized profit', () => {
  let detail = { currency: 'CNY', marketValue: null, unrealized: null, realized: null, screenshotMetrics: { marketValueText: '2,100.00', holdingPnlText: '+100.00' } };
  const { controller } = page('position-detail', { positionDetail: () => detail });
  controller.onLoad({ symbol: '012345' });
  assert.equal(controller.data.detail.holdingPnlText, '¥+100.00');
  assert.equal(controller.data.detail.holdingAmountText, '¥2,100.00');
  assert.equal(controller.data.detail.pnlFromScreenshot, true);
  assert.equal(controller.data.detail.hasRealized, false);
  detail = { ...detail, unrealized: '0.00', realized: '0.00' }; controller.load();
  assert.equal(controller.data.detail.holdingPnlText, '¥0.00');
  assert.equal(controller.data.detail.pnlFromScreenshot, false);
  assert.equal(controller.data.detail.hasRealized, true);
});

test('delete holding requires confirmation, uses original identity and returns to overview', async () => {
  const existing = { id: 'original', symbol: 'QQQ', name: 'Example ETF', market: 'US', currency: 'USD', assetType: 'ETF', status: 'verified', quantity: '2', unitCost: '10' };
  let confirm = false; const writes = [];
  const service = { snapshot: () => ({ revision: 3 }), overview: () => ({ positions: [existing] }), previewHolding: input => { assert.equal(input.instrument.symbol, 'QQQ'); assert.equal(input.quantity, '0'); return { contentToken: 'before-delete' }; }, saveHolding: input => writes.push(input) };
  const { controller, calls } = page('holding-editor', service, { showModal: args => args.success({ confirm }) });
  controller.onLoad({ id: 'original' }); controller.setData({ symbol: 'CHANGED', quantity: '99' });
  await controller.deleteHolding(); assert.equal(writes.length, 0); assert.equal(controller.data.saving, false);
  confirm = true; await controller.deleteHolding(); await controller.deleteHolding();
  assert.equal(writes.length, 1); assert.equal(writes[0].contentToken, 'before-delete'); assert.equal(writes[0].expectedRevision, 3);
  assert.deepEqual(calls.switched, ['/pages/overview/index']);
});
