import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  WebhookRelay,
  WebhookRelayAPIError,
  type OutboundDelivery,
  type OutboundEndpointWithSecret,
  type OutboundMessage,
  type OutboundRecoveryTask,
} from "../../src/index.js";

// Live end-to-end test of outbound webhooks against my.webhookrelay.com.
// Deliveries go to free Webhook Bins (https://webhookrelay.com/webhook-bin.md),
// whose public API lets the test read back exactly what was delivered.
//
// Secrets and the API key are never printed: assertions on secrets compare
// booleans so a failure message cannot leak them.

const hasCredentials =
  Boolean(process.env.RELAY_API_KEY) ||
  (Boolean(process.env.RELAY_KEY) && Boolean(process.env.RELAY_SECRET));

const describeLive = hasCredentials ? describe : describe.skip;

const relay = hasCredentials
  ? new WebhookRelay({ timeoutMs: 15_000 })
  : (undefined as unknown as WebhookRelay);

const BIN_API = "https://bin.webhookrelay.com";

const random = () => Math.random().toString(36).slice(2, 10);
const runId = `${Date.now()}-${random()}`;
const consumerId = `whr-js-sdk-${runId}`;
const eventType = `sdk.test.${random()}`;

// Resources to clean up, even when a test fails half-way.
const createdEndpointIds = new Set<string>();
let consumerCreated = false;
let eventTypeCreated = false;

// --- Webhook Bin -------------------------------------------------------------

interface Bin {
  id: string;
  /** Public HTTPS capture URL. */
  url: string;
}

interface BinRequest {
  id: string;
  receivedAt: number;
  method: string;
  query?: string;
  header?: Record<string, { key: string; values: string[] }>;
  body?: string;
}

async function createBin(): Promise<Bin> {
  const response = await fetch(`${BIN_API}/v1/bins`, { method: "POST" });
  expect(response.status, "Webhook Bin create").toBe(201);
  const { id } = (await response.json()) as { id: string };
  expect(id).toBeTruthy();
  return { id, url: `${BIN_API}/v1/webhooks/${id}` };
}

async function binRequests(bin: Bin): Promise<BinRequest[]> {
  const response = await fetch(`${BIN_API}/v1/bins/${bin.id}`);
  expect(response.status, "Webhook Bin read").toBe(200);
  const data = (await response.json()) as { requests?: BinRequest[] | null };
  return data.requests ?? [];
}

function binHeader(request: BinRequest, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(request.header ?? {})) {
    if (key.toLowerCase() === lower || value.key?.toLowerCase() === lower) {
      return value.values?.[0];
    }
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `fn` until it returns a value (not undefined) or `timeoutMs` passes. */
async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  { timeoutMs = 60_000, intervalMs = 2_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${what}`);
    await sleep(intervalMs);
  }
}

/** Wait until the bin has at least `count` deliveries of `messageId`. */
function waitForDeliveries(bin: Bin, messageId: string, count = 1): Promise<BinRequest[]> {
  return waitFor(`${count} delivery(ies) of message ${messageId} at the bin`, async () => {
    const matching = (await binRequests(bin)).filter(
      (r) => binHeader(r, "webhook-id") === messageId,
    );
    return matching.length >= count ? matching : undefined;
  });
}

// --- Standard Webhooks --------------------------------------------------------

/**
 * Verify a Standard Webhooks signature: HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` keyed with the base64-decoded secret (after the
 * `whsec_` prefix), compared against any `v1,<base64>` entry of the
 * space-separated signature header.
 */
function verifySignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signatureHeader.split(" ").some((entry) => {
    const [version, signature] = entry.split(",", 2);
    if (version !== "v1" || !signature) return false;
    const actual = Buffer.from(signature, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

function expectSignedDelivery(
  request: BinRequest,
  messageId: string,
  secret: string,
): { id: string; timestamp: string; signature: string; body: string } {
  const id = binHeader(request, "webhook-id");
  const timestamp = binHeader(request, "webhook-timestamp");
  const signature = binHeader(request, "webhook-signature");
  const body = request.body ?? "";

  expect(request.method).toBe("POST");
  expect(id).toBe(messageId);
  expect(timestamp).toMatch(/^\d+$/);
  // The timestamp is the attempt's, so it must be recent.
  expect(Math.abs(Date.now() / 1000 - Number(timestamp))).toBeLessThan(300);
  expect(signature).toMatch(/^v1,[A-Za-z0-9+/=]+( v1,[A-Za-z0-9+/=]+)*$/);
  expect(
    verifySignature(secret, id!, timestamp!, body, signature!),
    "webhook-signature must verify with the endpoint's signing secret",
  ).toBe(true);
  return { id: id!, timestamp: timestamp!, signature: signature!, body };
}

function isWhsec(secret: unknown): boolean {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) return false;
  return Buffer.from(secret.slice("whsec_".length), "base64").length >= 24;
}

async function ignoreNotFound(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof WebhookRelayAPIError && err.status === 404)) throw err;
  }
}

// --- State shared by the ordered tests below -----------------------------------

let bin1: Bin;
let bin2: Bin;
let endpoint1: OutboundEndpointWithSecret | undefined;
let endpoint2: OutboundEndpointWithSecret | undefined;
let importedSecret: string | undefined;
let message1: OutboundMessage | undefined;
const payload1 = {
  marker: `whr-js-sdk-${runId}`,
  invoice: { id: "inv_123", amount: 4900, currency: "usd", paid: true },
  lines: [{ sku: "a", qty: 1 }, { sku: "b", qty: 2 }],
  note: null,
};

afterAll(async () => {
  if (!hasCredentials) return;
  // Endpoints first, then the consumer, then the event type (which cannot be
  // deleted while an endpoint subscribes to it). Keep going on failure.
  const errors: string[] = [];
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await ignoreNotFound(fn);
    } catch (err) {
      errors.push(`${what}: ${String(err)}`);
    }
  };
  for (const id of createdEndpointIds) {
    await attempt(`delete endpoint ${id}`, () => relay.outbound.endpoints.delete(id));
  }
  if (consumerCreated) {
    await attempt(`delete consumer ${consumerId}`, () => relay.outbound.consumers.delete(consumerId));
  }
  if (eventTypeCreated) {
    await attempt(`delete event type ${eventType}`, () => relay.outbound.eventTypes.delete(eventType));
  }
  if (errors.length > 0) throw new Error(`outbound cleanup failed: ${errors.join("; ")}`);
}, 60_000);

