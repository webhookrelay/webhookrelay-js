# @webhookrelay/sdk

Official TypeScript / JavaScript SDK for the [Webhook Relay](https://webhookrelay.com) API.

Manage buckets, inputs, outputs, service connections and JavaScript
transformation functions, and receive webhooks in real time — by polling or over
a WebSocket. Works in Node.js (≥ 18), Deno, Bun and the browser.

```bash
npm install @webhookrelay/sdk
```

> In Node.js < 21 the WebSocket subscription needs the [`ws`](https://www.npmjs.com/package/ws)
> package (installed automatically as an optional dependency). Node 21+, Deno,
> Bun and browsers use the built-in `WebSocket`.

## Quick start

```ts
import { WebhookRelay } from "@webhookrelay/sdk";

const relay = new WebhookRelay({ apiKey: "sk-..." });

// Create a bucket and its public input endpoint
const bucket = await relay.buckets.create({ name: "orders", stream: true });
const input = await relay.inputs.create(bucket.id, { name: "public" });

console.log("Send webhooks to:", relay.inputs.endpointUrl(input));

// Receive them in real time
relay.webhooks.subscribe({
  buckets: [bucket.id],
  onWebhook: (w) => console.log(w.method, w.body),
});
```

Or use the top-level helpers for the common forwarding and receiving paths:

```ts
import { configure, subscribe } from "@webhookrelay/sdk";

const { endpointUrl } = await configure({
  bucket: "orders",
  destination: "https://example.com/webhook",
});

console.log("Send webhooks to:", endpointUrl);

for await (const webhook of events("orders")) {
  console.log(webhook.method, webhook.body);
}

const sub = subscribe("orders", {
  onWebhook: (w) => console.log(w.method, w.body),
});
```

For durable pull delivery, use `events()`:

```ts
import { events } from "@webhookrelay/sdk";

for await (const webhook of events("orders")) {
  console.log(webhook.method, webhook.body);
}
```

## Authentication

Create credentials at [my.webhookrelay.com/tokens](https://my.webhookrelay.com/tokens).

```ts
// Recommended: a single account API key (starts with "sk-")
new WebhookRelay({ apiKey: "sk-..." });

// Classic access token pair (key + secret)
new WebhookRelay({ key: "your-token-key", secret: "your-token-secret" });
```

Credentials also resolve automatically from the environment, so `new WebhookRelay()`
works when one of these is set:

| Variable | Meaning |
| --- | --- |
| `RELAY_API_KEY` | Account API key (`sk-...`) |
| `RELAY_KEY` + `RELAY_SECRET` | Classic access token pair |
| `RELAY_BASE_URL` | API address, when not `https://my.webhookrelay.com` (self-hosted or local development) |

Other options: `baseUrl`, `timeoutMs`, `fetch`, `headers`, `userAgent`.

## Buckets

```ts
const buckets = await relay.buckets.list();
const bucket = await relay.buckets.create({ name: "orders", description: "…" });
await relay.buckets.get(bucket.id);
await relay.buckets.update(bucket.id, { description: "updated" });
await relay.buckets.findByName("orders");
await relay.buckets.delete(bucket.id); // delete its inputs/outputs first
```

`update` is a partial update: fields you leave out keep their current values.
The API's `PUT /v1/buckets/{id}` replaces the whole bucket, so the SDK fetches
the bucket, merges your changes over its editable fields (`name`,
`description`, `stream`, `ephemeral`, `static_ip`, `large_webhooks`, and
`auth` field by field) and sends the result. `workspace_id` is only sent when
you pass it (`null` ungroups the bucket). `outputs.update`,
`functions.update` and the service-connection `update*` methods work the same
way.

## Inputs

Inputs are the public HTTPS endpoints that receive webhooks.

```ts
const input = await relay.inputs.create(bucket.id, {
  name: "github",
  function_id: fn.id, // optional: transform/validate on the way in
});

relay.inputs.endpointUrl(input);
// → https://my.webhookrelay.com/v1/webhooks/<input.id>

await relay.inputs.update(bucket.id, input.id, { description: "…" });
await relay.inputs.list(bucket.id);
await relay.inputs.delete(bucket.id, input.id);
```

## Outputs & forward rules

Outputs are the destinations webhooks are forwarded to. Attach a function to
transform the payload and use **rules** to forward conditionally.

```ts
const output = await relay.outputs.create(bucket.id, {
  destination: "https://example.com/hook",
  function_id: fn.id,
});

// Only forward requests whose "X-Event" header equals "push"
await relay.outputs.setRules(bucket.id, output.id, {
  match: {
    type: "value",
    parameter: { name: "X-Event", source: "header" },
    value: "push",
  },
});

await relay.outputs.deleteRules(bucket.id, output.id); // forward everything
await relay.outputs.update(bucket.id, output.id, { disabled: true }); // other fields are kept
await relay.outputs.delete(bucket.id, output.id);
```

Rules compose with `and` / `or` / `not`:

```ts
await relay.outputs.setRules(bucket.id, output.id, {
  and: [
    { match: { type: "value", parameter: { name: "X-Event", source: "header" }, value: "push" } },
    { not: { match: { type: "substring", parameter: { source: "body" }, substring: "draft" } } },
  ],
});
```

## Functions (JavaScript)

Functions are the code that transforms webhooks and controls forwarding. Attach
one to an input (runs on the way in) or an output (runs before forwarding) via
its `function_id`. A function can rewrite the body, headers, method and path,
set the response, or stop forwarding entirely.

```ts
const fn = await relay.functions.create({
  name: "to-slack",
  payload: `function transform(r) {
    const p = JSON.parse(r.RequestBody || "{}");
    r.RequestBody = JSON.stringify({ text: "New event: " + p.title });
    return r;
  }`,
});

// Runtime config available to the function
await relay.functions.setConfig(fn.id, "SLACK_CHANNEL", "#alerts");
await relay.functions.listConfig(fn.id);

// Test it against a sample request without forwarding anything
const result = await relay.functions.invoke(fn.id, { request: { body: '{"title":"hi"}' } });
console.log(result.request_modified, result.stop_forwarding);

// Generate a function from a description / example payloads
const { code } = await relay.functions.generate({
  additional_info: "Convert GitHub push events into Slack messages",
});

await relay.functions.list();
await relay.functions.update(fn.id, { payload: "…" });
await relay.functions.delete(fn.id);
```

## Service connections

Credentials for managed cloud integrations (AWS, GCP, Azure) plus the per-bucket
managed inputs/outputs that use them (S3, SQS, SNS, Pub/Sub, GCS, Slack, Discord).

```ts
const sc = await relay.serviceConnections.create({
  name: "prod-aws",
  service_type: "aws",
  aws_service_connection: { access_key_id: "…", secret_access_key: "…" },
});

await relay.serviceConnections.createOutput(bucket.id, {
  name: "to-sqs",
  service_connection_id: sc.id,
  service_connection_output_type: "aws_sqs",
  aws_sqs_output: { queue_url: "https://sqs…/my-queue" },
});

await relay.serviceConnections.listOutputs(bucket.id);
await relay.serviceConnections.list();
```

## Outbound webhooks — send webhooks to your customers

Register each customer as a consumer with the HTTPS endpoint they give you, then
publish events. Webhook Relay signs every delivery
([Standard Webhooks](https://www.standardwebhooks.com/)), retries failures durably
for up to 48 hours and keeps the delivery history. Check that outbound webhooks
are enabled for your account (and its limits) with `relay.outbound.access()`.

```ts
const { enabled, limits } = await relay.outbound.access();

// Once per customer.
await relay.outbound.eventTypes.upsert("invoice.paid", { description: "An invoice was paid" });
await relay.outbound.consumers.upsert("customer_42", { name: "Acme" });
const endpoint = await relay.outbound.endpoints.create("customer_42", {
  url: "https://customer.example/webhooks",
  eventTypes: ["invoice.paid"],
});
// endpoint.secret is the signing secret your customer verifies deliveries with.
// Migrating from Svix or another Standard Webhooks sender? Pass `secret` with the
// endpoint's existing whsec_ secret so your customer keeps verifying with it.

// Every time the event happens.
const message = await relay.outbound.messages.publish(
  { consumer: "customer_42", eventType: "invoice.paid", payload: { invoice_id: "inv_123", amount: 4900 } },
  { idempotencyKey: "invoice-paid:inv_123" }, // retrying with the same key never publishes twice
);
```

Publishing is asynchronous: the result is the durable acceptance receipt.
`outbound.messages.get(id)` shows each endpoint's delivery and attempts;
`outbound.endpoints.retry`, `.recover` and `.replayMissing` re-send in the
background and return a recovery task (`outbound.recoveryTasks.get`).

Watch endpoint health across all your customers. Endpoints carry `stats`
(attempts and failures over the last 24 hours) when listed or read:

```ts
const { endpoints, stats } = await relay.outbound.health();
// endpoints: { active, failing, paused, disabled } counts; stats: { attempts, failures }

// Failing endpoints come longest failing first. Filter by `consumer` too;
// `limit` is 1-100 (default 50), page with `offset`.
const failing = await relay.outbound.endpoints.listAll({ state: "failing", limit: 20 });
for (const e of failing) console.log(e.consumer, e.url, e.failing_since, e.stats?.failures);
```

Migrating from another webhook sender (Svix, Hookdeck Outpost, ...)? Import
event types, consumers and endpoints in bulk, up to 5000 items per import.
Endpoints keep their existing signing `secret`, and `paused: true` holds
deliveries until you cut over and resume them. Items that already exist are
left unchanged, so re-running an import is safe:

```ts
import { isOutboundImportDone } from "@webhookrelay/sdk";

let task = await relay.outbound.imports.start({
  eventTypes: [{ name: "invoice.paid" }],
  consumers: [{ id: "customer_42", name: "Acme" }],
  endpoints: [{
    consumer: "customer_42",
    url: "https://customer.example/webhooks",
    eventTypes: ["invoice.paid"],
    secret: "whsec_...",
    paused: true,
  }],
}, { timeoutMs: 120_000 }); // a large import can outlast the default timeout
while (!isOutboundImportDone(task)) { // bound the wait, e.g. with a deadline
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  task = await relay.outbound.imports.get(task.id);
}
if (task.status === "failed") {
  // task.errors lists refused items when nothing was written; otherwise
  // task.error names the item that stopped it, and starting it again resumes it.
  throw new Error(`import ${task.id} failed: ${task.error}`);
}
// task.endpoints: { total, created, unchanged }
```

The whole import is validated before anything is written: invalid items fail
the call with a 400 whose `err.itemErrors` lists up to 100 of them as
`{ kind, index, key, error }` (`err.message` gives the total, and the reason
when the import as a whole is refused). Only one import runs at a time:
sending the same import again while it runs returns the running task, so
retrying after a timeout is safe; a different import gets a 409. Item keys
name endpoints by URL, which may be sensitive, so log them with care.

Runnable versions of these examples, the import included (`importCustomers`),
live in [`examples/outbound.ts`](./examples/outbound.ts).

### Channels, filters and test events

An endpoint receives every message of its event types unless you narrow it.
`channels` route by tag: a message published with `channels` reaches the
endpoints subscribed to one of them, plus endpoints without channels. `filter`
matches the published payload (equality, nested or dotted paths, `$eq` `$neq`
`$in` `$nin` `$exists` `$gt` `$gte` `$lt` `$lte`, `$or`/`$and`); filtered-out
deliveries are recorded as `rejected` and never attempted.

```ts
const endpoint = await relay.outbound.endpoints.create("customer_42", {
  url: "https://customer.example/webhooks",
  eventTypes: ["invoice.paid"],
  channels: ["project-123"],
  filter: { status: { $in: ["paid", "refunded"] }, amount: { $gte: 100 } },
});
await relay.outbound.messages.publish({
  consumer: "customer_42",
  eventType: "invoice.paid",
  channels: ["project-123"],
  payload: { invoice_id: "inv_123", status: "paid", amount: 4900 },
});

// A test event only this endpoint receives; the filter applies, channels do not.
const test = await relay.outbound.endpoints.sendTest(endpoint.id, { eventType: "invoice.paid" });

// `endpoints.update` replaces the whole configuration (an update without
// `filter` clears it); `endpoints.patch` changes only the fields you pass.
await relay.outbound.endpoints.patch(endpoint.id, { filter: { status: "paid" } });
```

### Cloud destinations

Endpoints can deliver into the consumer's own AWS SQS, SNS, S3, Google Pub/Sub
or Cloud Storage instead of an HTTPS URL. Credentials are write-only; reads show
`credentials_identity` (the access key ID or service account email) instead.

```ts
await relay.outbound.endpoints.create("customer_42", {
  type: "aws_sqs",
  destination: { aws_sqs: { queue_url: "https://sqs.eu-west-1.amazonaws.com/123456789012/orders", region: "eu-west-1" } },
  credentials: { aws: { access_key_id: "AKIA...", secret_access_key: "..." } },
  eventTypes: ["invoice.paid"],
});
```

### Environments

Environments (`test`, `live`, ...) each have their own consumers, event types,
endpoints, messages and portal sessions; `default` always exists and holds
everything created without one. Quotas are shared across environments.

```ts
await relay.outbound.environments.create({ name: "test", description: "Staging" });

// Every outbound call of this client acts in `test` (X-Outbound-Environment header).
const staging = new WebhookRelay({ apiKey: "sk-...", outboundEnvironment: "test" });

// Or derive a bound view from any client; nothing is fetched.
const live = relay.outbound.withEnvironment("live");
await live.messages.publish({ consumer: "customer_42", eventType: "invoice.paid", payload: {} });
```

A token restricted to one environment always acts there and gets a 403 when a
request names another.

### Embed the consumer portal

Let each customer manage their own endpoints and read their deliveries in a
hosted portal. Allow your app's origin once, mint a link server-side per page
load, and embed it with the React component from `@webhookrelay/sdk/react`
(React is an optional peer dependency; the core SDK never imports it):

```ts
// Once. update() replaces the settings, so carry the current ones over.
const { portal_id, created_at, updated_at, ...settings } = await relay.outbound.portalSettings.get();
await relay.outbound.portalSettings.update({
  ...settings,
  allowed_origins: [...settings.allowed_origins, "https://app.acme.example"],
});

// Server, per page load. The URL carries a one-time token: never log it.
const { url } = await relay.outbound.portalSessions.create("customer_42", { sessionId: `user-${user.id}` });

// On sign-out.
await relay.outbound.portalSessions.expire("customer_42", { sessionId: `user-${user.id}` });
```

```tsx
import { WebhookRelayPortal } from "@webhookrelay/sdk/react";

<WebhookRelayPortal url={url} height={720} />; // also title, className, style, width, allow, onLoad
```

Runnable versions: [`examples/outbound-routing.ts`](./examples/outbound-routing.ts),
[`examples/outbound-cloud.ts`](./examples/outbound-cloud.ts),
[`examples/outbound-environments.ts`](./examples/outbound-environments.ts) and
[`examples/outbound-portal.tsx`](./examples/outbound-portal.tsx).

## Receiving webhooks

Three delivery modes, from most durable to lowest latency:

### 1. Query stored history

```ts
const page = await relay.webhooks.list({ bucket: "orders", limit: 50 });
const one = await relay.webhooks.get(page.data[0].id);

// Auto-paginate across cursors
for await (const log of relay.webhooks.iterate({ bucket: "orders" })) {
  console.log(log.method, log.status_code);
}
```

### 2. Poll (pull-delivery queue)

Each webhook is delivered **exactly once**; the queue drains as you iterate.
Durable and simple — great for workers.

```ts
const poller = relay.webhooks.poll({ bucket: "orders" });

for await (const webhook of poller) {
  console.log(webhook.method, webhook.id);
  // Report a different outcome (e.g. your handler failed):
  // await relay.webhooks.update(webhook.id, { status_code: 500 });
}

// Stop from elsewhere: poller.stop();
```

Or with a callback:

```ts
await relay.webhooks.poll({ bucket: "orders" }).listen((webhook) => {
  console.log(webhook.id);
});
```

### 3. Subscribe over WebSocket (real time)

Authenticates, subscribes, answers server pings and **reconnects automatically**
until you close it.

```ts
const sub = relay.webhooks.subscribe({
  buckets: ["orders"],
  onWebhook: (w) => console.log(w.method, w.meta.bucket_name, w.body),
  onSubscribed: () => console.log("listening…"),
  onError: (err) => console.error(err),
});

// later
sub.close();
```

You can also attach listeners after construction:

```ts
sub.on("webhook", (w) => { /* … */ });
sub.on("status", (s) => { /* authenticated | subscribed | ping | … */ });
```

## Error handling

```ts
import { WebhookRelayAPIError, WebhookRelayConnectionError } from "@webhookrelay/sdk";

try {
  await relay.buckets.get("missing");
} catch (err) {
  if (err instanceof WebhookRelayAPIError) {
    console.log(err.status, err.isNotFound, err.requestId, err.body);
  } else if (err instanceof WebhookRelayConnectionError) {
    console.log("network/timeout:", err.message);
  }
}
```

All errors extend `WebhookRelayError`.

## Low-level / uncovered endpoints

Call any endpoint directly with the configured auth, base URL and error handling:

```ts
const usage = await relay.request("GET", "/v1/usage");
```

A fully-typed, generated client (every endpoint and model) is also published as
a raw escape hatch:

```ts
import { Api } from "@webhookrelay/sdk/generated";
```

## Development

```bash
make install     # install dependencies
make openapi     # regenerate src/generated from swagger/swagger.yaml
make build       # build dist/ (ESM + CJS + d.ts)
make typecheck
```

The internal client is generated from the OpenAPI/Swagger spec with
[`swagger-typescript-api`](https://github.com/acacode/swagger-typescript-api),
mirroring `make openapi` in the main webhookrelay repo. Point `make swagger` at
your checkout with `SWAGGER_SRC=…` to refresh the spec.

## License

MIT © [Webhook Relay](https://webhookrelay.com)
