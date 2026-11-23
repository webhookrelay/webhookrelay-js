import { describe, expect, it } from "vitest";
import { createClient } from "./helpers.js";
import { OUTBOUND_ENVIRONMENT_HEADER, WebhookRelayConfigError } from "../src/index.js";
import { ensureEnvironment, publishInTest } from "../examples/outbound-environments.js";

const base = "https://my.webhookrelay.com";
const requests = (calls: { method: string; url: string }[]) =>
  calls.map((c) => `${c.method} ${c.url.replace(base, "")}`);
const environmentOf = (call: { headers: Record<string, string> } | undefined) =>
  call?.headers[OUTBOUND_ENVIRONMENT_HEADER];

describe("outbound environments", () => {
  it("sends no environment header by default", async () => {
    const { relay, calls } = createClient(() => ({ json: [] }));

    await relay.outbound.consumers.list();

    expect(OUTBOUND_ENVIRONMENT_HEADER).toBe("X-Outbound-Environment");
    expect(environmentOf(calls[0])).toBeUndefined();
  });

  it("sends the client's environment on every outbound call, generated or direct", async () => {
    const { relay, calls } = createClient(() => ({ json: {} }), { outboundEnvironment: "test" });

    await relay.outbound.consumers.list();
    await relay.outbound.messages.publish({ consumer: "c", eventType: "e", payload: {} }, { idempotencyKey: "k" });
    await relay.outbound.endpoints.sendTest("ep-1");
    await relay.outbound.portalSessions.create("c");
    await relay.outbound.endpoints.patch("ep-1", { description: "x" });

    expect(calls.map(environmentOf)).toEqual(["test", "test", "test", "test", "test", "test"]);
    expect(calls[4]?.headers.Authorization).toMatch(/^Bearer /);
    expect(calls[1]?.headers["Idempotency-Key"]).toBe("k");
  });

  it("keeps the environment off the rest of the API", async () => {
    const { relay, calls } = createClient(() => ({ json: [] }), { outboundEnvironment: "test" });

    await relay.buckets.list();
    await relay.request("GET", "/v1/usage");

    expect(calls.map(environmentOf)).toEqual([undefined, undefined]);
  });

  it("derives a client bound to another environment without changing the original", async () => {
    const { relay, calls } = createClient(() => ({ json: [] }), { outboundEnvironment: "test" });

    const live = relay.outbound.withEnvironment("live");
    await live.consumers.list();
    await live.withEnvironment("default").eventTypes.list();
    await relay.outbound.consumers.list();

    expect(calls.map(environmentOf)).toEqual(["live", "default", "test"]);
    expect(calls[0]?.headers.Authorization).toBe("Bearer sk-test");
  });

  it("refuses an empty environment name", () => {
    const { relay } = createClient(() => ({ json: [] }));
    expect(() => relay.outbound.withEnvironment(" ")).toThrow(WebhookRelayConfigError);
  });

  it("treats a blank client environment as the default", async () => {
    const { relay, calls } = createClient(() => ({ json: [] }), { outboundEnvironment: "  " });
    await relay.outbound.consumers.list();
    expect(environmentOf(calls[0])).toBeUndefined();
  });

  it("lists, creates and deletes environments", async () => {
    const { relay, calls } = createClient((_url, method) => {
      if (method === "GET") return { json: [{ name: "default", default: true }, { name: "test", default: false }] };
      if (method === "POST") return { status: 201, json: { name: "qa", description: "QA", default: false } };
      return { json: { deleted: true } };
    });

    const all = await relay.outbound.environments.list();
    const created = await relay.outbound.environments.create({ name: "qa", description: "QA" });
    await relay.outbound.environments.delete("qa env");

    expect(requests(calls)).toEqual([
      "GET /v1/outbound/environments",
      "POST /v1/outbound/environments",
      "DELETE /v1/outbound/environments/qa%20env",
    ]);
    expect(calls[1]?.body).toEqual({ name: "qa", description: "QA" });
    expect(all.map((e) => e.name)).toEqual(["default", "test"]);
    expect(created.name).toBe("qa");
  });

  it("runs the environments example, reusing an existing environment", async () => {
    const { relay, calls } = createClient((url, method) => {
      if (url.endsWith("/environments") && method === "POST") return { status: 409, json: { error: "environment test already exists" } };
      if (url.endsWith("/environments")) return { json: [{ name: "default", default: true }, { name: "test", default: false }] };
      if (url.endsWith("/messages")) return { json: { id: "msg-1", environment: "test", endpoint_ids: [] } };
      return { json: { id: "customer_42", name: "Acme (staging)", rate: 0 } };
    });

    const message = await publishInTest(relay);

    expect(requests(calls)).toEqual([
      "POST /v1/outbound/environments",
      "GET /v1/outbound/environments",
      "PUT /v1/outbound/consumers/customer_42",
      "POST /v1/outbound/messages",
    ]);
    expect(calls.map(environmentOf)).toEqual([undefined, undefined, "test", "test"]);
    expect(message.environment).toBe("test");
  });

  it("rethrows other errors from ensureEnvironment", async () => {
    const { relay } = createClient(() => ({ status: 400, json: { error: "invalid environment name" } }));
    await expect(ensureEnvironment(relay, "Bad Name", "")).rejects.toMatchObject({ status: 400 });
  });
});
