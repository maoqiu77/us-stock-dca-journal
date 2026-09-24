const cloud = require('wx-server-sdk');
const gateway = require('./gateway.cjs');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const terminalStates = ['succeeded', 'acked', 'failed', 'expired', 'outcome_unknown'];
const document = result => Array.isArray(result.data) ? result.data[0] : result.data;
async function optionalDocument(ref) {
  try { return document(await ref.get()); }
  catch (error) {
    // CloudBase throws for a missing document, including already ACKed payloads.
    // Permission, network and transaction errors must still abort the run.
    if (String(error?.errCode) === '-1' && /document with _id .+ does not exist/.test(String(error?.errMsg || error?.message))) return null;
    throw error;
  }
}
exports.main = async event => {
  // Both provenance fields are set by the platform, never by the event payload.
  // A timer may omit WeChat SOURCE; any non-timer caller chain still fails closed.
  const context = cloud.getWXContext();
  const timerSource = context.SOURCE === 'wx_trigger'
    || (process.env.TRIGGER_SRC === 'timer' && !context.SOURCE && event?.Type === 'Timer');
  const trustedTimer = timerSource && !context.OPENID && !context.FROM_OPENID
    && !!process.env.CLEANUP_TIMER_NAME
    && event.TriggerName === process.env.CLEANUP_TIMER_NAME;
  let token = event?.token;
  if (event?.Type === 'Timer' && typeof event.Message === 'string') {
    try { token = JSON.parse(event.Message)?.token; } catch { token = undefined; }
  }
  if (!process.env.CLEANUP_JOB_TOKEN || (!trustedTimer && (typeof token !== 'string' || token !== process.env.CLEANUP_JOB_TOKEN))) {
    const sourceLabel = value => typeof value === 'string' && /^[a-z_,]{1,80}$/.test(value) ? value : value == null ? 'missing' : 'other';
    console.warn('CLEANUP_AUTH_REJECTED', {
      source: sourceLabel(context.SOURCE), triggerSource: sourceLabel(process.env.TRIGGER_SRC),
      timerEvent: event?.Type === 'Timer', triggerNameMatches: !!process.env.CLEANUP_TIMER_NAME && event?.TriggerName === process.env.CLEANUP_TIMER_NAME,
      hasPrincipal: !!(context.OPENID || context.FROM_OPENID), tokenConfigured: !!process.env.CLEANUP_JOB_TOKEN,
    });
    throw Error('UNAUTHORIZED_CLEANUP');
  }
  const retention = Number(process.env.AI_PAYLOAD_RETENTION_MS ?? 86400000);
  if (!Number.isSafeInteger(retention) || retention <= 0 || !Number.isFinite(new Date(Date.now() - retention).getTime())) throw Error('INVALID_AI_PAYLOAD_RETENTION_MS');
  const db = cloud.database(), now = new Date(Date.now()).toISOString(), before = new Date(Date.now() - retention).toISOString();
  // Query only identities; no request/response bodies are logged or returned.
  // A transaction rechecks terminal state, so a live provider call is never purged.
  const requests = await db.collection('ai_requests').where({
    createdAt: db.command.lt(before), state: db.command.in(terminalStates), payloadPurgedAt: db.command.exists(false),
  }).field({ _id: true }).limit(100).get();
  let purgedRequests = 0, removed = 0;
  for (const row of requests.data) {
    const result = await db.runTransaction(async tx => {
      const ref = tx.collection('ai_requests').doc(row._id), record = await optionalDocument(ref);
      if (!record || !terminalStates.includes(record.state) || !(record.createdAt < before) || record.payloadPurgedAt) return { purged: 0, removed: 0 };
      const responseDigest = record.responseDigest ?? record.response?.response_digest;
      const payload = tx.collection('ai_payloads').doc(row._id), existingPayload = await optionalDocument(payload);
      await ref.update({ data: {
        envelope: null, response: null, payloadPurgedAt: now,
        ...(responseDigest ? { responseDigest } : {}),
        ...(record.state === 'succeeded' ? { state: 'expired' } : {}),
      } });
      if (existingPayload) { await payload.remove(); return { purged: 1, removed: 1 }; }
      return { purged: 1, removed: 0 };
    });
    purgedRequests += result.purged; removed += result.removed;
  }
  // Recover old orphan payloads without touching audit/usage/turn-key records.
  let cursor;
  for (;;) {
    const payloads = await db.collection('ai_payloads').where({
      expiresAt: db.command.lt(before), ...(cursor ? { _id: db.command.gt(cursor) } : {}),
    }).orderBy('_id', 'asc').field({ _id: true }).limit(100).get();
    if (!payloads.data.length) break;
    for (const row of payloads.data) {
      removed += await db.runTransaction(async tx => {
        if (await optionalDocument(tx.collection('ai_requests').doc(row._id))) return 0;
        const ref = tx.collection('ai_payloads').doc(row._id), payload = await optionalDocument(ref);
        if (!payload || !(payload.expiresAt < before)) return 0;
        await ref.remove(); return 1;
      });
    }
    cursor = payloads.data[payloads.data.length - 1]._id;
    if (payloads.data.length < 100) break;
  }
  // Private market receipts follow the request lifecycle. Prepared-but-unused
  // receipts receive the same retention grace; accepted receipts are removed
  // after retainedUntil only when their AI request is no longer running.
  let removedReceipts = 0;
  const stalePrepared = await db.collection('market_receipts_private').where({ expiresAt: db.command.lt(before), acceptedRequestId: db.command.exists(false) }).field({ _id: true }).limit(100).get();
  for (const row of stalePrepared.data) { await db.collection('market_receipts_private').doc(row._id).remove(); removedReceipts++; }
  const retained = await db.collection('market_receipts_private').where({ retainedUntil: db.command.lt(now), acceptedRequestId: db.command.exists(true) }).field({ _id: true, requestDocumentId: true }).limit(100).get();
  for (const row of retained.data) {
    const request = row.requestDocumentId ? await optionalDocument(db.collection('ai_requests').doc(row.requestDocumentId)) : null;
    if (request?.state === 'running') continue;
    await db.collection('market_receipts_private').doc(row._id).remove(); removedReceipts++;
  }
  const vision = await gateway.cleanupExpiredVisionTasks(gateway.createCloudbaseVisionTaskStore(db), { remove: fileID => cloud.deleteFile({ fileList: [fileID] }) }, now);
  return { removed, purgedRequests, removedReceipts, vision };
};
