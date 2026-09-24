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

async function main() {
  const customerURL = process.env.CUSTOMER_WEBHOOK_URL;
  if (!customerURL) throw new Error("set CUSTOMER_WEBHOOK_URL");
  const relay = createClient();
  const endpoint = await onboardCustomer(relay, customerURL);
  console.log("endpoint:", endpoint.id, "signing secret:", endpoint.secret);
  const message = await publishInvoicePaid(relay);
  console.log("message:", message.id, "->", message.endpoint_ids.length, "endpoint(s)");
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
