import { describe, expect, it } from "vitest";
import { createClient } from "./helpers.js";

const base = "https://my.webhookrelay.com";

describe("buckets", () => {
  it("lists, creates, gets, updates and deletes", async () => {
    const { relay, calls } = createClient((url, method) => {
      if (url.endsWith("/v1/buckets") && method === "GET")
        return { json: [{ id: "b1", name: "orders" }] };
      if (url.endsWith("/v1/buckets") && method === "POST")
        return { json: { id: "b2", name: "new" } };
      return { json: { id: "b1", name: "orders" } };
    });

    expect(await relay.buckets.list()).toHaveLength(1);
    expect((await relay.buckets.create({ name: "new" })).id).toBe("b2");
    await relay.buckets.get("b1");
    await relay.buckets.update("b1", { description: "x" });
    await relay.buckets.delete("b1");

    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "GET /v1/buckets",
      "POST /v1/buckets",
      "GET /v1/buckets/b1",
      "PUT /v1/buckets/b1",
      "DELETE /v1/buckets/b1",
    ]);
    expect(calls[1].body).toEqual({ name: "new" });
  });

  it("findByName filters the list", async () => {
    const { relay } = createClient(() => ({
      json: [
        { id: "b1", name: "orders" },
        { id: "b2", name: "payments" },
      ],
    }));
    expect((await relay.buckets.findByName("payments"))?.id).toBe("b2");
    expect(await relay.buckets.findByName("missing")).toBeUndefined();
  });
});

describe("inputs", () => {
  it("creates, updates, deletes and builds an endpoint URL", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "in1" } }));
    const input = await relay.inputs.create("b1", { name: "public" });
    await relay.inputs.update("b1", "in1", { description: "x" });
    await relay.inputs.delete("b1", "in1");

    expect(relay.inputs.endpointUrl(input)).toBe(`${base}/v1/webhooks/in1`);
    expect(relay.inputs.endpointUrl("abc")).toBe(`${base}/v1/webhooks/abc`);
    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "POST /v1/buckets/b1/inputs",
      "PUT /v1/buckets/b1/inputs/in1",
      "DELETE /v1/buckets/b1/inputs/in1",
    ]);
  });

  it("lists inputs from the bucket payload", async () => {
    const { relay } = createClient(() => ({
      json: { id: "b1", inputs: [{ id: "in1" }, { id: "in2" }] },
    }));
    expect(await relay.inputs.list("b1")).toHaveLength(2);
  });
});

describe("outputs", () => {
  it("creates and manages rules", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "out1" } }));
    await relay.outputs.create("b1", { destination: "https://x" });
    await relay.outputs.setRules("b1", "out1", {
      match: { type: "value", value: "push" },
    });
    await relay.outputs.deleteRules("b1", "out1");
    await relay.outputs.delete("b1", "out1");

    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "POST /v1/buckets/b1/outputs",
      "PUT /v1/buckets/b1/outputs/out1/rules",
      "DELETE /v1/buckets/b1/outputs/out1/rules",
      "DELETE /v1/buckets/b1/outputs/out1",
    ]);
    expect(calls[0].body).toEqual({ destination: "https://x" });
    expect(calls[1].body).toEqual({ match: { type: "value", value: "push" } });
  });
});

describe("functions", () => {
  it("defaults the driver to js on create", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "fn1", driver: "js" } }));
    await relay.functions.create({ name: "f", payload: "function transform(r){return r}" });
    expect(calls[0].url).toContain("/v1/functions");
    expect(calls[0].body).toMatchObject({ driver: "js", name: "f" });
  });

  it("does not override an explicit driver", async () => {
    const { relay, calls } = createClient(() => ({ json: {} }));
    await relay.functions.create({ name: "f", payload: "-- lua", driver: "lua" });
    expect((calls[0].body as { driver: string }).driver).toBe("lua");
  });

  it("invokes, sets config and generates", async () => {
    const { relay, calls } = createClient((url) => {
      if (url.includes("functions-generate")) return { json: { code: "x", validation_ok: true } };
      return { json: {} };
    });
    await relay.functions.invoke("fn1", { request: { body: "{}" } });
    await relay.functions.setConfig("fn1", "K", "V");
    await relay.functions.deleteConfig("fn1", "K");
    const gen = await relay.functions.generate({ additional_info: "do a thing" });

    expect(gen.code).toBe("x");
    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "POST /v1/functions/fn1/invoke",
      "PUT /v1/functions/fn1/config",
      "DELETE /v1/functions/fn1/config/K",
      "POST /v1/functions-generate",
    ]);
    expect(calls[1].body).toEqual({ key: "K", value: "V" });
  });
});

