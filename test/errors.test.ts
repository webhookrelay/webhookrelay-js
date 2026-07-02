import { describe, expect, it } from "vitest";
import {
  WebhookRelayError,
  WebhookRelayAPIError,
  WebhookRelayConnectionError,
  WebhookRelayConfigError,
} from "../src/errors.js";

describe("WebhookRelayAPIError", () => {
  it("extracts the message from an { error } body", () => {
    const err = new WebhookRelayAPIError({
      status: 422,
      method: "POST",
      path: "/v1/buckets",
      body: { error: "name already taken" },
      requestId: "req-1",
    });
    expect(err.message).toContain("name already taken");
    expect(err.status).toBe(422);
    expect(err.requestId).toBe("req-1");
    expect(err).toBeInstanceOf(WebhookRelayError);
  });

  it("extracts the message from a plain-text body", () => {
    const err = new WebhookRelayAPIError({
      status: 400,
      method: "GET",
      path: "/x",
      body: "bad request",
    });
    expect(err.message).toContain("bad request");
  });

  it("classifies common statuses", () => {
    const make = (status: number) =>
      new WebhookRelayAPIError({ status, method: "GET", path: "/x", body: "" });
    expect(make(404).isNotFound).toBe(true);
    expect(make(401).isAuthError).toBe(true);
    expect(make(403).isAuthError).toBe(true);
    expect(make(429).isRateLimited).toBe(true);
    expect(make(500).isNotFound).toBe(false);
  });
});

describe("error hierarchy", () => {
  it("all SDK errors extend WebhookRelayError and preserve their name", () => {
    const conn = new WebhookRelayConnectionError("offline");
    const cfg = new WebhookRelayConfigError("no creds");
    expect(conn).toBeInstanceOf(WebhookRelayError);
    expect(cfg).toBeInstanceOf(WebhookRelayError);
    expect(conn.name).toBe("WebhookRelayConnectionError");
    expect(cfg.name).toBe("WebhookRelayConfigError");
  });

  it("keeps the underlying cause", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new WebhookRelayConnectionError("failed", { cause });
    expect((err as { cause?: unknown }).cause).toBe(cause);
  });
});
