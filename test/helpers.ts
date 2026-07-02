import { WebhookRelay } from "../src/index.js";
import type { WebhookRelayConfig } from "../src/config.js";

export interface MockResponse {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Responder = (
  url: string,
  method: string,
  call: RecordedCall,
) => MockResponse | Promise<MockResponse>;

/**
 * Build a `fetch` stand-in that records every call and returns canned
 * responses, so resource clients can be tested with zero network access.
 */
export function createMockFetch(responder: Responder) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    let body: unknown;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = {
      url,
      method,
      headers: (init.headers as Record<string, string>) ?? {},
      body,
    };
    calls.push(call);
    const r = await responder(url, method, call);
    const status = r.status ?? 200;
    const payload =
      r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "");
    const headers = new Headers({
      "Content-Type": "application/json",
      ...(r.headers ?? {}),
    });
    return new Response(payload, { status, headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export function createClient(
  responder: Responder,
  config: WebhookRelayConfig = {},
) {
  const { fetchImpl, calls } = createMockFetch(responder);
  const relay = new WebhookRelay({
    apiKey: "sk-test",
    fetch: fetchImpl,
    ...config,
  });
  return { relay, calls };
}

/** Flush pending microtasks + timers (for async connect/reconnect logic). */
export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
