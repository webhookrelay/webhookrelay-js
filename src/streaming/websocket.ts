import { WebhookRelayConfigError } from "../errors.js";

/**
 * Minimal WebSocket surface shared by the browser's global `WebSocket` and the
 * Node `ws` package (which implements this browser-compatible interface).
 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export interface WebSocketCtor {
  new (url: string, protocols?: string | string[]): WebSocketLike;
}

/**
 * Resolve a WebSocket constructor that works in the current runtime:
 *  - a caller-provided override, else
 *  - the global `WebSocket` (browsers, Deno, Node >= 21), else
 *  - the `ws` package, imported lazily so browsers never bundle it.
 */
export async function resolveWebSocketCtor(
  override?: WebSocketCtor,
): Promise<WebSocketCtor> {
  if (override) return override;

  const globalWs = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (typeof globalWs === "function") return globalWs;

  try {
    const mod = (await import("ws")) as unknown as {
      default?: WebSocketCtor;
      WebSocket?: WebSocketCtor;
    };
    const ctor = mod.default ?? mod.WebSocket;
    if (typeof ctor === "function") return ctor;
    throw new Error("`ws` did not export a WebSocket constructor");
  } catch (err) {
    throw new WebhookRelayConfigError(
      "No WebSocket implementation available. Install the `ws` package " +
        "(`npm install ws`), run on Node.js >= 21, or pass `webSocketImpl` in the subscribe options.",
    );
  }
}

/** Derive the `wss://…/v1/socket` URL from the REST base URL. */
export function socketUrlFromBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/v1/socket";
  url.search = "";
  return url.toString();
}