describeLive("Webhook Relay live API: outbound webhooks", () => {
  beforeAll(async () => {
    const access = await relay.outbound.access();
    if (!access.enabled) {
      throw new Error("outbound not enabled for the CI account (needs Basic+ plan)");
    }
    expect(access.limits?.consumers ?? 1).toBeGreaterThan(0);

    [bin1, bin2] = await Promise.all([createBin(), createBin()]);

    const et = await relay.outbound.eventTypes.upsert(eventType, {
      description: "Created by webhookrelay-js live integration tests",
      example: payload1,
    });
    eventTypeCreated = true;
    expect(et.name).toBe(eventType);
    expect(et.deprecated ?? false).toBe(false);

    const consumer = await relay.outbound.consumers.upsert(consumerId, {
      name: "webhookrelay-js SDK live test",
    });
    consumerCreated = true;
    expect(consumer.id).toBe(consumerId);
    expect(consumer.name).toBe("webhookrelay-js SDK live test");
  }, 60_000);

  it("creates an endpoint with a generated whsec_ signing secret", async () => {
    endpoint1 = await relay.outbound.endpoints.create(consumerId, {
      url: bin1.url,
      eventTypes: [eventType],
      description: "webhookrelay-js live test endpoint 1",
      headers: { "X-WHR-JS-SDK-Test": "1" },
    });
    createdEndpointIds.add(endpoint1.id);

    expect(isWhsec(endpoint1.secret), "endpoint secret must be whsec_ + base64 (>= 24 bytes)").toBe(true);
    expect(endpoint1.consumer).toBe(consumerId);
    expect(endpoint1.url).toBe(bin1.url);
    expect(endpoint1.event_types).toEqual([eventType]);
    expect(endpoint1.state).toBe("active");

    const fetched = await relay.outbound.endpoints.get(endpoint1.id);
    expect(fetched.id).toBe(endpoint1.id);
    expect(fetched).not.toHaveProperty("secret");

    const listed = await relay.outbound.endpoints.list(consumerId);
    expect(listed.map((e) => e.id)).toContain(endpoint1.id);

    const revealed = await relay.outbound.endpoints.revealSecret(endpoint1.id);
    expect(revealed === endpoint1.secret, "revealSecret must return the creation secret").toBe(true);
  });

  it("publishes idempotently and delivers a signed request to the endpoint", async () => {
    expect(endpoint1, "endpoint 1 was not created").toBeDefined();
    const idempotencyKey = `whr-js-sdk-${runId}-1`;
    const params = {
      consumer: consumerId,
      eventType,
      eventId: `evt-${runId}`,
      payload: payload1,
    };

    message1 = await relay.outbound.messages.publish(params, { idempotencyKey });
    expect(message1.id).toBeTruthy();
    expect(message1.consumer).toBe(consumerId);
    expect(message1.event_type).toBe(eventType);
    expect(message1.event_id).toBe(`evt-${runId}`);
    expect(message1.endpoint_ids).toEqual([endpoint1!.id]);

    // Same key + same message → the original receipt, not a second message.
    const repeat = await relay.outbound.messages.publish(params, { idempotencyKey });
    expect(repeat.id).toBe(message1.id);

    // Same key + different message → conflict.
    const conflict = await relay.outbound.messages
      .publish({ ...params, payload: { different: true } }, { idempotencyKey })
      .catch((err: unknown) => err);
    expect(conflict).toBeInstanceOf(WebhookRelayAPIError);
    expect((conflict as WebhookRelayAPIError).status).toBe(409);

    const [delivery] = await waitForDeliveries(bin1, message1.id);
    const { body } = expectSignedDelivery(delivery!, message1.id, endpoint1!.secret);
    expect(JSON.parse(body)).toEqual(payload1);
    expect(binHeader(delivery!, "content-type")).toContain("application/json");
    expect(binHeader(delivery!, "webhook-event-type")).toBe(eventType);
    expect(binHeader(delivery!, "webhook-consumer")).toBe(consumerId);
    expect(binHeader(delivery!, "x-whr-js-sdk-test")).toBe("1");

    // Exactly one delivery: the idempotent repeat did not publish again.
    await sleep(3_000);
    const all = (await binRequests(bin1)).filter((r) => binHeader(r, "webhook-id") === message1!.id);
    expect(all).toHaveLength(1);
  }, 120_000);

  it("reports the delivery as sent on the message and in the endpoint's deliveries", async () => {
    expect(message1, "message 1 was not published").toBeDefined();
    const endpointId = endpoint1!.id;

    const sent = await waitFor<OutboundDelivery>("message 1 delivery status 'sent'", async () => {
      const message = await relay.outbound.messages.get(message1!.id);
      expect(message.payload).toEqual(payload1);
      const delivery = message.deliveries?.find((d) => d.output_id === endpointId);
      return delivery?.status === "sent" ? delivery : undefined;
    });
    expect(sent.status_code).toBe(200);
    expect(sent.message_id ?? message1!.id).toBe(message1!.id);

    const filtered = await waitFor<OutboundDelivery[]>("filtered deliveries list", async () => {
      const list = await relay.outbound.endpoints.deliveries(endpointId, {
        status: "sent",
        event_type: eventType,
        message_id: message1!.id,
        limit: 10,
      });
      return list.length > 0 ? list : undefined;
    }, { timeoutMs: 30_000 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.status).toBe("sent");
    expect(filtered[0]!.event_type ?? eventType).toBe(eventType);
    expect(filtered[0]!.message_id ?? message1!.id).toBe(message1!.id);

    // Filters exclude: no failed delivery for this message, nothing for another event type.
    expect(
      await relay.outbound.endpoints.deliveries(endpointId, { status: "failed", message_id: message1!.id }),
    ).toEqual([]);
    expect(
      await relay.outbound.endpoints.deliveries(endpointId, { event_type: `${eventType}.other` }),
    ).toEqual([]);

    const messages = await relay.outbound.messages.list({ consumer: consumerId, eventType, limit: 10 });
    expect(messages.map((m) => m.id)).toContain(message1!.id);
  }, 120_000);

  it("imports an existing whsec_ secret and signs deliveries with it", async () => {
    expect(endpoint1, "endpoint 1 was not created").toBeDefined();
    importedSecret = `whsec_${randomBytes(32).toString("base64")}`;

    endpoint2 = await relay.outbound.endpoints.create(consumerId, {
      url: bin2.url,
      eventTypes: [eventType],
      description: "webhookrelay-js live test endpoint 2 (imported secret)",
      secret: importedSecret,
    });
    createdEndpointIds.add(endpoint2.id);
    expect(endpoint2.secret === importedSecret, "create must return the imported secret").toBe(true);
    expect(
      (await relay.outbound.endpoints.revealSecret(endpoint2.id)) === importedSecret,
      "revealSecret must return the imported secret",
    ).toBe(true);

    const message2 = await relay.outbound.messages.publish(
      { consumer: consumerId, eventType, payload: { marker: `${payload1.marker}-2` } },
      { idempotencyKey: `whr-js-sdk-${runId}-2` },
    );
    expect([...message2.endpoint_ids].sort()).toEqual([endpoint1!.id, endpoint2.id].sort());

    const [delivery] = await waitForDeliveries(bin2, message2.id);
    const signed = expectSignedDelivery(delivery!, message2.id, importedSecret);
    expect(JSON.parse(signed.body)).toEqual({ marker: `${payload1.marker}-2` });
    expect(
      verifySignature(endpoint1!.secret, signed.id, signed.timestamp, signed.body, signed.signature),
      "endpoint 2's delivery must not verify with endpoint 1's secret",
    ).toBe(false);
  }, 120_000);

  it("rejects an invalid imported secret with 400 without echoing it", async () => {
    const invalid = "whsec_short";
    const err = await relay.outbound.endpoints
      .create(consumerId, {
        url: `${bin2.url}?invalid-secret=1`,
        eventTypes: [eventType],
        secret: invalid,
      })
      .then((created) => {
        createdEndpointIds.add(created.id);
        return created;
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WebhookRelayAPIError);
    const apiErr = err as WebhookRelayAPIError;
    expect(apiErr.status).toBe(400);
    expect(JSON.stringify(apiErr.body ?? "")).not.toContain(invalid);
    expect(apiErr.message).not.toContain(invalid);
  });

  it("reports outbound health and lists endpoints by state", async () => {
    const health = await relay.outbound.health();
    for (const state of ["active", "failing", "paused", "disabled"] as const) {
      expect(typeof health.endpoints[state], `health.endpoints.${state}`).toBe("number");
    }
    expect(health.endpoints.active).toBeGreaterThanOrEqual(endpoint2 ? 2 : 1);
    expect(typeof health.stats.attempts).toBe("number");
    expect(typeof health.stats.failures).toBe("number");
    expect(health.stats.failures).toBeLessThanOrEqual(health.stats.attempts);
    expect(Number.isNaN(Date.parse(health.since))).toBe(false);
    expect(Date.now() - Date.parse(health.since)).toBeLessThanOrEqual(25 * 3600 * 1000);

    const failing = await relay.outbound.endpoints.listAll({ state: "failing", limit: 20 });
    expect(Array.isArray(failing)).toBe(true);
    for (const e of failing) {
      expect(e.state).toBe("failing");
      expect(e).not.toHaveProperty("secret");
    }

    const ours = await relay.outbound.endpoints.listAll({ consumer: consumerId });
    const ids = ours.map((e) => e.id);
    expect(ids).toContain(endpoint1!.id);
    if (endpoint2) expect(ids).toContain(endpoint2.id);
    for (const e of ours) {
      expect(e.consumer).toBe(consumerId);
      expect(typeof e.stats?.attempts).toBe("number");
      expect(typeof e.stats?.failures).toBe("number");
    }
  });

  it("retries a delivery through a recovery task", async () => {
    expect(message1, "message 1 was not published").toBeDefined();
    const task = await relay.outbound.endpoints.retry(endpoint1!.id, message1!.id);
    expect(task.id).toBeTruthy();
    expect(task.endpoint_id).toBe(endpoint1!.id);
    expect(task.message_id).toBe(message1!.id);
    expect(task.kind).toBe("retry");
    expect(["pending", "running", "completed"]).toContain(task.status);
    expect(typeof task.processed).toBe("number");

    const done = await waitFor<OutboundRecoveryTask>("retry recovery task to finish", async () => {
      const current = await relay.outbound.recoveryTasks.get(task.id);
      expect(current.id).toBe(task.id);
      return current.status === "completed" || current.status === "failed" ? current : undefined;
    });
    expect(done.status, done.error ?? "").toBe("completed");

    // The retry re-sent message 1: a second signed delivery with the same webhook-id.
    const deliveries = await waitForDeliveries(bin1, message1!.id, 2);
    for (const d of deliveries) expectSignedDelivery(d, message1!.id, endpoint1!.secret);
  }, 120_000);

  it("rotates the signing secret", async () => {
    expect(endpoint1, "endpoint 1 was not created").toBeDefined();
    const rotated = await relay.outbound.endpoints.rotateSecret(endpoint1!.id);
    expect(isWhsec(rotated), "rotated secret must be whsec_ + base64").toBe(true);
    expect(rotated !== endpoint1!.secret, "rotation must produce a new secret").toBe(true);

    const revealed = await relay.outbound.endpoints.revealSecret(endpoint1!.id);
    expect(revealed === rotated, "revealSecret must return the rotated secret").toBe(true);

    const after = await relay.outbound.endpoints.get(endpoint1!.id);
    expect(after.previous_secret_expires_at).toBeTruthy();
    expect(Date.parse(after.previous_secret_expires_at!)).toBeGreaterThan(Date.now());
  });
});
