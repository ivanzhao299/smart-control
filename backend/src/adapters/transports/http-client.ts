import { classifyError, DeviceProtocolError } from '../errors';
import { withRetry, withTimeout } from '../retry';

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpClientOptions {
  baseUrl: string;
  deviceType: string;
  timeoutMs?: number;
  retries?: number;
  authHeader?: string;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async request<T = unknown>(req: HttpRequest, signal?: AbortSignal): Promise<HttpResponse<T>> {
    return withRetry(
      async () => this.doRequest<T>(req, signal),
      {
        retries: this.opts.retries ?? 3,
        timeoutMs: this.opts.timeoutMs ?? 3000,
        signal,
      },
    );
  }

  private async doRequest<T>(req: HttpRequest, signal?: AbortSignal): Promise<HttpResponse<T>> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/${req.path.replace(/^\//, '')}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(req.headers ?? {}),
    };
    if (this.opts.authHeader) headers.Authorization = this.opts.authHeader;
    if (req.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await withTimeout(
        fetch(url, {
          method: req.method ?? 'GET',
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal,
        }),
        this.opts.timeoutMs ?? 3000,
        `${this.opts.deviceType}:http`,
      );
    } catch (err) {
      throw classifyError(this.opts.deviceType, err);
    }

    let text = '';
    try {
      text = await response.text();
    } catch (err) {
      throw classifyError(this.opts.deviceType, err);
    }

    if (!response.ok) {
      throw new DeviceProtocolError(
        this.opts.deviceType,
        `HTTP ${response.status} ${response.statusText} for ${url}: ${text.slice(0, 200)}`,
      );
    }

    let data: T;
    if (!text) {
      data = undefined as unknown as T;
    } else {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    }
    return { status: response.status, data };
  }
}
