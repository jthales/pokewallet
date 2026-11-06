export type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class UpstreamError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** GET JSON com timeout. Devolve null em 404; lança UpstreamError para rede, status ≠ 2xx e JSON inválido. */
export async function getJson(fetchFn: FetchLike, url: string, timeoutMs: number, label: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new UpstreamError(`Não foi possível conectar à ${label}.`, error);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new UpstreamError(`A ${label} respondeu com status ${response.status}.`);
  try {
    return await response.json();
  } catch (error) {
    throw new UpstreamError(`Resposta inválida da ${label}.`, error);
  }
}
