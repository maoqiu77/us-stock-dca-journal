import assert from "node:assert/strict";
import test from "node:test";
import { LedgerWriter, type Operation } from "./ledger-writer.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
test("single writer coalesces newer edits and never replaces them with old response", async () => {
  const writes: Operation<number>[] = [];
  const a = deferred<{ state: number; revision: string }>();
  const b = deferred<{ state: number; revision: string }>();
  const writer = new LedgerWriter<number>({ read: async () => ({ state: 0, revision: "r0" }), write: op => { writes.push(op); return writes.length === 1 ? a.promise : b.promise; }, receipt: async () => ({ status: "unknown" }) }, () => {});
  await writer.connect();
  writer.edit(1); writer.edit(2); writer.edit(3);
  assert.equal(writes.length, 1);
  a.resolve({ state: 1, revision: "r1" }); await tick();
  assert.equal(writer.snapshot.state, 3);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].state, 3);
  assert.equal(writes[1].expectedRevision, "r1");
  b.resolve({ state: 3, revision: "r2" }); await tick();
  assert.equal(writer.snapshot.status, "api");
});
test("normalization response does not cause an infinite save", async () => {
  let writes = 0;
  const writer = new LedgerWriter<number>({ read: async () => ({ state: 0, revision: "r0" }), write: async () => { writes++; return { state: 1.23, revision: "r1" }; }, receipt: async () => ({ status: "unknown" }) }, () => {});
  await writer.connect(); writer.edit(1.234); await tick();
  assert.equal(writes, 1); assert.equal(writer.snapshot.state, 1.23);
});
test("timeout queries receipt, preserves operation and never blind retries", async () => {
  let writes = 0; let committed = false;
  const writer = new LedgerWriter<number>({ read: async () => ({ state: 0, revision: "r0" }), write: async () => { writes++; throw Error("timeout"); }, receipt: async () => committed ? { status: "committed", state: 1, revision: "r1" } : { status: "unknown" } }, () => {});
  await writer.connect(); writer.edit(1); await tick();
  const id = writer.snapshot.operation?.operationId;
  assert.equal(writer.snapshot.status, "unknown");
  await writer.connect(); assert.equal(writes, 1); assert.equal(writer.snapshot.operation?.operationId, id);
  committed = true; await writer.verify();
  assert.equal(writer.snapshot.status, "api"); assert.equal(writes, 1);
});
test("first load offline keeps draft; reconnect requires explicit comparison", async () => {
  let online = false; let writes = 0;
  const writer = new LedgerWriter<number>({ read: async () => { if (!online) throw Error("offline"); return { state: 7, revision: "r7" }; }, write: async op => { writes++; return { state: op.state, revision: "r8" }; }, receipt: async () => ({ status: "unknown" }) }, () => {});
  await writer.connect({ state: 5 }); assert.equal(writer.snapshot.status, "local");
  writer.edit(6); online = true; await writer.connect();
  assert.equal(writer.snapshot.status, "conflict"); assert.equal(writer.snapshot.state, 6); assert.equal(writer.snapshot.remote?.state, 7); assert.equal(writes, 0);
  writer.resolve("local"); await tick(); assert.equal(writes, 1); assert.equal(writer.snapshot.state, 6);
});
test("two tabs keep local and remote candidates after conflict", async () => {
  const writer = new LedgerWriter<number>({ read: async () => ({ state: 2, revision: "r2" }), write: async () => { throw Object.assign(Error("conflict"), { status: 409 }); }, receipt: async () => ({ status: "unknown" }) }, () => {});
  await writer.connect(); writer.edit(3); await tick();
  assert.equal(writer.snapshot.status, "conflict"); assert.equal(writer.snapshot.state, 3); assert.equal(writer.snapshot.remote?.state, 2);
  writer.resolve("remote"); assert.equal(writer.snapshot.state, 2);
});
test("reload with unresolved operation queries old receipt before doing anything else", async () => {
  const writer = new LedgerWriter<number>({ read: async () => { throw Error("must not load over unknown"); }, write: async () => { throw Error("must not replay"); }, receipt: async () => ({ status: "committed", state: 1, revision: "r1" }) }, () => {});
  await writer.connect({ state: 1, operation: { state: 1, expectedRevision: "r0", operationId: "old-operation" } });
  assert.equal(writer.snapshot.status, "api"); assert.equal(writer.snapshot.operation, undefined);
});
