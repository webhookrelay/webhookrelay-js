import type { ResolvedConfig } from "./config.js";
import {
  Api,
  ContentType,
  type HttpResponse,
} from "./generated/api.js";
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
  readonly api: Api<null>;

  constructor(private readonly config: ResolvedConfig) {
    this.api = new Api<null>({
      baseUrl: config.baseUrl,
      customFetch: this.fetchWithTimeout,
      securityWorker: () => ({
        headers: {
          Authorization: config.authHeader,
        },
      }),
      baseApiParams: {
        headers: {
          Accept: "application/json",
          "User-Agent": config.userAgent,
          ...config.headers,
        },
      },
    });
  }

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
    const { signal, cleanup } = this.makeSignal(options.signal, options.timeoutMs);
    try {
      return await this.unwrap<T>(
        this.api.request<T, unknown>({
          path,
          method,
          query: options.query,
          body: options.body,
          secure: true,
          type: ContentType.Json,
          format: "json",
          headers: options.headers,
          signal,
        }),
        method,
        path,
      );
    } catch (err) {
      throw await this.toError(err, method, path);
    } finally {
      cleanup();
    }
  }

  async unwrap<T>(
    response: Promise<HttpResponse<unknown, unknown>>,
    method: string,
    path: string,
  ): Promise<T> {
    try {
      const data = (await response).data;
      return (data === null ? undefined : data) as T;
    } catch (err) {
      throw await this.toError(err, method, path);
    }
  }

  private fetchWithTimeout = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const { signal, cleanup } = init.signal
      ? { signal: init.signal, cleanup: () => {} }
      : this.makeSignal(undefined, undefined);
    try {
      return await this.config.fetch(input, { ...init, signal });
    } catch (err) {
      if (err instanceof WebhookRelayConnectionError) throw err;
      if (isAbortError(err)) {
        throw new WebhookRelayConnectionError(
          "Request was aborted or timed out",
          { cause: err },
        );
      }
      throw new WebhookRelayConnectionError(
        `Request failed to reach ${this.config.baseUrl}`,
        { cause: err },
      );
    } finally {
      cleanup();
    }
  };

  private async toError(
    err: unknown,
    method: string,
    path: string,
  ): Promise<Error> {
    if (
      err instanceof WebhookRelayAPIError ||
      err instanceof WebhookRelayConnectionError
    ) {
      return err;
    }

    if (isHttpResponse(err)) {
      return new WebhookRelayAPIError({
        status: err.status,
        method,
        path,
        body: await responseErrorBody(err),
        requestId: err.headers.get("Request-Id") ?? undefined,
      });
    }

    if (isAbortError(err)) {
      return new WebhookRelayConnectionError(
        `Request ${method} ${path} was aborted or timed out`,
        { cause: err },
      );
    }

    return new WebhookRelayConnectionError(
      `Request ${method} ${path} failed to reach ${this.config.baseUrl}`,
      { cause: err },
    );
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

async function responseErrorBody(
  response: HttpResponse<unknown, unknown>,
): Promise<unknown> {
  if (!(response.error instanceof Error)) {
    return response.error ?? response.data;
  }

  try {
    const text = await response.text();
    return text || response.error;
  } catch {
    return response.error;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

function isHttpResponse(err: unknown): err is HttpResponse<unknown, unknown> {
  return (
    typeof Response !== "undefined" &&
    err instanceof Response &&
    "error" in err
  );
}
