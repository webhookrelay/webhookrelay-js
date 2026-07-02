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
