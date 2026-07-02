import type { ResolvedConfig } from "../config.js";
import { WebhookRelayError } from "../errors.js";
import type { Headers } from "../types.js";
import {
  resolveWebSocketCtor,
  socketUrlFromBase,
  type WebSocketCtor,
  type WebSocketLike,
} from "./websocket.js";

/** Metadata about where a streamed webhook came from. */
export interface WebhookEventMeta {
  id?: string;
  /** Bucket ID. (The wire also carries the misspelled `bucked_id` for back-compat.) */
  bucket_id?: string;
  bucket_name?: string;
  input_id?: string;
  input_name?: string;
  output_name?: string;
  output_destination?: string;
  /** Original (misspelled) field as sent on the wire. */
  bucked_id?: string;
}

/** A webhook delivered over the WebSocket in real time. */
export interface WebhookEvent {
  type: "webhook";
  meta: WebhookEventMeta;
  headers: Headers;
  /** URL query string, e.g. "foo=bar". */
  query: string;
  /** Raw request body as a string. */
  body: string;
  method: string;
}

/** A control/status frame from the server. */
export interface StatusEvent {
  type: "status";
  /** "authenticated" | "subscribed" | "ping" | "unauthorized" | … */
  status: string;
  message?: string;
}

export interface SubscribeOptions {
  /** Bucket IDs or account-unique names to subscribe to. */
  buckets: string[];
  /** Called for every webhook received. */
  onWebhook?: (webhook: WebhookEvent) => void;
  /** Called for every status frame (authenticated, subscribed, ping, …). */
  onStatus?: (status: StatusEvent) => void;
  /** Called on connection/auth errors. */
  onError?: (err: Error) => void;
  /** Called once the subscription is confirmed (server status "subscribed"). */
  onSubscribed?: () => void;
  /** Reconnect automatically when the connection drops. Default true. */
  reconnect?: boolean;
  /** Delay between reconnect attempts, in milliseconds. Default 3000. */
  reconnectDelayMs?: number;
  /** Override the WebSocket constructor (e.g. inject `ws` explicitly). */
  webSocketImpl?: WebSocketCtor;
  /** Override the socket URL (defaults to `wss://<host>/v1/socket`). */
  url?: string;
}

/** Events emitted by a {@link WebhookSubscription} and their payload types. */
export interface SubscriptionEvents {
  webhook: WebhookEvent;
  status: StatusEvent;
  error: Error;
  subscribed: void;
  open: void;
  close: void;
}

type EventName = keyof SubscriptionEvents;
type AnyHandler = (arg: unknown) => void;

/**
 * A live WebSocket subscription to one or more buckets. Handles the
 * authenticate → subscribe handshake, replies to server pings, and (by default)
 * reconnects on drop until you {@link close} it. A fatal `unauthorized` status
 * stops reconnection.
 *
 * ```ts
 * const sub = relay.webhooks.subscribe({
 *   buckets: ["orders"],
 *   onWebhook: (w) => console.log(w.method, w.meta.bucket_name, w.body),
 * });
 * // later…
 * sub.close();
 * ```
 */
export class WebhookSubscription {
  private ws: WebSocketLike | null = null;
  private closed = false;
  private authenticated = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<EventName, Set<AnyHandler>>();

  constructor(
    private readonly config: ResolvedConfig,
    private readonly options: SubscribeOptions,
  ) {
    if (options.onWebhook) this.on("webhook", options.onWebhook);
    if (options.onStatus) this.on("status", options.onStatus);
    if (options.onError) this.on("error", options.onError);
    if (options.onSubscribed) this.on("subscribed", options.onSubscribed);
    // Kick off the connection on the next tick so callers can attach more
    // listeners synchronously after construction.
    void Promise.resolve().then(() => this.connect());
  }

  /** Subscribe to an event. Returns `this` for chaining. */
  on<E extends EventName>(
    event: E,
    handler: (arg: SubscriptionEvents[E]) => void,
  ): this {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(handler as AnyHandler);
    return this;
  }

