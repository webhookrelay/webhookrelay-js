import { beforeEach, describe, expect, it } from "vitest";
import { WebhookRelay } from "../src/index.js";
import type {
  WebhookEvent,
  StatusEvent,
} from "../src/streaming/socket.js";
import { flush } from "./helpers.js";

/** A drivable fake WebSocket implementing the browser-compatible interface. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  }

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  sent: unknown[] = [];
  closed = false;
  closeCode?: number;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeCode = code;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
  }

  // --- test drivers ---
  open(): void {
    this.onopen?.({});
  }
  emit(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code = 1006, reason = "dropped"): void {
    this.onclose?.({ code, reason });
  }

  lastSent(): Record<string, unknown> {
    return this.sent[this.sent.length - 1] as Record<string, unknown>;
  }
}

function relay() {
  return new WebhookRelay({ apiKey: "sk-test" });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

describe("WebhookSubscription", () => {
  it("authenticates then subscribes, and normalizes webhook meta", async () => {
    const webhooks: WebhookEvent[] = [];
    let subscribed = false;

    relay().webhooks.subscribe({
      buckets: ["orders"],
      webSocketImpl: FakeWebSocket as never,
      onWebhook: (w) => webhooks.push(w),
      onSubscribed: () => (subscribed = true),
    });

    await flush();
    const ws = FakeWebSocket.last();
    expect(ws.url).toBe("wss://my.webhookrelay.com/v1/socket");

    ws.open();
    expect(ws.lastSent()).toEqual({
      action: "auth",
      key: "whr",
      secret: "sk-test",
    });

    ws.emit({ type: "status", status: "authenticated" });
    expect(ws.lastSent()).toEqual({ action: "subscribe", buckets: ["orders"] });

    ws.emit({ type: "status", status: "subscribed" });
    expect(subscribed).toBe(true);

    ws.emit({
      type: "webhook",
      method: "POST",
      body: '{"a":1}',
      query: "x=1",
      headers: { "Content-Type": ["application/json"] },
      meta: { bucked_id: "b1", bucket_name: "orders" },
    });
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].method).toBe("POST");
    // the misspelled wire field is mirrored to a corrected alias
    expect(webhooks[0].meta.bucket_id).toBe("b1");
    expect(webhooks[0].meta.bucked_id).toBe("b1");
  });

  it("replies to server pings with a pong", async () => {
    relay().webhooks.subscribe({
      buckets: ["orders"],
      webSocketImpl: FakeWebSocket as never,
    });
    await flush();
    const ws = FakeWebSocket.last();
    ws.open();
    ws.emit({ type: "status", status: "authenticated" });
    ws.emit({ type: "status", status: "ping" });
    expect(ws.lastSent()).toEqual({ action: "pong" });
  });

  it("treats 'unauthorized' as fatal: errors, closes, and does not reconnect", async () => {
    const errors: Error[] = [];
    relay().webhooks.subscribe({
      buckets: ["orders"],
      webSocketImpl: FakeWebSocket as never,
      reconnectDelayMs: 5,
      onError: (e) => errors.push(e),
    });
    await flush();
    const ws = FakeWebSocket.last();
    ws.open();
    ws.emit({ type: "status", status: "unauthorized", message: "bad key" });

    expect(errors[0].message).toContain("bad key");
    expect(ws.closed).toBe(true);
    expect(ws.closeCode).toBe(4001);

    await flush(20);
    expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect
  });

  it("reconnects after an unexpected close", async () => {
    relay().webhooks.subscribe({
      buckets: ["orders"],
      webSocketImpl: FakeWebSocket as never,
      reconnectDelayMs: 5,
    });
    await flush();
    const ws = FakeWebSocket.last();
    ws.open();
    ws.emit({ type: "status", status: "authenticated" });
    ws.serverClose();

    await flush(20);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it("close() tears down the socket and prevents reconnect", async () => {
    const sub = relay().webhooks.subscribe({
      buckets: ["orders"],
      webSocketImpl: FakeWebSocket as never,
      reconnectDelayMs: 5,
    });
    await flush();
    const ws = FakeWebSocket.last();
    ws.open();
    ws.emit({ type: "status", status: "authenticated" });

    sub.close();
    expect(ws.closed).toBe(true);

    await flush(20);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("forwards status frames to onStatus", async () => {
    const statuses: StatusEvent[] = [];
    relay().webhooks.subscribe({
      buckets: ["orders"],
      webSocketImpl: FakeWebSocket as never,
      onStatus: (s) => statuses.push(s),
    });
    await flush();
    const ws = FakeWebSocket.last();
    ws.open();
    ws.emit({ type: "status", status: "authenticated" });
    expect(statuses.map((s) => s.status)).toContain("authenticated");
  });
});
