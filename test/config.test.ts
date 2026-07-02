import { describe, expect, it } from "vitest";
import { resolveConfig, DEFAULT_BASE_URL } from "../src/config.js";
import { WebhookRelayConfigError } from "../src/errors.js";

describe("resolveConfig", () => {
  it("uses Bearer auth for an apiKey", () => {
    const c = resolveConfig({ apiKey: "sk-test-123" });
    expect(c.authHeader).toBe("Bearer sk-test-123");
    expect(c.socketAuth).toEqual({ key: "whr", secret: "sk-test-123" });
    expect(c.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("treats an sk- secret as a bearer key even when passed as { key, secret }", () => {
    const c = resolveConfig({ key: "whr", secret: "sk-abc" });
    expect(c.authHeader).toBe("Bearer sk-abc");
    expect(c.socketAuth).toEqual({ key: "whr", secret: "sk-abc" });
  });

  it("uses HTTP Basic auth for a classic key/secret pair", () => {
    const c = resolveConfig({ key: "my-key", secret: "my-secret" });
    const expected = "Basic " + Buffer.from("my-key:my-secret").toString("base64");
    expect(c.authHeader).toBe(expected);
    expect(c.socketAuth).toEqual({ key: "my-key", secret: "my-secret" });
  });

  it("strips a trailing slash from a custom baseUrl", () => {
    const c = resolveConfig({ apiKey: "sk-x", baseUrl: "https://relay.example.com/" });
    expect(c.baseUrl).toBe("https://relay.example.com");
  });

  it("throws a config error when no credentials are provided", () => {
    // Ensure env fallbacks don't leak in from the host running the tests.
    const saved = {
      RELAY_API_KEY: process.env.RELAY_API_KEY,
      RELAY_KEY: process.env.RELAY_KEY,
      RELAY_SECRET: process.env.RELAY_SECRET,
    };
    delete process.env.RELAY_API_KEY;
    delete process.env.RELAY_KEY;
    delete process.env.RELAY_SECRET;
    try {
      expect(() => resolveConfig({})).toThrow(WebhookRelayConfigError);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it("falls back to RELAY_API_KEY from the environment", () => {
    const saved = process.env.RELAY_API_KEY;
    process.env.RELAY_API_KEY = "sk-from-env";
    try {
      const c = resolveConfig({});
      expect(c.authHeader).toBe("Bearer sk-from-env");
    } finally {
      if (saved === undefined) delete process.env.RELAY_API_KEY;
      else process.env.RELAY_API_KEY = saved;
    }
  });

  it("sets a default timeout and a branded user-agent", () => {
    const c = resolveConfig({ apiKey: "sk-x" });
    expect(c.timeoutMs).toBe(30_000);
    expect(c.userAgent).toContain("webhookrelay-sdk-js");
  });
});
