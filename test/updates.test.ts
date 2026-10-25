import { describe, expect, it } from "vitest";
import { WebhookRelayAPIError } from "../src/index.js";
import { createClient } from "./helpers.js";

const base = "https://my.webhookrelay.com";

const storedBucket = {
  id: "b1",
  name: "orders",
  description: "old",
  account_id: "acc",
  stream: true,
  ephemeral: false,
  static_ip: false,
  large_webhooks: false,
  suspended: false,
  workspace_id: "ws1",
  cron_id: null,
  auth: { id: "a1", type: "token", token: "t0k3n", created_at: 1, updated_at: 1 },
  inputs: [{ id: "in1" }],
  outputs: [{ id: "out1" }],
  service_connection_inputs: [],
  service_connection_outputs: [],
  created_at: 1,
  updated_at: 2,
};

function bucketClient(stored: object = storedBucket) {
  return createClient((url, method, call) => {
    if (method === "PUT") return { json: { ...stored, ...(call.body as object) } };
    return { json: stored };
  });
}

describe("buckets.update (partial over a full-replace PUT)", () => {
  it("fetches the bucket and sends its editable fields with the change", async () => {
    const { relay, calls } = bucketClient();
    const updated = await relay.buckets.update("b1", { description: "new" });

    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "GET /v1/buckets/b1",
      "PUT /v1/buckets/b1",
    ]);
    expect(calls[1]!.body).toEqual({
      name: "orders",
      description: "new",
      stream: true,
      ephemeral: false,
      static_ip: false,
      large_webhooks: false,
      auth: { type: "token", token: "t0k3n" },
    });
    expect(updated.description).toBe("new");
  });

  it("never sends workspace_id unless the caller passed it", async () => {
    const { relay, calls } = bucketClient();
    await relay.buckets.update("b1", { name: "renamed" });
    const body = calls[1]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("workspace_id");
    expect(body.name).toBe("renamed");
    // Read-only and nested fields from the GET are not echoed back.
    for (const key of ["id", "account_id", "suspended", "cron_id", "inputs", "outputs", "created_at"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("sends workspace_id when given, including null to ungroup", async () => {
    const { relay, calls } = bucketClient();
    await relay.buckets.update("b1", { workspace_id: "ws2" });
    await relay.buckets.update("b1", { workspaceId: null });
    expect((calls[1]!.body as Record<string, unknown>).workspace_id).toBe("ws2");
    expect(calls[3]!.body as Record<string, unknown>).toHaveProperty("workspace_id", null);
  });

  it("merges auth field by field and accepts camelCase aliases", async () => {
    const { relay, calls } = bucketClient();
    await relay.buckets.update("b1", {
      auth: { token: "rotated" },
      staticIp: true,
      largeWebhooks: true,
    });
    expect(calls[1]!.body).toMatchObject({
      name: "orders",
      static_ip: true,
      large_webhooks: true,
      auth: { type: "token", token: "rotated" },
    });
    expect(calls[1]!.body).not.toHaveProperty("staticIp");
  });

  it("ignores undefined values and lets an empty string clear a field", async () => {
    const { relay, calls } = bucketClient();
    await relay.buckets.update("b1", { description: undefined, stream: false });
    expect(calls[1]!.body).toMatchObject({ description: "old", stream: false });
    await relay.buckets.update("b1", { description: "" });
    expect(calls[3]!.body).toMatchObject({ description: "" });
  });

  it("omits auth when the bucket has none and none is given", async () => {
    const { relay, calls } = bucketClient({ id: "b1", name: "bare" });
    await relay.buckets.update("b1", { description: "d" });
    expect(calls[1]!.body).toEqual({ name: "bare", description: "d" });
  });

  it("propagates a failing GET without sending the PUT", async () => {
    const { relay, calls } = createClient(() => ({ status: 404, text: "Not Found" }));
    await expect(relay.buckets.update("nope", { description: "x" })).rejects.toBeInstanceOf(
      WebhookRelayAPIError,
    );
    expect(calls).toHaveLength(1);
  });

  it("create normalizes camelCase bucket params", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "b2", name: "n" } }));
    await relay.buckets.create({ name: "n", staticIp: true });
    expect(calls[0]!.body).toEqual({ name: "n", static_ip: true });
  });
});

