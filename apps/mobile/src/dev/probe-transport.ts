export type ProbeFetchInit = {
  method: 'GET'; redirect: 'error'; credentials: 'omit';
  headers: { Authorization: string }; signal: AbortSignal;
};
export async function fetchProbeWithoutRedirects<T>(fetcher: (url: string, init: ProbeFetchInit) => Promise<T>, url: string, timeoutMs = 5000): Promise<T> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('probe_tls_required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) throw new Error('invalid_probe_timeout');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(parsed.toString(), {
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: { Authorization: 'Bearer synthetic-public-probe' }, signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }
}
