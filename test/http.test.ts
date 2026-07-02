import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { HttpClient } from "../src/http.js";
import {
  WebhookRelayAPIError,
  WebhookRelayConnectionError,
} from "../src/errors.js";
import { createMockFetch } from "./helpers.js";

function client(responder: Parameters<typeof createMockFetch>[0], extra = {}) {
  const { fetchImpl, calls } = createMockFetch(responder);
  const http = new HttpClient(
    resolveConfig({ apiKey: "sk-test", fetch: fetchImpl, ...extra }),
  );
  return { http, calls };
}

describe("HttpClient", () => {
  it("builds the URL with query params and sends auth + accept headers", async () => {
    const { http, calls } = client(() => ({ json: { ok: true } }));
    await http.get("/v1/logs", { query: { bucket: "b", limit: 5, skip: undefined } });

    expect(calls[0].url).toBe("https://my.webhookrelay.com/v1/logs?bucket=b&limit=5");
    expect(calls[0].headers.Authorization).toBe("Bearer sk-test");
    expect(calls[0].headers.Accept).toBe("application/json");
    expect(calls[0].headers["User-Agent"]).toContain("webhookrelay-sdk-js");
  });

  it("serializes a JSON body and sets Content-Type on writes", async () => {
    const { http, calls } = client(() => ({ json: { id: "1" } }));
    const res = await http.post<{ id: string }>("/v1/buckets", {
      body: { name: "orders" },
    });
    expect(res).toEqual({ id: "1" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toEqual({ name: "orders" });
  });

  it("maps non-2xx responses to WebhookRelayAPIError", async () => {
    const { http } = client(() => ({
      status: 404,
      json: { error: "not found" },
      headers: { "Request-Id": "abc" },
    }));
    await expect(http.get("/v1/buckets/x")).rejects.toMatchObject({
      name: "WebhookRelayAPIError",
      status: 404,
    });
    // and it carries the request id
    try {
      await http.get("/v1/buckets/x");
    } catch (e) {
      expect(e).toBeInstanceOf(WebhookRelayAPIError);
      expect((e as WebhookRelayAPIError).requestId).toBe("abc");
    }
  });

  it("wraps network failures in WebhookRelayConnectionError", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const http = new HttpClient(resolveConfig({ apiKey: "sk-x", fetch: fetchImpl }));
    await expect(http.get("/v1/buckets")).rejects.toBeInstanceOf(
      WebhookRelayConnectionError,
    );
  });

  it("aborts and raises a connection error when the request times out", async () => {
    const fetchImpl = ((_url: unknown, init: RequestInit = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;
    const http = new HttpClient(
      resolveConfig({ apiKey: "sk-x", fetch: fetchImpl, timeoutMs: 10 }),
    );
    await expect(http.get("/v1/buckets")).rejects.toBeInstanceOf(
      WebhookRelayConnectionError,
    );
  });

  it("returns undefined for an empty 200 body", async () => {
    const { http } = client(() => ({ status: 200, text: "" }));
    await expect(http.delete("/v1/buckets/x")).resolves.toBeUndefined();
  });
});