describe("service connections", () => {
  it("manages connections and per-bucket managed outputs", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "sc1" } }));
    await relay.serviceConnections.list();
    await relay.serviceConnections.create({ name: "aws", service_type: "aws" });
    await relay.serviceConnections.createOutput("b1", {
      name: "sqs",
      service_connection_id: "sc1",
      service_connection_output_type: "aws_sqs",
    });
    await relay.serviceConnections.listOutputs("b1");

    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "GET /v1/service-connections",
      "POST /v1/service-connections",
      "POST /v1/buckets/b1/service-connection-outputs",
      "GET /v1/buckets/b1/service-connection-outputs",
    ]);
  });
});

describe("webhooks (logs)", () => {
  it("lists history with query params", async () => {
    const { relay, calls } = createClient(() => ({ json: { data: [], total: 0 } }));
    await relay.webhooks.list({ bucket: "orders", limit: 50, status: "sent" });
    expect(calls[0].url).toContain("bucket=orders");
    expect(calls[0].url).toContain("limit=50");
    expect(calls[0].url).toContain("status=sent");
  });

  it("gets and updates a single log", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "l1" } }));
    await relay.webhooks.get("l1");
    await relay.webhooks.update("l1", { status_code: 500 });
    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].body).toEqual({ status_code: 500 });
  });

  it("iterate() follows the pagination cursor", async () => {
    let call = 0;
    const { relay } = createClient(() => {
      call++;
      if (call === 1)
        return { json: { data: [{ id: "1" }, { id: "2" }], next_cursor: "c2" } };
      return { json: { data: [{ id: "3" }], next_cursor: "" } };
    });
    const ids: string[] = [];
    for await (const log of relay.webhooks.iterate({ bucket: "orders" })) {
      ids.push(log.id);
    }
    expect(ids).toEqual(["1", "2", "3"]);
  });
});

describe("remaining resource methods", () => {
  it("functions: list/get/update/delete/listConfig/logs", async () => {
    const { relay, calls } = createClient(() => ({ json: [] }));
    await relay.functions.list();
    await relay.functions.get("fn1");
    await relay.functions.update("fn1", { name: "x" });
    await relay.functions.listConfig("fn1");
    await relay.functions.logs("fn1");
    await relay.functions.delete("fn1");
    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "GET /v1/functions",
      "GET /v1/functions/fn1",
      "GET /v1/functions/fn1",
      "PUT /v1/functions/fn1",
      "GET /v1/functions/fn1",
      "GET /v1/functions/fn1/config",
      "GET /v1/functions/fn1/logs",
      "DELETE /v1/functions/fn1",
    ]);
  });

  it("outputs: update and list (from the bucket payload)", async () => {
    const { relay, calls } = createClient((url) =>
      url.endsWith("/v1/buckets/b1")
        ? { json: { id: "b1", outputs: [{ id: "o1" }] } }
        : { json: { id: "o1" } },
    );
    await relay.outputs.update("b1", "o1", { disabled: true });
    expect(await relay.outputs.list("b1")).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("/v1/buckets/b1/outputs/o1");
    expect(calls[0].body).toEqual({ disabled: true });
  });

  it("service connections: full CRUD + managed inputs/outputs", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "sc1" } }));
    await relay.serviceConnections.get("sc1");
    await relay.serviceConnections.update("sc1", { name: "renamed" });
    await relay.serviceConnections.delete("sc1");
    await relay.serviceConnections.listInputs("b1");
    await relay.serviceConnections.createInput("b1", { service_connection_id: "sc1" });
    await relay.serviceConnections.updateInput("b1", "i1", { name: "x" });
    await relay.serviceConnections.deleteInput("b1", "i1");
    await relay.serviceConnections.updateOutput("b1", "o1", { name: "y" });
    await relay.serviceConnections.deleteOutput("b1", "o1");

    expect(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`)).toEqual([
      "GET /v1/service-connections/sc1",
      "PUT /v1/service-connections/sc1",
      "DELETE /v1/service-connections/sc1",
      "GET /v1/buckets/b1/service-connection-inputs",
      "POST /v1/buckets/b1/service-connection-inputs",
      "PUT /v1/buckets/b1/service-connection-inputs/i1",
      "DELETE /v1/buckets/b1/service-connection-inputs/i1",
      "PUT /v1/buckets/b1/service-connection-outputs/o1",
      "DELETE /v1/buckets/b1/service-connection-outputs/o1",
    ]);
  });
});

describe("request() escape hatch", () => {
  it("issues an arbitrary request with auth", async () => {
    const { relay, calls } = createClient(() => ({ json: { requests: 1 } }));
    const res = await relay.request<{ requests: number }>("GET", "/v1/usage");
    expect(res.requests).toBe(1);
    expect(calls[0].headers.Authorization).toBe("Bearer sk-test");
  });
});
