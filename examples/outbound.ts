/**
 * Send signed webhooks to your own customers with outbound webhooks.
 *
 * Run with:
 *   RELAY_API_KEY=sk-... CUSTOMER_WEBHOOK_URL=https://... npx tsx examples/outbound.ts
 *
 * test/outbound.test.ts runs these functions, and the Webhook Relay dashboard
 * shows the marked region, so keep the two in step.
 */
// dashboard-snippet:start
import { WebhookRelay } from "@webhookrelay/sdk";

// Reads RELAY_API_KEY from the environment. Keep it server-side.
export const createClient = () => new WebhookRelay();

// Once per customer: register the HTTPS endpoint they give you.
export async function onboardCustomer(relay: WebhookRelay, customerURL: string) {
  await relay.outbound.eventTypes.upsert("invoice.paid", { description: "An invoice was paid" });
  await relay.outbound.consumers.upsert("customer_42", { name: "Acme" });
  return relay.outbound.endpoints.create("customer_42", {
    url: customerURL,
    eventTypes: ["invoice.paid"],
  });
}

// Every time the event happens. Retry with the same idempotency key.
export function publishInvoicePaid(relay: WebhookRelay) {
  return relay.outbound.messages.publish(
    { consumer: "customer_42", eventType: "invoice.paid", payload: { invoice_id: "inv_123", amount: 4900 } },
    { idempotencyKey: "invoice-paid:inv_123" },
  );
}
// dashboard-snippet:end

// Imported here rather than at the top so the dashboard snippet above stays
// self-contained.
import { isOutboundImportDone, WebhookRelayAPIError } from "@webhookrelay/sdk";

// Find customers whose endpoints are failing, longest failing first.
export async function reportFailingEndpoints(relay: WebhookRelay) {
  const health = await relay.outbound.health();
  if (health.endpoints.failing === 0) return [];
  const failing = await relay.outbound.endpoints.listAll({ state: "failing", limit: 20 });
  return failing.map((e) => ({
    consumer: e.consumer,
    url: e.url,
    failingSince: e.failing_since,
    failures24h: e.stats?.failures ?? 0,
  }));
}

// Migrating from another sender: import customers in one request, then wait
// for it, until `signal` aborts (e.g. AbortSignal.timeout(15 * 60_000)). A
// refused import throws a WebhookRelayAPIError listing the items to fix in
// itemErrors (nothing was written then); a failed one throws an error naming
// why. Sending the same import again resumes it.
export async function importCustomers(
  relay: WebhookRelay,
  customerURL: string,
  { pollMs = 2_000, signal }: { pollMs?: number; signal?: AbortSignal } = {},
) {
  let task = await relay.outbound.imports.start(
    {
      eventTypes: [{ name: "invoice.paid" }],
      consumers: [{ id: "customer_42", name: "Acme" }],
      // Paused until the cutover; resume each consumer's endpoints after it.
      endpoints: [{ consumer: "customer_42", url: customerURL, eventTypes: ["invoice.paid"], paused: true }],
    },
    { timeoutMs: 120_000, signal }, // a large import can outlast the default timeout
  );
  while (!isOutboundImportDone(task)) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    signal?.throwIfAborted();
    task = await relay.outbound.imports.get(task.id, { signal });
  }
  if (task.status !== "completed") {
    throw new Error(`import ${task.id} ${task.status}: ${task.error ?? "see task.errors"}`);
  }
  return task;
}

async function main() {
  const customerURL = process.env.CUSTOMER_WEBHOOK_URL;
  if (!customerURL) throw new Error("set CUSTOMER_WEBHOOK_URL");
  const relay = createClient();
  const endpoint = await onboardCustomer(relay, customerURL);
  console.log("endpoint:", endpoint.id, "signing secret:", endpoint.secret);
  const message = await publishInvoicePaid(relay);
  console.log("message:", message.id, "->", message.endpoint_ids.length, "endpoint(s)");
  console.log("failing endpoints:", await reportFailingEndpoints(relay));
  try {
    const imported = await importCustomers(relay, customerURL, { signal: AbortSignal.timeout(15 * 60_000) });
    console.log("import:", imported.status, imported.endpoints, imported.error ?? "");
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    if (err instanceof WebhookRelayAPIError) {
      for (const item of err.itemErrors) console.error(`${item.kind} #${item.index} ${item.key ?? ""}: ${item.error}`);
    }
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
