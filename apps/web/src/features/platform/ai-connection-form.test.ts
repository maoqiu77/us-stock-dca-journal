import assert from "node:assert/strict";
import test from "node:test";

import { connectionAddress, connectionError } from "./ai-connection-form.ts";

test("the same service can use base or full endpoint without losing its saved key", () => {
  assert.equal(connectionAddress(" https://relay.test/v1/chat/completions/ "), "https://relay.test/v1");
  assert.equal(connectionAddress("https://relay.test/v1/messages"), "https://relay.test/v1");
  assert.notEqual(connectionAddress("https://relay.test/other/responses"), connectionAddress("https://relay.test/v1"));
});

test("connection errors explain the next action in plain language", () => {
  assert.match(connectionError("responses: 401 Unauthorized"), /密钥/);
  assert.match(connectionError("chat/completions: 429 rate limit"), /稍后/);
  assert.match(connectionError("402 insufficient balance"), /余额/);
  assert.match(connectionError("Read timed out"), /超时/);
  assert.match(connectionError("404 model not found"), /模型/);
  assert.match(connectionError("503 unavailable"), /服务商/);
  assert.equal(connectionError("当前模型不支持图片"), "当前模型不支持图片");
});
