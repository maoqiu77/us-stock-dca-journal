const PERIODS = { '1day': '日线', '60min': '60 分钟', '30min': '30 分钟', '15min': '15 分钟', '5min': '5 分钟', '1min': '1 分钟' };
const SOURCE_NAMES = { quote: '行情数据', user_statement: '本次分析条件', ledger: '持仓与交易', policy: '投资计划', journal: '个人记录', ai_output: '历史 AI 回答', instrument_catalog: '标的信息', fundamentals: '基本面', news: '资讯', imported_excerpt: '引用内容', candidate_pool: '候选标的' };
function localTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}
function questionTitle(question = '') {
  const match = question.match(/^请分析 (US|CN|HK) 市场的 ([A-Z0-9.-]+) 股票或 ETF。主周期：([^；]+)；/);
  return match ? `${match[2]} · ${match[3]}分析` : question.trim().slice(0, 36) || '持仓分析';
}
function historyCard(item) {
  return { ...item, title: item.kind === 'personal_note' ? '个人手记' : questionTitle(item.question), timeLabel: localTime(item.createdAt).slice(11), dateLabel: item.date, summary: item.text || item.body || '', modelLabel: item.executionKind === 'real' ? 'AI 分析' : '离线合成' };
}
function parse(source) { try { return JSON.parse(source.content); } catch (_) { return null; } }
function marketDetails(sources) {
  const groups = new Map(), other = [];
  for (const source of sources) {
    const value = source.type === 'quote' ? parse(source) : null;
    if (value && Array.isArray(value.bars) && value.period) {
      // Only merge chunks from the same frozen receipt and identical series metadata.
      const key = JSON.stringify([source.origin_entity_id, value.market, value.symbol, value.period, value.provider, value.adjustment, value.fetchedAt]);
      const group = groups.get(key) || { ...value, id: source.id, sourceIds: [], bars: [] };
      group.sourceIds.push(source.id); group.bars.push(...value.bars); groups.set(key, group);
    } else {
      other.push({ id: source.id, label: value ? `${value.symbol || ''} · ${value.provider || '行情数据'}` : SOURCE_NAMES[source.type] || '参考资料', detail: value ? `行情截至 ${localTime(value.as_of) || '未提供'}（北京时间）` : `记录时间 ${localTime(source.as_of) || '未提供'}（北京时间）`, fetched: `获取时间 ${localTime(source.available_at) || '未提供'}（北京时间）` });
    }
  }
  const metrics = [], missing = [], details = [...other];
  for (const group of groups.values()) {
    const bars = [...new Map(group.bars.map(bar => [bar.time, bar])).values()].sort((a, b) => a.time.localeCompare(b.time));
    const period = PERIODS[group.period] || group.period;
    const adjustment = { unadjusted: '不复权', forward_adjusted: '前复权', split_adjusted: '拆股调整' }[group.adjustment] || '复权口径未知';
    const last = bars[bars.length - 1];
    const asOf = last ? (group.period === '1day' ? last.time.slice(0, 10) + '（交易日）' : localTime(last.time) + '（北京时间）') : '未提供';
    details.push({ id: group.id, sourceIds: group.sourceIds, label: `${group.symbol} · ${period} · ${group.provider}`, detail: `行情截至 ${asOf} · ${adjustment}`, fetched: `获取时间 ${localTime(group.fetchedAt)}（北京时间）` });
    if (group.status !== 'available' || !last) { missing.push(`${period}行情暂不可用：${group.reason || '没有可用数据'}`); continue; }
    const format = number => Number(number).toFixed(2);
    const rows = [{ label: '最新收盘', value: format(last.close) }];
    for (const count of [5, 20, 60]) {
      const window = bars.slice(-count);
      rows.push({ label: `MA${count}`, value: window.length === count ? format(window.reduce((sum, bar) => sum + bar.close, 0) / count) : '样本不足' });
      if (window.length < count) missing.push(`${period}仅有 ${bars.length} 根 K 线，无法计算 MA${count}`);
    }
    const window = bars.slice(-20);
    rows.push({ label: `近 ${window.length} 根低点`, value: format(Math.min(...window.map(bar => bar.low))) }, { label: `近 ${window.length} 根高点`, value: format(Math.max(...window.map(bar => bar.high))) });
    metrics.push({ id: group.id, label: `${group.symbol} · ${period} · ${group.currency}`, asOf, adjustment, rows });
  }
  return { metrics, missing, details };
}
function followUpQuestions(questions) {
  const defaults = ['哪些信号出现时需要重新评估当前判断？', '这只股票目前最需要关注哪些风险？', '接下来应重点观察哪些价格和成交量变化？', '如果补充持仓数量和成本，可以进一步分析什么？'];
  return [...new Set([...(Array.isArray(questions) ? questions : []), ...defaults].filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))].slice(0, 4);
}
function conversationView(view) {
  const sources = new Map((view.sources || []).map(source => [source.id, source]));
  const messages = view.messages || [], runs = new Map((view.runs || []).map(run => [run.id, run]));
  const turns = messages.filter(message => message.role === 'assistant').map(message => {
    const run = runs.get(message.run_id), result = run?.result || {};
    const isFollowUp = run?.mode === 'follow_up';
    const user = messages.find(item => item.id === message.parent_message_id || (item.role === 'user' && message.client_turn_id && item.client_turn_id === message.client_turn_id));
    const question = user?.content || '', title = questionTitle(question);
    const market = marketDetails((run?.source_ids || []).map(id => sources.get(id)).filter(Boolean));
    const missing = isFollowUp ? [] : [...new Set([...(result.missing_information || []), ...market.missing].map(item => item.trim()).filter(item => item && !/^(无|暂无|无缺失|无缺失项|none|n\/a)[。.!！]?$/i.test(item)))];
    const personal = missing.filter(item => /成本|仓位|持仓|风险偏好|投资期限/.test(item));
    const required = missing.filter(item => !personal.includes(item));
    if (!personal.some(item => /成本|持仓数量/.test(item)) && /持有数量 未提供 股|成本价 未提供/.test(question)) personal.unshift('未填写持仓与成本，当前仅提供行情分析；个人盈亏与仓位情景需要补充信息。');
    return { id: message.id, userId: user?.id || '', question, questionTitle: title, generatedQuestion: /^请分析 (US|CN|HK) 市场的 /.test(question), summary: message.content, time: localTime(message.created_at), savedDate: localTime(message.created_at).slice(0, 10), modelLabel: message.execution_kind === 'real' ? 'AI 分析' : '离线合成 · 非模型回答', evidence: isFollowUp ? [] : (result.evidence || []), counterarguments: isFollowUp ? [] : (result.counterarguments || []), conditions: isFollowUp ? [] : (result.conditions || []).map(item => ({ ...item, label: item.basis === 'user_assumption' ? '条件假设' : '基于已观察数据' })), questions: followUpQuestions(result.next_questions), missing: required, personal: isFollowUp ? [] : [...new Set(personal)], metrics: market.metrics, sources: market.details, expanded: false, questionOpen: false };
  });
  return { turns, title: questionTitle(messages.find(message => message.role === 'user')?.content), nextQuestions: turns.length ? turns[turns.length - 1].questions : [] };
}
module.exports = { localTime, questionTitle, historyCard, marketDetails, conversationView };
