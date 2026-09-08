import type {
  ContextEventInput, ContextEventReceipt, ContextEventRecord, ContextGrantInput,
  ContextGrantRecord, ContextPrepareInput, UserContextBundle,
} from './types';

export * from './types';

export class ContextClientError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

/** No framework, model, database or MeetMind application dependencies. */
export class ContextClient {
  private readonly baseUrl: string;
  constructor(private readonly options: {
    baseUrl: string; token: string | (() => string | Promise<string>); fetch?: typeof fetch;
  }) {
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_base_url');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = typeof this.options.token === 'function' ? await this.options.token() : this.options.token;
    const response = await (this.options.fetch ?? fetch)(`${this.baseUrl}/${path}`, {
      method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new ContextClientError(data.error?.code ?? `http_${response.status}`, response.status);
    return data as T;
  }

  append(event: ContextEventInput): Promise<ContextEventReceipt> { return this.request('events', 'POST', event); }
  prepare(input: ContextPrepareInput): Promise<UserContextBundle> { return this.request('prepare', 'POST', input); }
  events(cursor?: string, spaceId?: string): Promise<{ events: ContextEventRecord[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(spaceId ? { spaceId } : {}) });
    return this.request(`events?${query}`);
  }
  source(id: string): Promise<{ event: ContextEventRecord }> { return this.request(`sources/${encodeURIComponent(id)}`); }
  control(id: string, action: 'pause' | 'resume' | 'forget'): Promise<{ event: ContextEventRecord; cleanupPending: boolean }> {
    return this.request(`sources/${encodeURIComponent(id)}`, 'PATCH', { action });
  }
  job(id: string): Promise<{ jobId: string; status: string; visibility: string; cleanupPending: boolean; errorCode: string | null }> {
    return this.request(`jobs/${encodeURIComponent(id)}`);
  }
  retry(id: string): Promise<{ jobId: string }> { return this.request(`jobs/${encodeURIComponent(id)}/retry`, 'POST'); }
  grants(): Promise<{ grants: ContextGrantRecord[] }> { return this.request('grants'); }
  grant(input: ContextGrantInput): Promise<{ grant: ContextGrantRecord; token: string }> { return this.request('grants', 'POST', input); }
  revoke(id: string): Promise<{ revoked: boolean }> { return this.request(`grants/${encodeURIComponent(id)}`, 'DELETE'); }
}
