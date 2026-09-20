import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeepSeekVisionProvider } from '../src/vision/deepseek.ts';

test('vision provider sends server-read bytes as one image and requests only review fields', async () => {
  let request: any;
  const provider = createDeepSeekVisionProvider({ baseUrl: 'https://api.deepseek.com', apiKey: 'secret', model: 'deepseek-flash', timeoutMs: 1000, maxOutputTokens: 1200 }, async (_url, init) => {
    request = init;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ rows: [{ name: 'QQQ', code: 'QQQ', quantityText: '20', unitCostText: null, costBasis: 'unknown', currency: 'USD', accountLabel: null }], truncated: false }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await provider.recognize({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png', requestId: 'vision_req_1' });
  const body = JSON.parse(request.body);
  assert.equal(request.headers.authorization, 'Bearer secret');
  assert.equal(request.headers['x-idempotency-key'], 'vision_req_1');
  assert.equal(body.messages[1].content[0].type, 'image_url');
  assert.equal(body.messages[1].content[0].image_url.url, 'data:image/png;base64,AQID');
  assert.equal(JSON.stringify(body).includes('instrumentId'), false);
  assert.equal((result as any).rows[0].quantityText, '20');
});

test('vision provider rejects markdown, truncation and invalid configuration without leaking provider text', async () => {
  assert.throws(() => createDeepSeekVisionProvider({ baseUrl: 'https://example.com', apiKey: 'secret', model: 'deepseek-flash', timeoutMs: 1000, maxOutputTokens: 1200 }), /VISION_PROVIDER_CONFIG_INVALID/);
  for (const responseBody of [
    { choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] },
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
  ]) {
    const provider = createDeepSeekVisionProvider({ baseUrl: 'https://api.deepseek.com', apiKey: 'secret', model: 'deepseek-flash', timeoutMs: 1000, maxOutputTokens: 1200 }, async () => new Response(JSON.stringify(responseBody), { status: 200 }));
    await assert.rejects(() => provider.recognize({ bytes: Uint8Array.from([1]), mimeType: 'image/jpeg', requestId: 'vision_req_2' }), /VISION_OUTPUT_/);
  }
});