describe("outputs.update (partial over a full-replace PUT)", () => {
  const output = {
    id: "o1",
    bucket_id: "b1",
    name: "prod",
    destination: "https://example.com/hook",
    function_id: "fn1",
    headers: { "X-Key": ["v"] },
    internal: false,
    tls_verification: true,
    rules: { match: { type: "value", value: "x" } },
    cron_id: null,
    created_by: "u1",
    created_at: 1,
    updated_at: 2,
  };

  it("keeps the destination and other fields, and leaves rules alone", async () => {
    const { relay, calls } = createClient((url, method) =>
      method === "GET" ? { json: { id: "b1", outputs: [output] } } : { json: output },
    );
    await relay.outputs.update("b1", "o1", { description: "d", tlsVerification: false });
    expect(calls[0]!.url).toBe(`${base}/v1/buckets/b1`);
    expect(calls[1]!.body).toEqual({
      name: "prod",
      destination: "https://example.com/hook",
      function_id: "fn1",
      headers: { "X-Key": ["v"] },
      internal: false,
      tls_verification: false,
      description: "d",
    });
  });

  it("throws a 404 API error when the output is not on the bucket", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "b1", outputs: [] } }));
    const err = await relay.outputs.update("b1", "missing", { disabled: true }).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookRelayAPIError);
    expect((err as WebhookRelayAPIError).status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});

describe("functions.update (partial over a full-replace PUT)", () => {
  it("keeps the source when only the name changes", async () => {
    const fn = { id: "fn1", name: "old", driver: "js", payload: "function t(r){return r}" };
    const { relay, calls } = createClient(() => ({ json: fn }));
    await relay.functions.update("fn1", { name: "new" });
    expect(calls[1]!.method).toBe("PUT");
    expect(calls[1]!.body).toEqual({ name: "new", driver: "js", payload: fn.payload });
  });

  it("skips the GET when name, driver and payload are all given", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "fn1" } }));
    await relay.functions.update("fn1", { name: "n", driver: "lua", payload: "x" });
    expect(calls[0]!.method).toBe("PUT");
  });
});

describe("serviceConnections update helpers", () => {
  it("update fills in the current name when omitted", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "sc1", name: "prod-aws" } }));
    await relay.serviceConnections.update("sc1", {
      awsServiceConnection: { access_key_id: "AK", secret_access_key: "SK" },
    });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[1]!.body).toEqual({
      name: "prod-aws",
      aws_service_connection: { access_key_id: "AK", secret_access_key: "SK" },
    });
  });

  it("update skips the GET when a name is given", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "sc1" } }));
    await relay.serviceConnections.update("sc1", { name: "renamed" });
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
  });

  it("updateInput / updateOutput merge over the current managed resource", async () => {
    const input = {
      id: "i1",
      bucket_id: "b1",
      name: "queue",
      service_connection_id: "sc1",
      service_connection_input_type: "aws_sqs",
      aws_sqs_input: { queue_url: "https://sqs/q" },
      status: "running",
      error: "",
      created_at: 1,
    };
    const { relay, calls } = createClient((url, method) => {
      if (method === "GET") return { json: [input] };
      return { json: input };
    });
    await relay.serviceConnections.updateInput("b1", "i1", { functionId: "fn1" } as never);
    expect(calls[1]!.body).toEqual({
      name: "queue",
      service_connection_id: "sc1",
      service_connection_input_type: "aws_sqs",
      aws_sqs_input: { queue_url: "https://sqs/q" },
      function_id: "fn1",
    });

    const err = await relay.serviceConnections
      .updateOutput("b1", "missing", { name: "x" })
      .catch((e) => e);
    expect((err as WebhookRelayAPIError).status).toBe(404);
  });
});
