// Framework-independent single writer. Unknown requests are queried, never replayed.
export type SaveStatus = "loading" | "api" | "saving" | "local" | "error" | "conflict" | "unknown";
export type Versioned<T> = { state: T; revision: string };
export type Operation<T> = { state: T; expectedRevision: string; operationId: string };
export type WriterSnapshot<T> = {
  state?: T; revision?: string; status: SaveStatus; remote?: Versioned<T>;
  operation?: Operation<T>; message?: string;
};
type Transport<T> = {
  read: () => Promise<Versioned<T>>;
  write: (operation: Operation<T>) => Promise<Versioned<T>>;
  receipt: (id: string) => Promise<({ status: "committed" } & Versioned<T>) | { status: "unknown" }>;
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class LedgerWriter<T> {
  snapshot: WriterSnapshot<T> = { status: "loading" };
  private busy = false;
  private connected = false;
  private closed = false;
  private transport: Transport<T>;
  private changed: (value: WriterSnapshot<T>) => void;
  constructor(transport: Transport<T>, changed: (value: WriterSnapshot<T>) => void) {
    this.transport = transport; this.changed = changed;
  }
  private emit(patch: Partial<WriterSnapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (!this.closed) this.changed(this.snapshot);
  }
  close() { this.closed = true; this.connected = false; }

  async connect(draft?: { state: T; operation?: Operation<T> }) {
    if (this.busy || this.closed) return;
    if (draft) this.emit({ state: draft.state, operation: draft.operation });
    if (this.snapshot.operation) { await this.verify(); return; }
    this.busy = true;
    this.connected = false;
    try {
      const remote = await this.transport.read();
      if (this.closed) return;
      if (!remote.revision) throw new Error("API 尚不支持版本保存，请更新本地 API。");
      if (this.snapshot.state !== undefined && !equal(this.snapshot.state, remote.state)) {
        this.emit({ remote, status: "conflict", message: "浏览器候选与数据库不同，请比较后选择。" });
      } else {
        this.connected = true;
        this.emit({ ...remote, remote: undefined, status: "api", message: undefined });
      }
    } catch (error) {
      this.emit({ status: "local", message: String(error) });
    } finally { this.busy = false; }
  }

  edit(state: T) {
    if (equal(state, this.snapshot.state)) return;
    this.emit({ state, status: this.snapshot.operation ? this.snapshot.status : this.connected ? "saving" : this.snapshot.status === "conflict" ? "conflict" : "local" });
    void this.flush();
  }

  resolve(choice: "local" | "remote") {
    const remote = this.snapshot.remote;
    if (!remote || this.busy || this.snapshot.operation) return;
    this.connected = true;
    this.emit({ revision: remote.revision, state: choice === "remote" ? remote.state : this.snapshot.state, remote: undefined, status: choice === "remote" ? "api" : "saving", message: undefined });
    if (choice === "local") void this.flush();
  }

  private async flush() {
    if (this.busy || !this.connected || this.closed || this.snapshot.operation || this.snapshot.state === undefined || !this.snapshot.revision) return;
    const operation = { state: this.snapshot.state, expectedRevision: this.snapshot.revision, operationId: crypto.randomUUID() };
    this.busy = true;
    this.emit({ operation, status: "saving" });
    let committed = false;
    try {
      const response = await this.transport.write(operation);
      this.accept(response, operation);
      committed = true;
    } catch (error) {
      this.connected = false;
      const status = (error as { status?: number }).status;
      if (status === 409 || status === 422 || status === 428) {
        this.emit({ operation: undefined, status: status === 409 ? "conflict" : "error", message: String(error) });
        if (status === 409) {
          try { this.emit({ remote: await this.transport.read() }); } catch { /* Keep both drafts; explicit reconnect. */ }
        }
      } else {
        this.emit({ status: "unknown", message: "保存结果待核验；不会自动重发。" });
      }
    } finally { this.busy = false; }
    if (committed && this.snapshot.status === "saving") void this.flush();
    else if (this.snapshot.status === "unknown") await this.verify();
  }

  private accept(response: Versioned<T>, operation: Operation<T>) {
    if (!response.revision) throw new Error("保存响应缺少 revision");
    const newer = !equal(this.snapshot.state, operation.state);
    this.connected = true;
    this.emit({ revision: response.revision, state: newer ? this.snapshot.state : response.state, operation: undefined, status: newer ? "saving" : "api", message: undefined });
  }

  async verify() {
    const operation = this.snapshot.operation;
    if (!operation || this.busy || this.closed) return;
    this.busy = true;
    let committed = false;
    try {
      const receipt = await this.transport.receipt(operation.operationId);
      if (receipt.status === "committed") { this.accept(receipt, operation); committed = true; }
      else this.emit({ status: "unknown", message: "尚未查到提交回执，请稍后核验或导出草稿；不能据此判定未保存。" });
    } catch { this.emit({ status: "unknown", message: "API 不可用，草稿与操作 ID 已保留，恢复连接后核验。" }); }
    finally { this.busy = false; }
    if (committed && this.snapshot.status === "saving") void this.flush();
  }
}

export function changedFields(local: Record<string, unknown>, remote: Record<string, unknown>) {
  return [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter(key => !equal(local[key], remote[key]));
}
