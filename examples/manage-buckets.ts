/**
 * Create a bucket with an input, a JavaScript transformation function, and an
 * output that forwards transformed webhooks to a destination.
 *
 * Run with:  RELAY_API_KEY=sk-... npx tsx examples/manage-buckets.ts
 */
import { WebhookRelay } from "@webhookrelay/sdk";

const relay = new WebhookRelay(); // reads RELAY_API_KEY from the environment

async function main() {
  // 1. A bucket to receive webhooks.
  const bucket = await relay.buckets.create({
    name: "orders-" + Date.now(),
    description: "Created by the @webhookrelay/sdk example",
  });
  console.log("bucket:", bucket.id, bucket.name);

  // 2. A JS function that reshapes the payload into a Slack message.
  const fn = await relay.functions.create({
    name: "to-slack",
    payload: `function transform(r) {
  const p = JSON.parse(r.RequestBody || "{}");
  r.RequestBody = JSON.stringify({ text: "New order: " + (p.id || "unknown") });
  return r;
}`,
  });
  console.log("function:", fn.id, fn.driver);

  // 3. A public input endpoint (this is the URL you give to the provider).
  const input = await relay.inputs.create(bucket.id, { name: "public" });
  console.log("input:", input.id);

  // 4. An output that runs the function then forwards, only for matching events.
  const output = await relay.outputs.create(bucket.id, {
    name: "slack",
    destination: "https://hooks.slack.example/T000/B000/XXXX",
    function_id: fn.id,
  });
  await relay.outputs.setRules(bucket.id, output.id, {
    match: {
      type: "value",
      parameter: { name: "X-Event-Type", source: "header" },
      value: "order.created",
    },
  });
  console.log("output:", output.id, "→", output.destination);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
