/**
 * Keep test and live outbound traffic apart with environments. Each
 * environment has its own consumers, event types, endpoints and messages;
 * `default` always exists.
 *
 * Run with:
 *   RELAY_API_KEY=sk-... npx tsx examples/outbound-environments.ts
 *
 * test/outbound-environments.test.ts runs these functions against a mocked API.
 */
import { WebhookRelay, WebhookRelayAPIError } from "@webhookrelay/sdk";

// Create the environment unless it exists.
export async function ensureEnvironment(relay: WebhookRelay, name: string, description: string) {
  try {
    return await relay.outbound.environments.create({ name, description });
  } catch (err) {
    if (err instanceof WebhookRelayAPIError && err.status === 409) {
      const all = await relay.outbound.environments.list();
      const existing = all.find((e) => e.name === name);
      if (existing) return existing;
    }
    throw err;
  }
}

// Publish the same event in the staging environment. A client created with
// `new WebhookRelay({ outboundEnvironment: "test" })` acts there by default;
// `withEnvironment` derives one for a single call site.
export async function publishInTest(relay: WebhookRelay) {
  await ensureEnvironment(relay, "test", "Staging");
  const test = relay.outbound.withEnvironment("test");
  await test.consumers.upsert("customer_42", { name: "Acme (staging)" });
  return test.messages.publish({
    consumer: "customer_42",
    eventType: "invoice.paid",
    payload: { invoice_id: "inv_test_1", amount: 4900 },
  });
}

async function main() {
  const relay = new WebhookRelay();
  const message = await publishInTest(relay);
  console.log("message:", message.id, "in", message.environment);
  console.log("environments:", (await relay.outbound.environments.list()).map((e) => e.name));
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