  /** Remove a previously-added listener. */
  off<E extends EventName>(
    event: E,
    handler: (arg: SubscriptionEvents[E]) => void,
  ): this {
    this.listeners.get(event)?.delete(handler as AnyHandler);
    return this;
  }

  /** True while the socket is open and authenticated. */
  get isReady(): boolean {
    return this.ws !== null && this.authenticated && !this.closed;
  }

  /** Close the subscription permanently (no reconnect). */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket(1000, "client closed");
  }

  private emit(event: EventName, arg?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(arg);
      } catch {
        // A throwing user handler must not break the socket loop.
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.authenticated = false;

    let Ctor: WebSocketCtor;
    try {
      Ctor = await resolveWebSocketCtor(this.options.webSocketImpl);
    } catch (err) {
      this.emit("error", err);
      return; // Cannot obtain a WebSocket at all — do not retry.
    }
    if (this.closed) return;

    const url = this.options.url ?? socketUrlFromBase(this.config.baseUrl);
    let ws: WebSocketLike;
    try {
      ws = new Ctor(url);
    } catch (err) {
      this.emit("error", toError(err));
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.emit("open");
      this.send({
        action: "auth",
        key: this.config.socketAuth.key,
        secret: this.config.socketAuth.secret,
      });
    };

    ws.onmessage = (event) => this.handleMessage(event.data);

    ws.onerror = (event) => {
      this.emit("error", toError((event as { message?: unknown })?.message ?? event));
    };

    ws.onclose = (event) => {
      this.authenticated = false;
      this.ws = null;
      this.emit("close");
      if (!this.closed) this.scheduleReconnect(event?.reason);
    };
  }

  private handleMessage(data: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return; // ignore non-JSON frames
    }

    if (msg.type === "webhook") {
      this.emit("webhook", normalizeWebhook(msg));
      return;
    }

    if (msg.type === "status") {
      const status = msg as unknown as StatusEvent;
      this.emit("status", status);

      switch (status.status) {
        case "authenticated":
          this.authenticated = true;
          this.send({ action: "subscribe", buckets: this.options.buckets });
          break;
        case "subscribed":
          this.emit("subscribed");
          break;
        case "ping":
          this.send({ action: "pong" });
          break;
        case "unauthorized":
          // Fatal — bad credentials won't fix themselves on reconnect.
          this.closed = true;
          this.emit(
            "error",
            new WebhookRelayError(
              `WebSocket authentication failed: ${status.message ?? "unauthorized"}`,
            ),
          );
          this.teardownSocket(4001, "unauthorized");
          break;
      }
    }
  }

  private scheduleReconnect(reason?: string): void {
    if (this.closed || this.options.reconnect === false) return;
    if (this.reconnectTimer) return;
    const delay = this.options.reconnectDelayMs ?? 3000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    void reason;
  }

  private send(payload: unknown): void {
    try {
      this.ws?.send(JSON.stringify(payload));
    } catch (err) {
      this.emit("error", toError(err));
    }
  }

  private teardownSocket(code: number, reason: string): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close(code, reason);
    } catch {
      // ignore
    }
  }
}

function normalizeWebhook(msg: Record<string, unknown>): WebhookEvent {
  const meta = (msg.meta ?? {}) as WebhookEventMeta;
  // The wire field is the misspelled `bucked_id`; expose a corrected alias too.
  if (meta.bucket_id === undefined && meta.bucked_id !== undefined) {
    meta.bucket_id = meta.bucked_id;
  }
  return {
    type: "webhook",
    meta,
    headers: (msg.headers ?? {}) as Headers,
    query: (msg.query as string) ?? "",
    body: (msg.body as string) ?? "",
    method: (msg.method as string) ?? "",
  };
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new WebhookRelayError(
    typeof value === "string" ? value : "WebSocket error",
  );
}
