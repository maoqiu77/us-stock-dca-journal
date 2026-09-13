const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const terminalStates = ['succeeded', 'acked', 'failed', 'expired', 'outcome_unknown'];
const document = result => Array.isArray(result.data) ? result.data[0] : result.data;
exports.main = async event => {
  let token = event?.token;
  if (event?.Type === 'Timer' && typeof event.Message === 'string') {
    try { token = JSON.parse(event.Message)?.token; } catch { token = undefined; }
  }
  if (!process.env.CLEANUP_JOB_TOKEN || typeof token !== 'string' || token !== process.env.CLEANUP_JOB_TOKEN) throw Error('UNAUTHORIZED_CLEANUP');
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
      const ref = tx.collection('ai_requests').doc(row._id), record = document(await ref.get());
      if (!record || !terminalStates.includes(record.state) || !(record.createdAt < before) || record.payloadPurgedAt) return { purged: 0, removed: 0 };
      const responseDigest = record.responseDigest ?? record.response?.response_digest;
      const payload = tx.collection('ai_payloads').doc(row._id), existingPayload = document(await payload.get());
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
        if (document(await tx.collection('ai_requests').doc(row._id).get())) return 0;
        const ref = tx.collection('ai_payloads').doc(row._id), payload = document(await ref.get());
        if (!payload || !(payload.expiresAt < before)) return 0;
        await ref.remove(); return 1;
      });
    }
    cursor = payloads.data[payloads.data.length - 1]._id;
    if (payloads.data.length < 100) break;
  }
  return { removed, purgedRequests };
};
