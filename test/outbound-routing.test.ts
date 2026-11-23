import { describe, expect, it } from "vitest";
import { createClient } from "./helpers.js";
import {
  createFilteredEndpoint,
  includeVoidedInvoices,
  publishToProject,
  sendTestEvent,
} from "../examples/outbound-routing.js";
import { createQueueEndpoint } from "../examples/outbound-cloud.js";

const base = "https://my.webhookrelay.com";
const requests = (calls: { method: string; url: string }[]) =>
  calls.map((c) => `${c.method} ${c.url.replace(base, "")}`);

describe("outbound routing", () => {
  it("creates an endpoint with channels and a filter", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "ep-1", secret: "whsec_x" } }));

    await createFilteredEndpoint(relay, "https://customer.example/hook");

    expect(requests(calls)).toEqual([
      "PUT /v1/outbound/event-types/invoice.paid",
      "PUT /v1/outbound/consumers/customer_42",
      "POST /v1/outbound/consumers/customer_42/endpoints",
    ]);
    expect(calls[2]?.body).toEqual({
      url: "https://customer.example/hook",
      event_types: ["invoice.paid"],
      channels: ["project-123"],
      filter: { status: { $in: ["paid", "refunded"] }, amount: { $gte: 100 } },
    });
  });

  it("publishes with channels and reads them back", async () => {
    const { relay, calls } = createClient(() => ({
      json: {
        id: "msg-1",
        consumer: "customer_42",
        environment: "default",
        event_type: "invoice.paid",
        channels: ["project-123"],
        endpoint_ids: ["ep-1"],
      },
    }));

    const message = await publishToProject(relay);

    expect(requests(calls)).toEqual(["POST /v1/outbound/messages"]);
    expect(calls[0]?.headers["Idempotency-Key"]).toBe("invoice-paid:inv_123");
    expect(calls[0]?.body).toEqual({
      consumer: "customer_42",
      event_type: "invoice.paid",
      channels: ["project-123"],
      payload: { invoice_id: "inv_123", status: "paid", amount: 4900 },
    });
    expect(message.channels).toEqual(["project-123"]);
    expect(message.environment).toBe("default");
  });

  it("sends a test event with an idempotency key", async () => {
    const { relay, calls } = createClient(() => ({
      json: { id: "msg-t", consumer: "customer_42", event_type: "invoice.paid", endpoint_ids: ["ep/1"], test: true },
    }));

    const receipt = await sendTestEvent(relay, "ep/1");
    await relay.outbound.endpoints.sendTest("ep/1", {}, { idempotencyKey: "test-1" });

    expect(requests(calls)).toEqual([
      "POST /v1/outbound/endpoints/ep%2F1/test",
      "POST /v1/outbound/endpoints/ep%2F1/test",
    ]);
    expect(calls[0]?.body).toEqual({
      event_type: "invoice.paid",
      payload: { invoice_id: "inv_test", status: "paid", amount: 250 },
    });
    expect(calls[0]?.headers["Idempotency-Key"]).toBeUndefined();
    expect(calls[1]?.body).toEqual({});
    expect(calls[1]?.headers["Idempotency-Key"]).toBe("test-1");
    expect(receipt.test).toBe(true);
  });

  it("update replaces the configuration, filter and channels included", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "ep-1" } }));

    await relay.outbound.endpoints.update("ep-1", { url: "https://customer.example/v2", eventTypes: ["*"] });

    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toEqual({ url: "https://customer.example/v2", event_types: ["*"] });
  });

  it("patch keeps the endpoint's other settings and drops server-owned fields", async () => {
    const current = {
      id: "ep-1",
      consumer: "customer_42",
      environment: "default",
      type: "webhook",
      url: "https://customer.example/hook",
      description: "Billing",
      event_types: ["invoice.paid"],
      channels: ["project-123"],
      filter: { status: "paid" },
      headers: { "X-Team": "billing" },
      rate: 5,
      timeout: 0,
      auto_disable: true,
      state: "failing",
      consecutive_failures: 3,
      failing_since: "2026-11-01T00:00:00Z",
      stats: { attempts: 10, failures: 3 },
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    };
    const { relay, calls } = createClient(() => ({ json: current }));

    await includeVoidedInvoices(relay, "ep-1");

    expect(requests(calls)).toEqual(["GET /v1/outbound/endpoints/ep-1", "PUT /v1/outbound/endpoints/ep-1"]);
    expect(calls[1]?.body).toEqual({
      type: "webhook",
      url: "https://customer.example/hook",
      description: "Billing",
      event_types: ["invoice.paid"],
      channels: ["project-123"],
      filter: {
        $or: [
          { status: { $in: ["paid", "refunded"] }, amount: { $gte: 100 } },
          { status: "void" },
        ],
      },
      headers: { "X-Team": "billing" },
      rate: 5,
      timeout: 0,
      auto_disable: true,
    });
  });

  it("patch normalizes camelCase fields and can clear channels", async () => {
    const current = { id: "ep-1", url: "https://a.example", event_types: ["a"], channels: ["x"], state: "active" };
    const { relay, calls } = createClient(() => ({ json: current }));

    await relay.outbound.endpoints.patch("ep-1", { eventTypes: ["b"], channels: [] });

    expect(calls[1]?.body).toEqual({ url: "https://a.example", event_types: ["b"], channels: [] });
  });

  it("creates a cloud endpoint with write-only credentials", async () => {
    const { relay, calls } = createClient((_url, _method, call) =>
      call.url.endsWith("/endpoints")
        ? {
            json: {
              id: "ep-sqs",
              type: "aws_sqs",
              url: "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
              destination: { aws_sqs: { queue_url: "https://sqs.eu-west-1.amazonaws.com/123456789012/orders", region: "eu-west-1" } },
              credentials_identity: "AKIAEXAMPLE",
              secret: "whsec_x",
            },
          }
        : { json: { id: "customer_42", name: "Acme", rate: 0 } },
    );

    const endpoint = await createQueueEndpoint(relay, {
      queueURL: "https://sqs.eu-west-1.amazonaws.com/123456789012/orders",
      region: "eu-west-1",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "not-a-real-secret",
    });

    expect(requests(calls)).toEqual([
      "PUT /v1/outbound/consumers/customer_42",
      "POST /v1/outbound/consumers/customer_42/endpoints",
    ]);
    expect(calls[1]?.body).toEqual({
      type: "aws_sqs",
      destination: { aws_sqs: { queue_url: "https://sqs.eu-west-1.amazonaws.com/123456789012/orders", region: "eu-west-1" } },
      credentials: { aws: { access_key_id: "AKIAEXAMPLE", secret_access_key: "not-a-real-secret" } },
      event_types: ["invoice.paid"],
    });
    expect(endpoint.credentials_identity).toBe("AKIAEXAMPLE");
  });
});
