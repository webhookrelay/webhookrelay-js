import { WebhookRelayConfigError } from "./errors.js";

/** Default Webhook Relay API host. */
export const DEFAULT_BASE_URL = "https://my.webhookrelay.com";

/**
 * The constant "key" the WebSocket server expects when authenticating with a
 * single account API key (the classic access token uses a real key/secret pair).
 */
const API_KEY_SOCKET_KEY = "whr";

export interface WebhookRelayConfig {
  /**
   * Account API key — the recommended credential. Starts with `sk-`. Create one
   * at https://my.webhookrelay.com/tokens. Sent as `Authorization: Bearer`.
   */
  apiKey?: string;
  /** Classic access token key (use together with {@link WebhookRelayConfig.secret}). */
  key?: string;
  /** Classic access token secret (use together with {@link WebhookRelayConfig.key}). */
  secret?: string;
  /** API base URL. Defaults to `https://my.webhookrelay.com`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. Set to 0 to disable. */
  timeoutMs?: number;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra headers sent with every REST request. */
  headers?: Record<string, string>;
  /** Appended to the SDK's default User-Agent. */
  userAgent?: string;
}

/** Auth message payload sent over the WebSocket. */
export interface SocketAuth {
  key: string;
  secret: string;
}

export interface ResolvedConfig {
  baseUrl: string;
  authHeader: string;
  socketAuth: SocketAuth;
  timeoutMs: number;
  fetch: typeof fetch;
  headers: Record<string, string>;
  userAgent: string;
}

function base64(input: string): string {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(input);
  }
  // Node.js
  return Buffer.from(input, "utf-8").toString("base64");
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const v = env?.[name];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Resolves user config (falling back to environment variables) into the
 * normalized shape the HTTP client and WebSocket use.
 *
 * Credential precedence:
 *  1. `apiKey` (or a `secret` that looks like an `sk-` key) → Bearer auth.
 *  2. `key` + `secret` classic access token → HTTP Basic auth.
 *
 * Environment fallbacks (Node): `RELAY_API_KEY`, then `RELAY_KEY` + `RELAY_SECRET`.
 */
export function resolveConfig(config: WebhookRelayConfig = {}): ResolvedConfig {
  const apiKey = config.apiKey ?? readEnv("RELAY_API_KEY");
  let key = config.key ?? readEnv("RELAY_KEY");
  let secret = config.secret ?? readEnv("RELAY_SECRET");

  let authHeader: string;
  let socketAuth: SocketAuth;

  // A secret shaped like an API key (sk-...) is used as a bearer token even if
  // it arrived via the `secret` field — this is how the relay CLI stores it
  // (RELAY_KEY=whr, RELAY_SECRET=sk-...).
  const bearerKey = apiKey ?? (secret && secret.startsWith("sk-") ? secret : undefined);

  if (bearerKey) {
    authHeader = `Bearer ${bearerKey}`;
    socketAuth = { key: API_KEY_SOCKET_KEY, secret: bearerKey };
  } else if (key && secret) {
    authHeader = `Basic ${base64(`${key}:${secret}`)}`;
    socketAuth = { key, secret };
  } else {
    throw new WebhookRelayConfigError(
      "Missing Webhook Relay credentials. Pass { apiKey: 'sk-...' } (recommended) " +
        "or { key, secret }, or set RELAY_API_KEY (or RELAY_KEY + RELAY_SECRET) in the environment.",
    );
  }

  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new WebhookRelayConfigError(
      "No global fetch available. Use Node.js >= 18, or pass a `fetch` implementation in the config.",
    );
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  return {
    baseUrl,
    authHeader,
    socketAuth,
    timeoutMs: config.timeoutMs ?? 30_000,
    fetch: fetchImpl,
    headers: config.headers ?? {},
    userAgent: config.userAgent
      ? `webhookrelay-sdk-js (${config.userAgent})`
      : "webhookrelay-sdk-js",
  };
}
