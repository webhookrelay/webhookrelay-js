import { describe, expect, it } from "vitest";
import { createClient } from "./helpers.js";
import { onboardCustomer, publishInvoicePaid } from "../examples/outbound.js";

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
    await relay.outbound.endpoints.retry("endpoint-1", "message-1");
    await relay.outbound.endpoints.recover("endpoint-1", { since: "2026-09-01T00:00:00Z" });
    await relay.outbound.endpoints.replayMissing("endpoint-1");
    await relay.outbound.recoveryTasks.get("task-1");

    expect(deliveries[0]?.message_id).toBe("message-1");
    expect(requests(calls)).toEqual([
      "GET /v1/outbound/endpoints/endpoint-1/deliveries?limit=5",
      "POST /v1/outbound/endpoints/endpoint-1/retry",
      "POST /v1/outbound/endpoints/endpoint-1/recover",
      "POST /v1/outbound/endpoints/endpoint-1/replay-missing",
      "GET /v1/outbound/recovery-tasks/task-1",
    ]);
    expect(calls[1]?.body).toEqual({ message_id: "message-1" });
    expect(calls[2]?.body).toEqual({ since: "2026-09-01T00:00:00Z" });
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
