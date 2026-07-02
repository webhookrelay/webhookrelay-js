import { afterAll, describe, expect, it } from "vitest";
import {
  WebhookRelay,
  configure,
  events,
  subscribe,
  type Bucket,
  type Input,
  type WebhookEvent,
  type WebhookLog,
} from "../../src/index.js";

const hasCredentials =
  Boolean(process.env.RELAY_API_KEY) ||
  (Boolean(process.env.RELAY_KEY) && Boolean(process.env.RELAY_SECRET));

const describeLive = hasCredentials ? describe : describe.skip;
const createdBucketIds = new Set<string>();
const createdFunctionIds = new Set<string>();

function bucketName(suffix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `whr-js-sdk-${suffix}-${Date.now()}-${random}`;
}

const relay = hasCredentials
  ? new WebhookRelay({ timeoutMs: 15_000 })
  : (undefined as unknown as WebhookRelay);

async function createBucket(suffix: string): Promise<Bucket> {
  const bucket = await relay.buckets.create({
    name: bucketName(suffix),
    stream: true,
    description: "Created by webhookrelay-js live integration tests",
  });
  createdBucketIds.add(bucket.id);
  return bucket;
}

async function cleanupBucket(bucketId: string): Promise<void> {
  try {
    await relay.request("DELETE", `/v1/buckets/${bucketId}`, {
      query: { force: true },
      timeoutMs: 15_000,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
  } finally {
    createdBucketIds.delete(bucketId);
  }
}

async function sendWebhook(input: Input, body: unknown): Promise<void> {
  const response = await fetch(relay.inputs.endpointUrl(input), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WHR-JS-SDK-Test": "1",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
}

async function waitForPollEvent(
  bucket: string,
  predicate: (webhook: WebhookLog) => boolean,
): Promise<WebhookLog> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const poller = events(bucket, {
    config: { timeoutMs: 5_000 },
    intervalMs: 500,
    maxAge: "5m",
    signal: controller.signal,
  });

  try {
    for await (const webhook of poller) {
      if (predicate(webhook)) return webhook;
    }
  } finally {
    clearTimeout(timeout);
    poller.stop();
  }

  throw new Error(`Timed out waiting for webhook event in bucket ${bucket}`);
}

async function waitForSubscription(
  bucket: string,
): Promise<{
  close: () => void;
  ready: Promise<void>;
  webhook: Promise<WebhookEvent>;
}> {
  let close = () => {};
  let resolveReady: () => void;
  let rejectReady: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const webhook = new Promise<WebhookEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const err = new Error(`Timed out waiting for WebSocket webhook in ${bucket}`);
      close();
      rejectReady(err);
      reject(err);
    }, 30_000);

    const sub = subscribe(bucket, {
      config: { timeoutMs: 15_000 },
      reconnect: false,
      onSubscribed: () => resolveReady(),
      onWebhook: (event) => {
        clearTimeout(timeout);
        close();
        resolve(event);
      },
      onError: (err) => {
        clearTimeout(timeout);
        close();
        rejectReady(err);
        reject(err);
      },
    });

    close = () => sub.close();
  });

  return { close, ready, webhook };
}

afterAll(async () => {
  await Promise.allSettled(
    [...createdFunctionIds].map((id) =>
      relay.functions.delete(id).finally(() => createdFunctionIds.delete(id)),
    ),
  );
  await Promise.allSettled([...createdBucketIds].map((id) => cleanupBucket(id)));
});

