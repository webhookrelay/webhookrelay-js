import { describe, expect, it } from "vitest";
import { createClient } from "./helpers.js";
import { onboardCustomer, publishInvoicePaid, reportFailingEndpoints } from "../examples/outbound.js";

const base = "https://my.webhookrelay.com";
const requests = (calls: { method: string; url: string }[]) =>
  calls.map((c) => `${c.method} ${c.url.replace(base, "")}`);

describe("outbound", () => {
  it("manages consumers and event types", async () => {
    const { relay, calls } = createClient((url, method) =>
      method === "GET" ? { json: [] } : { json: { id: "customer:42", name: "Acme", rate: 0 } },
    );

    await relay.outbound.consumers.list();
    await relay.outbound.consumers.upsert("customer:42", { name: "Acme" });
    await relay.outbound.consumers.delete("customer:42");
    await relay.outbound.eventTypes.upsert("invoice/paid", { description: "Paid", example: [1, 2] });
    await relay.outbound.eventTypes.delete("invoice/paid");

    expect(requests(calls)).toEqual([
      "GET /v1/outbound/consumers",
      "PUT /v1/outbound/consumers/customer%3A42",
      "DELETE /v1/outbound/consumers/customer%3A42",
      "PUT /v1/outbound/event-types/invoice%2Fpaid",
      "DELETE /v1/outbound/event-types/invoice%2Fpaid",
    ]);
    expect(calls[1]?.body).toEqual({ name: "Acme" });
    expect(calls[3]?.body).toEqual({ name: "invoice/paid", description: "Paid", example: [1, 2] });
  });

  it("creates endpoints with camelCase or snake_case params", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "endpoint-1", secret: "whsec_abc" } }));

    const endpoint = await relay.outbound.endpoints.create("customer_42", {
      url: "https://example.com/hook",
      eventTypes: ["*"],
      autoDisable: true,
      functionId: "fn-1",
    });
    await relay.outbound.endpoints.update("endpoint-1", { url: "https://example.com/v2", event_types: ["a"] });

    expect(endpoint.secret).toBe("whsec_abc");
    expect(calls[0]?.body).toEqual({
      url: "https://example.com/hook",
      event_types: ["*"],
      auto_disable: true,
      function_id: "fn-1",
    });
    expect(calls[1]?.body).toEqual({ url: "https://example.com/v2", event_types: ["a"] });
  });

  it("pauses, resumes and handles signing secrets", async () => {
    const { relay, calls } = createClient((url) =>
      url.includes("/secret/") ? { json: { secret: "whsec_new" } } : { json: { id: "endpoint-1", state: "paused" } },
    );

    expect((await relay.outbound.endpoints.pause("endpoint-1")).state).toBe("paused");
    await relay.outbound.endpoints.resume("endpoint-1");
    expect(await relay.outbound.endpoints.rotateSecret("endpoint-1")).toBe("whsec_new");
    expect(await relay.outbound.endpoints.revealSecret("endpoint-1")).toBe("whsec_new");

    expect(requests(calls)).toEqual([
      "POST /v1/outbound/endpoints/endpoint-1/pause",
      "POST /v1/outbound/endpoints/endpoint-1/resume",
      "POST /v1/outbound/endpoints/endpoint-1/secret/rotate",
      "POST /v1/outbound/endpoints/endpoint-1/secret/reveal",
    ]);
  });

  it("publishes with an idempotency key and lists messages", async () => {
    const { relay, calls } = createClient((url, method) =>
      method === "GET" ? { json: [] } : { status: 202, json: { id: "message-1", endpoint_ids: ["endpoint-1"] } },
    );

    const message = await relay.outbound.messages.publish(
      { consumer: "customer_42", eventType: "invoice.paid", eventId: "evt_1", payload: "plain string" },
      { idempotencyKey: "invoice-paid:inv_123" },
    );
    await relay.outbound.messages.publish({ consumer: "customer_42", event_type: "invoice.paid", payload: {} });
    await relay.outbound.messages.list({ consumer: "customer_42", eventType: "invoice.paid", limit: 10 });

    expect(message.id).toBe("message-1");
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("invoice-paid:inv_123");
    expect(calls[0]?.body).toEqual({
      consumer: "customer_42",
      event_type: "invoice.paid",
      event_id: "evt_1",
      payload: "plain string",
    });
    expect(calls[1]?.headers["Idempotency-Key"]).toBeUndefined();
    expect(calls[2]?.url).toBe(`${base}/v1/outbound/messages?consumer=customer_42&event_type=invoice.paid&limit=10`);
  });

  it("reads deliveries and starts recoveries", async () => {
    const { relay, calls } = createClient((url, method) =>
      method === "GET" && url.includes("/deliveries")
        ? { json: [{ id: "delivery-1", message_id: "message-1", status: "sent" }] }
        : { status: 202, json: { id: "task-1", status: "pending" } },
    );

    const deliveries = await relay.outbound.endpoints.deliveries("endpoint-1", { limit: 5 });
    await relay.outbound.endpoints.deliveries("endpoint-1", { status: "failed", event_type: "invoice.paid" });
    await relay.outbound.endpoints.retry("endpoint-1", "message-1");
    await relay.outbound.endpoints.recover("endpoint-1", { since: "2026-09-01T00:00:00Z" });
    await relay.outbound.endpoints.replayMissing("endpoint-1");
    await relay.outbound.recoveryTasks.get("task-1");

    expect(deliveries[0]?.message_id).toBe("message-1");
    expect(requests(calls)).toEqual([
      "GET /v1/outbound/endpoints/endpoint-1/deliveries?limit=5",
      "GET /v1/outbound/endpoints/endpoint-1/deliveries?status=failed&event_type=invoice.paid",
      "POST /v1/outbound/endpoints/endpoint-1/retry",
      "POST /v1/outbound/endpoints/endpoint-1/recover",
      "POST /v1/outbound/endpoints/endpoint-1/replay-missing",
      "GET /v1/outbound/recovery-tasks/task-1",
    ]);
    expect(calls[2]?.body).toEqual({ message_id: "message-1" });
    expect(calls[3]?.body).toEqual({ since: "2026-09-01T00:00:00Z" });
  });

  it("lists endpoints across consumers with filters and stats", async () => {
    const endpoint = {
      id: "endpoint-1",
      consumer: "customer_42",
      url: "https://example.com/hook",
      event_types: ["*"],
      rate: 0,
      timeout: 0,
      auto_disable: true,
      state: "failing",
      consecutive_failures: 7,
      failing_since: "2026-09-27T10:00:00Z",
      stats: { attempts: 12, failures: 7 },
    };
    const { relay, calls } = createClient(() => ({ json: [endpoint] }));

    const all = await relay.outbound.endpoints.listAll();
    const failing = await relay.outbound.endpoints.listAll({
      state: "failing",
      consumer: "customer:42",
      limit: 100,
      offset: 20,
    });
    const listed = await relay.outbound.endpoints.list("customer_42");

    expect(requests(calls)).toEqual([
      "GET /v1/outbound/endpoints",
      "GET /v1/outbound/endpoints?state=failing&consumer=customer%3A42&limit=100&offset=20",
      "GET /v1/outbound/consumers/customer_42/endpoints",
    ]);
    expect(all).toEqual([endpoint]);
    expect(failing[0]?.stats).toEqual({ attempts: 12, failures: 7 });
    expect(failing[0]?.failing_since).toBe("2026-09-27T10:00:00Z");
    expect(listed[0]?.stats?.failures).toBe(7);
  });

  it("reads outbound health", async () => {
    const body = {
      endpoints: { active: 3, failing: 1, paused: 0, disabled: 2 },
      stats: { attempts: 120, failures: 9 },
      since: "2026-09-27T12:00:00Z",
    };
    const { relay, calls } = createClient(() => ({ json: body }));

    const health = await relay.outbound.health();

    expect(requests(calls)).toEqual(["GET /v1/outbound/health"]);
    expect(health).toEqual(body);
    expect(health.endpoints.failing).toBe(1);
    expect(health.stats.failures).toBe(9);
  });

  it("runs the failing-endpoints example", async () => {
    const { relay, calls } = createClient((url) =>
      url.endsWith("/health")
        ? { json: { endpoints: { active: 1, failing: 1, paused: 0, disabled: 0 }, stats: { attempts: 4, failures: 3 }, since: "2026-09-27T12:00:00Z" } }
        : { json: [{ id: "endpoint-1", consumer: "customer_42", url: "https://customer.example/webhooks", failing_since: "2026-09-27T10:00:00Z", stats: { attempts: 4, failures: 3 } }] },
    );

    const report = await reportFailingEndpoints(relay);

    expect(requests(calls)).toEqual([
      "GET /v1/outbound/health",
      "GET /v1/outbound/endpoints?state=failing&limit=20",
    ]);
    expect(report).toEqual([
      { consumer: "customer_42", url: "https://customer.example/webhooks", failingSince: "2026-09-27T10:00:00Z", failures24h: 3 },
    ]);
  });

  it("runs the example that the dashboard shows", async () => {
    const { relay, calls } = createClient((url) =>
      url.endsWith("/endpoints")
        ? { status: 201, json: { id: "endpoint-1", secret: "whsec_abc" } }
        : { json: { id: "resource-1", endpoint_ids: ["endpoint-1"] } },
    );

    const endpoint = await onboardCustomer(relay, "https://customer.example/webhooks");
    const message = await publishInvoicePaid(relay);

    expect(endpoint.secret).toBe("whsec_abc");
    expect(message.endpoint_ids).toEqual(["endpoint-1"]);
    expect(requests(calls)).toEqual([
      "PUT /v1/outbound/event-types/invoice.paid",
      "PUT /v1/outbound/consumers/customer_42",
      "POST /v1/outbound/consumers/customer_42/endpoints",
      "POST /v1/outbound/messages",
    ]);
    expect(calls[2]?.body).toEqual({ url: "https://customer.example/webhooks", event_types: ["invoice.paid"] });
    expect(calls[3]?.headers["Idempotency-Key"]).toBe("invoice-paid:inv_123");
  });
});
