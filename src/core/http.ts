/**
 * Probe Agents Kit - HTTP Client
 *
 * Fetch wrapper with:
 * - Exponential backoff on 429/5xx
 * - Configurable retries
 * - JSON serialization
 */

export interface HttpConfig {
  baseUrl: string;
  maxRetries: number;
  baseDelayMs?: number;
}

export interface HttpResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

const DEFAULT_BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpClient {
  private baseUrl: string;
  private maxRetries: number;
  private baseDelayMs: number;

  constructor(config: HttpConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.maxRetries = config.maxRetries;
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  }

  private async fetchWithRetry<T>(
    path: string,
    options: RequestInit
  ): Promise<HttpResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        const response = await fetch(url, options);

        // Parse JSON response
        const text = await response.text();
        let data: T | undefined;
        if (text) {
          try {
            data = JSON.parse(text) as T;
          } catch {
            // Not JSON, treat as error
            if (!response.ok) {
              return { ok: false, status: response.status, error: text };
            }
          }
        }

        // Success
        if (response.ok) {
          return { ok: true, status: response.status, data };
        }

        // Check if retryable
        if (response.status === 429 || response.status >= 500) {
          attempt++;
          if (attempt <= this.maxRetries) {
            const delay = this.baseDelayMs * Math.pow(2, attempt - 1);
            await sleep(delay);
            continue;
          }
        }

        // Non-retryable error
        return {
          ok: false,
          status: response.status,
          error: data && typeof data === 'object' && 'error' in data
            ? String((data as { error: unknown }).error)
            : text,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        attempt++;
        if (attempt <= this.maxRetries) {
          const delay = this.baseDelayMs * Math.pow(2, attempt - 1);
          await sleep(delay);
        }
      }
    }

    return {
      ok: false,
      status: 0,
      error: lastError?.message ?? 'Unknown error after retries',
    };
  }

  async get<T>(path: string): Promise<HttpResponse<T>> {
    return this.fetchWithRetry<T>(path, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
  }

  async post<T, R>(path: string, body: T): Promise<HttpResponse<R>> {
    return this.fetchWithRetry<R>(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
}

export function createHttpClient(config: HttpConfig): HttpClient {
  return new HttpClient(config);
}
