import type { ApiError, ApiResponse } from '@erp/shared-types';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Reads the current tokens; returning null sends the request unauthenticated. */
  getTokens?: () => TokenPair | null;
  /** Called after a refresh so the caller can persist the new pair. */
  onTokensRefreshed?: (tokens: TokenPair) => void;
  /** Called when the session is gone for good and the user must sign in again. */
  onAuthFailure?: () => void;
  /** The school a super administrator is acting within. */
  getSchoolId?: () => string | null;
  /** Overridable for tests. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the Authorization header entirely (login, refresh, public pages). */
  anonymous?: boolean;
  /** Return the raw Response — used for file downloads. */
  raw?: boolean;
}

/**
 * An error carrying the API's own envelope, so a caller can branch on `code`
 * and surface field errors against the right form inputs.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Array<{ field: string; message: string }>;
  readonly requestId?: string;

  constructor(status: number, payload: Partial<ApiError> & { message: string }) {
    super(payload.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = payload.code ?? 'UNKNOWN';
    this.fieldErrors = payload.errors ?? [];
    this.requestId = payload.requestId;
  }

  /** Maps field errors onto the shape react-hook-form's setError expects. */
  get byField(): Record<string, string> {
    return Object.fromEntries(this.fieldErrors.map((error) => [error.field, error.message]));
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isValidation(): boolean {
    return this.status === 422 || this.code === 'VALIDATION_ERROR';
  }
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
      continue;
    }
    params.set(key, String(value));
  }

  const rendered = params.toString();
  return rendered ? `?${rendered}` : '';
}

/**
 * The single HTTP client for the platform.
 *
 * It unwraps the API's success envelope so callers get `data` directly, throws
 * `ApiClientError` on failure, and refreshes an expired access token once —
 * concurrent requests share that one refresh rather than each firing their own
 * and invalidating each other through refresh-token rotation.
 */
export class ApiClient {
  private readonly options: ApiClientOptions;
  private readonly fetchImpl: typeof fetch;
  private refreshInFlight: Promise<TokenPair | null> | null = null;

  constructor(options: ApiClientOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);

    if (options.raw) return response as unknown as T;

    if (response.status === 204) return undefined as T;

    let payload: ApiResponse<T> | null = null;
    try {
      payload = (await response.json()) as ApiResponse<T>;
    } catch {
      payload = null;
    }

    if (!response.ok || !payload || payload.success === false) {
      throw new ApiClientError(response.status, {
        message:
          payload && payload.success === false
            ? payload.message
            : `Request failed with status ${response.status}`,
        code: payload && payload.success === false ? payload.code : undefined,
        errors: payload && payload.success === false ? payload.errors : undefined,
        requestId: payload && payload.success === false ? payload.requestId : undefined,
      });
    }

    return payload.data;
  }

  get<T>(path: string, query?: Record<string, unknown>, options: RequestOptions = {}) {
    return this.request<T>(path, { ...options, method: 'GET', query });
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}) {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}) {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}) {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  delete<T>(path: string, query?: Record<string, unknown>, options: RequestOptions = {}) {
    return this.request<T>(path, { ...options, method: 'DELETE', query });
  }

  /** Fetches a file (PDF, spreadsheet) as a Blob with its server-sent name. */
  async download(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ blob: Blob; fileName: string }> {
    const response = await this.send(path, options);

    if (!response.ok) {
      let message = `Download failed with status ${response.status}`;
      let code: string | undefined;
      try {
        const payload = (await response.json()) as ApiError;
        message = payload.message ?? message;
        code = payload.code;
      } catch {
        // A non-JSON error body tells us nothing more than the status.
      }
      throw new ApiClientError(response.status, { message, code });
    }

    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);

    return {
      blob: await response.blob(),
      fileName: match ? decodeURIComponent(match[1]) : 'download',
    };
  }

  // -------------------------------------------------------------------------

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const response = await this.dispatch(path, options);

    // A 401 on an authenticated call means the access token has expired; try
    // once with a refreshed one before giving up on the session.
    if (response.status !== 401 || options.anonymous || path.startsWith('/auth/refresh')) {
      return response;
    }

    const refreshed = await this.refresh();
    if (!refreshed) {
      this.options.onAuthFailure?.();
      return response;
    }

    return this.dispatch(path, options);
  }

  private async dispatch(path: string, options: RequestOptions): Promise<Response> {
    const tokens = options.anonymous ? null : this.options.getTokens?.() ?? null;
    const schoolId = this.options.getSchoolId?.() ?? null;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      ...(schoolId ? { 'X-School-Id': schoolId } : {}),
      ...options.headers,
    };

    return this.fetchImpl(`${this.baseUrl}${path}${buildQuery(options.query)}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  /**
   * Refreshes the token pair, collapsing concurrent callers onto one attempt.
   *
   * The API rotates refresh tokens and revokes the family when it sees a
   * replay, so two parallel refreshes would log the user out.
   */
  private refresh(): Promise<TokenPair | null> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const current = this.options.getTokens?.();
        if (!current?.refreshToken) return null;

        const response = await this.fetchImpl(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });

        if (!response.ok) return null;

        const payload = (await response.json()) as ApiResponse<{ tokens: TokenPair }>;
        if (payload.success === false) return null;

        const tokens = payload.data.tokens;
        this.options.onTokensRefreshed?.(tokens);
        return tokens;
      } catch {
        return null;
      } finally {
        // Cleared on the next tick so callers awaiting this promise all see the
        // same result before a new attempt can start.
        setTimeout(() => {
          this.refreshInFlight = null;
        }, 0);
      }
    })();

    return this.refreshInFlight;
  }
}
