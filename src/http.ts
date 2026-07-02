import type { ResolvedConfig } from "./config.js";
import {
  WebhookRelayAPIError,
  WebhookRelayConnectionError,
} from "./errors.js";

export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Override the default timeout for this request (ms). */
  timeoutMs?: number;
}

/**
 * Thin, typed wrapper around `fetch` that injects auth, serializes query params
 * and JSON bodies, maps failures onto the SDK's error classes, and enforces a
 * timeout. Resource clients build on this; end users rarely touch it directly.
 */
export class HttpClient {
  constructor(private readonly config: ResolvedConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  put<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(this.config.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);

    const headers: Record<string, string> = {
      Authorization: this.config.authHeader,
      Accept: "application/json",
      "User-Agent": this.config.userAgent,
      ...this.config.headers,
      ...options.headers,
    };

    let bodyInit: BodyInit | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(options.body);
    }

    const { signal, cleanup } = this.makeSignal(options.signal, options.timeoutMs);

    let response: Response;
    try {
      response = await this.config.fetch(url, {
        method,
        headers,
        body: bodyInit,
        signal,
      });
    } catch (err) {
      cleanup();
      if (isAbortError(err)) {
        throw new WebhookRelayConnectionError(
          `Request ${method} ${path} was aborted or timed out`,
          { cause: err },
        );
      }
      throw new WebhookRelayConnectionError(
        `Request ${method} ${path} failed to reach ${this.config.baseUrl}`,
        { cause: err },
      );
    }
    cleanup();

    const requestId = response.headers.get("Request-Id") ?? undefined;
    const parsed = await parseBody(response);

    if (!response.ok) {
      throw new WebhookRelayAPIError({
        status: response.status,
        method,
        path,
        body: parsed,
        requestId,
      });
    }

    return parsed as T;
  }

  private makeSignal(
    userSignal: AbortSignal | undefined,
    timeoutOverride: number | undefined,
  ): { signal: AbortSignal | undefined; cleanup: () => void } {
    const timeoutMs = timeoutOverride ?? this.config.timeoutMs;
    if (!timeoutMs || timeoutMs <= 0) {
      return { signal: userSignal, cleanup: () => {} };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onUserAbort = () => controller.abort();
    if (userSignal) {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener("abort", onUserAbort, { once: true });
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        userSignal?.removeEventListener("abort", onUserAbort);
      },
    };
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  // Some endpoints omit the JSON content-type; try anyway, fall back to text.
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}