describeLive("Webhook Relay live API", () => {
  it("manages buckets, inputs, outputs, rules, logs, and raw requests", async () => {
    const bucket = await createBucket("crud");
    try {
      const found = await relay.buckets.findByName(bucket.name);
      expect(found?.id).toBe(bucket.id);

      const updated = await relay.buckets.update(bucket.id, {
        description: "Updated by webhookrelay-js live integration tests",
      });
      expect(updated.id).toBe(bucket.id);

      const input = await relay.inputs.create(bucket.id, {
        name: "public",
        statusCode: 202,
        headers: { "X-SDK-Test": ["ok"] },
      });
      expect(input.id).toBeTruthy();
      expect(relay.inputs.endpointUrl(input)).toContain(input.id);
      expect(await relay.inputs.list(bucket.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: input.id })]),
      );

      const output = await relay.outputs.create(bucket.id, {
        name: "example",
        destination: "https://example.com/webhookrelay-js",
        tlsVerification: true,
      });
      expect(output.id).toBeTruthy();

      const ruled = await relay.outputs.setRules(bucket.id, output.id, {
        match: {
          type: "value",
          parameter: { name: "X-WHR-JS-SDK-Test", source: "header" },
          value: "1",
        },
      });
      expect(ruled.id).toBe(output.id);
      await relay.outputs.deleteRules(bucket.id, output.id);

      expect(await relay.outputs.list(bucket.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: output.id })]),
      );

      const usage = await relay.request<unknown>("GET", "/v1/usage");
      expect(usage).toBeTruthy();

      const page = await relay.webhooks.list({ bucket: bucket.id, limit: 5 });
      expect(Array.isArray(page.data)).toBe(true);
    } finally {
      await cleanupBucket(bucket.id);
    }
  });

  it("manages JavaScript functions and config", async () => {
    let functionId: string | undefined;
    try {
      const fn = await relay.functions.create({
        name: bucketName("fn"),
        payload: "function transform(r) { return r; }",
      });
      functionId = fn.id;
      createdFunctionIds.add(fn.id);
      expect(fn.driver).toBe("js");

      const fetched = await relay.functions.get(fn.id);
      expect(fetched.id).toBe(fn.id);

      const updated = await relay.functions.update(fn.id, {
        payload: "function transform(r) { r.Headers = r.Headers || {}; return r; }",
      });
      expect(updated.id).toBe(fn.id);

      const variable = await relay.functions.setConfig(fn.id, "SDK_TEST", "1");
      expect(variable.key).toBe("SDK_TEST");
      expect(await relay.functions.listConfig(fn.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "SDK_TEST" })]),
      );
      await relay.functions.deleteConfig(fn.id, "SDK_TEST");

      const invoke = await relay.functions.invoke(fn.id, {
        request: { body: JSON.stringify({ hello: "world" }) },
      });
      expect(invoke).toBeTruthy();

      const logs = await relay.functions.logs(fn.id);
      expect(logs).toBeTruthy();
    } finally {
      if (functionId) {
        await relay.functions.delete(functionId);
        createdFunctionIds.delete(functionId);
      }
    }
  });

  it("lists service connections", async () => {
    const connections = await relay.serviceConnections.list();
    expect(Array.isArray(connections)).toBe(true);
  });

  it("configures forwarding with the top-level helper", async () => {
    const configured = await configure({
      bucket: bucketName("configure"),
      destination: "https://example.com/webhookrelay-js",
      input: { name: "public" },
      output: { name: "example" },
    });
    createdBucketIds.add(configured.bucket.id);

    try {
      expect(configured.bucket.name).toMatch(/^whr-js-sdk-configure-/);
      expect(configured.input?.id).toBeTruthy();
      expect(configured.output.id).toBeTruthy();
      expect(configured.endpointUrl).toContain("/v1/webhooks/");
    } finally {
      await cleanupBucket(configured.bucket.id);
    }
  });

  it("receives webhook events through polling", async () => {
    const bucket = await createBucket("poll");
    try {
      const input = await relay.inputs.create(bucket.id, { name: "public" });
      const marker = `poll-${Date.now()}`;
      await sendWebhook(input, { marker });

      const webhook = await waitForPollEvent(bucket.name, (event) =>
        Boolean(event.body?.includes(marker)),
      );
      expect(webhook.method).toBe("POST");
      expect(webhook.body).toContain(marker);
    } finally {
      await cleanupBucket(bucket.id);
    }
  });

  it("receives webhook events through WebSocket subscribe", async () => {
    const bucket = await createBucket("ws");
    try {
      const input = await relay.inputs.create(bucket.id, { name: "public" });
      const marker = `ws-${Date.now()}`;
      const subscription = await waitForSubscription(bucket.name);
      await subscription.ready;

      await sendWebhook(input, { marker });
      const webhook = await subscription.webhook;

      expect(webhook.method).toBe("POST");
      expect(webhook.body).toContain(marker);
      expect(webhook.meta.bucket_name).toBe(bucket.name);
    } finally {
      await cleanupBucket(bucket.id);
    }
  });
});
