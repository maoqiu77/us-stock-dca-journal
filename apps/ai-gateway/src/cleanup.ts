export interface CleanupStore { deleteExpiredPayloads(before: string, limit: number): Promise<number>; }
export async function cleanupExpiredPayloads(store: CleanupStore, before: string, limit = 100) { if (limit < 1 || limit > 500) throw Error('INVALID_CLEANUP_LIMIT'); return store.deleteExpiredPayloads(before, limit); }
