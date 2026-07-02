/**
 * Base class for every error thrown by the SDK. Catch this to handle any
 * Webhook Relay failure in one place.
 */
export class WebhookRelayError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "WebhookRelayError";
    // Preserve the underlying cause when available (Node 16.9+ / modern browsers).
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API responds with a non-2xx status code.
 */
export class WebhookRelayAPIError extends WebhookRelayError {
  /** HTTP status code (e.g. 404, 422, 500). */
  readonly status: number;
  /** HTTP method of the failing request. */
  readonly method: string;
  /** Request path that failed. */
  readonly path: string;
  /** Parsed JSON body when the response was JSON, otherwise the raw text. */
  readonly body: unknown;
  /** Value of the `Request-Id` response header, if present — quote it in support requests. */
  readonly requestId?: string;

  constructor(params: {
    status: number;
    method: string;
    path: string;
    body: unknown;
    requestId?: string;
    message?: string;
  }) {
    const detail =
      params.message ??
      extractMessage(params.body) ??
      `${params.method} ${params.path} failed`;
    super(`Webhook Relay API error (${params.status}): ${detail}`);
    this.name = "WebhookRelayAPIError";
    this.status = params.status;
    this.method = params.method;
    this.path = params.path;
    this.body = params.body;
    this.requestId = params.requestId;
  }

  /** True for 401/403 responses. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True for 429 (rate limited). */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** True for 404 (not found). */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Thrown when the request could not reach the API at all (DNS, TLS, timeout,
 * offline, aborted). Distinct from {@link WebhookRelayAPIError}, which means we
 * got a response but it was an error status.
 */
export class WebhookRelayConnectionError extends WebhookRelayError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebhookRelayConnectionError";
  }
}

/**
 * Thrown for invalid SDK configuration (e.g. missing credentials) before any
 * network call is attempted.
 */
export class WebhookRelayConfigError extends WebhookRelayError {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRelayConfigError";
  }
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.trim() || undefined;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}
