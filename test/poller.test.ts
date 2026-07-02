import { describe, expect, it } from "vitest";
import { createClient } from "./helpers.js";

describe("WebhookPoller", () => {
  it("yields consumed webhooks across pages and stops on demand", async () => {
    let call = 0;
    const { relay, calls } = createClient((url) => {
      if (!url.includes("/v1/events")) return { json: {} };
      call++;
      if (call === 1) return { json: { logs: [{ id: "1" }, { id: "2" }], has_more: true } };
      if (call === 2) return { json: { logs: [{ id: "3" }], has_more: false } };
      return { json: { logs: [], has_more: false } };
    });

    const poller = relay.webhooks.poll({ bucket: "orders", intervalMs: 1 });
    const got: string[] = [];
    for await (const w of poller) {
      got.push(w.id);
      if (got.length === 3) poller.stop();
    }

    expect(got).toEqual(["1", "2", "3"]);
    // first poll carries the required bucket + a clamped default limit
    expect(calls[0].url).toContain("bucket=orders");
    expect(calls[0].url).toContain("limit=100");
  });

  it("passes output and max_age through and clamps the limit to 100", async () => {
    const { relay, calls } = createClient(() => ({
      json: { logs: [{ id: "x" }], has_more: false },
    }));
    const poller = relay.webhooks.poll({
      bucket: "orders",
      output: "out1",
      maxAge: "1h",
      limit: 5000,
      intervalMs: 1,
    });
    for await (const _webhook of poller) {
      break; // one webhook is enough to inspect the request
    }
    expect(calls[0].url).toContain("output=out1");
    expect(calls[0].url).toContain("max_age=1h");
    expect(calls[0].url).toContain("limit=100");
  });

  it("listen() invokes the callback for each webhook", async () => {
    let call = 0;
    const { relay } = createClient((url) => {
      if (!url.includes("/v1/events")) return { json: {} };
      call++;
      if (call === 1) return { json: { logs: [{ id: "a" }], has_more: false } };
      return { json: { logs: [], has_more: false } };
    });
    const poller = relay.webhooks.poll({ bucket: "orders", intervalMs: 1 });
    const seen: string[] = [];
    await poller.listen((w) => {
      seen.push(w.id);
      poller.stop();
    });
    expect(seen).toEqual(["a"]);
  });
});
