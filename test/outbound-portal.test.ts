import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "./helpers.js";
import { isAllowedPortalUrl, WebhookRelayPortal } from "../src/react.js";
import { allowSiteToEmbed, createPortalLink, CustomerWebhooks, signOut } from "../examples/outbound-portal.js";

const base = "https://my.webhookrelay.com";
const requests = (calls: { method: string; url: string }[]) =>
  calls.map((c) => `${c.method} ${c.url.replace(base, "")}`);
const portalUrl = "https://my.webhookrelay.com/portal/p-1#token=wrpt_abc";

describe("outbound portal", () => {
  it("creates and expires portal sessions", async () => {
    const { relay, calls } = createClient((url) =>
      url.endsWith("/expire")
        ? { json: { ended: 2 } }
        : { status: 201, json: { url: portalUrl, expires_at: "2026-11-24T00:00:00Z", token_expires_at: "2026-11-23T00:15:00Z" } },
    );

    const link = await relay.outbound.portalSessions.create("customer/42", {
      capabilities: "read",
      ttl: 3600,
      next: "endpoints/new",
      sessionId: "user-1",
    });
    const { ended } = await relay.outbound.portalSessions.expire("customer/42");

    expect(requests(calls)).toEqual([
      "POST /v1/outbound/consumers/customer%2F42/portal-sessions",
      "POST /v1/outbound/consumers/customer%2F42/portal-sessions/expire",
    ]);
    expect(calls[0]?.body).toEqual({ capabilities: "read", ttl: 3600, next: "endpoints/new", session_id: "user-1" });
    expect(calls[1]?.body).toEqual({});
    expect(link).toEqual({ url: portalUrl, expires_at: "2026-11-24T00:00:00Z", token_expires_at: "2026-11-23T00:15:00Z" });
    expect(ended).toBe(2);
  });

  it("runs the portal example's server side", async () => {
    const { relay, calls } = createClient((url) =>
      url.endsWith("/expire")
        ? { json: { ended: 1 } }
        : { status: 201, json: { url: portalUrl, expires_at: "2026-11-24T00:00:00Z", token_expires_at: "x" } },
    );

    expect(await createPortalLink(relay, "customer_42", "7")).toEqual({ url: portalUrl, expiresAt: "2026-11-24T00:00:00Z" });
    expect(await signOut(relay, "customer_42", "7")).toBe(1);
    expect(calls[0]?.body).toEqual({ capabilities: "manage", session_id: "user-7" });
    expect(calls[1]?.body).toEqual({ session_id: "user-7" });
  });

  it("adds the site's origin to the portal settings once", async () => {
    const settings = {
      portal_id: "p-1",
      name: "Acme",
      theme: "auto",
      allowed_origins: ["https://old.acme.example"],
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
    };
    const { relay, calls } = createClient((_url, method, call) =>
      method === "GET" ? { json: settings } : { json: { ...settings, ...(call.body as object) } },
    );

    await allowSiteToEmbed(relay, "https://app.acme.example");
    await allowSiteToEmbed(relay, "https://old.acme.example");

    expect(requests(calls)).toEqual([
      "GET /v1/outbound/portal-settings",
      "PUT /v1/outbound/portal-settings",
      "GET /v1/outbound/portal-settings",
    ]);
    expect(calls[1]?.body).toEqual({
      name: "Acme",
      theme: "auto",
      allowed_origins: ["https://old.acme.example", "https://app.acme.example"],
    });
  });

  it("renders the portal iframe with its defaults", () => {
    const html = renderToStaticMarkup(createElement(WebhookRelayPortal, { url: portalUrl }));

    expect(html).toBe(
      `<iframe src="${portalUrl}" title="Webhooks" allow="clipboard-write" referrerPolicy="no-referrer" ` +
        `style="border:0;display:block;width:100%;height:600px"></iframe>`,
    );
  });

  it("refuses portal URLs that are not https", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const url of [
        "javascript:alert(document.cookie)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "http://my.webhookrelay.com/portal/p-1#token=wrpt_abc",
        "//my.webhookrelay.com/portal/p-1",
        "not a url",
        "",
      ]) {
        expect(renderToStaticMarkup(createElement(WebhookRelayPortal, { url })), url).toBe("");
      }
      expect(error).toHaveBeenCalledTimes(7);
      // The refused URL may carry a token: it is never logged.
      expect(error.mock.calls.flat().join(" ")).not.toContain("wrpt_abc");
    } finally {
      error.mockRestore();
    }
  });

  it("frames https portal URLs and plain http only on localhost", () => {
    expect(isAllowedPortalUrl(portalUrl)).toBe(true);
    expect(isAllowedPortalUrl("http://localhost:8080/portal/p-1#token=x")).toBe(true);
    expect(isAllowedPortalUrl("http://127.0.0.1:8080/portal/p-1")).toBe(true);
    expect(isAllowedPortalUrl("http://localhost.evil.example/portal")).toBe(false);
    expect(isAllowedPortalUrl("ftp://my.webhookrelay.com/portal")).toBe(false);
  });

  it("keeps the no-referrer policy when frame props try to override it", () => {
    const html = renderToStaticMarkup(
      createElement(WebhookRelayPortal, { url: portalUrl, referrerPolicy: "unsafe-url" }),
    );
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("unsafe-url");
  });

  it("passes size, class, style and frame props through", () => {
    const html = renderToStaticMarkup(
      createElement(WebhookRelayPortal, {
        url: portalUrl,
        title: "Your webhooks",
        height: "80vh",
        width: 900,
        className: "portal",
        style: { borderRadius: 8 },
        allow: "clipboard-write; fullscreen",
        id: "webhooks",
      }),
    );

    expect(html).toContain('title="Your webhooks"');
    expect(html).toContain('class="portal"');
    expect(html).toContain('id="webhooks"');
    expect(html).toContain('allow="clipboard-write; fullscreen"');
    expect(html).toContain('style="border:0;display:block;width:900px;height:80vh;border-radius:8px"');
  });

  it("renders the portal example's component", () => {
    const html = renderToStaticMarkup(createElement(CustomerWebhooks, { portalUrl }));
    expect(html).toContain("<h2>Webhooks</h2>");
    expect(html).toContain(`src="${portalUrl}"`);
    expect(html).toContain("height:720px");
  });

  it("keeps React out of the core SDK", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const src = new URL("../src/", import.meta.url);
    const files = (await readdir(src, { recursive: true })).filter(
      (f) => /\.tsx?$/.test(f) && f !== "react.tsx",
    );
    expect(files).toContain("index.ts");
    for (const file of files) {
      const text = await readFile(new URL(file, src), "utf8");
      expect(text, file).not.toMatch(/from ["']react(-dom)?(\/|["'])/);
    }
  });
});
