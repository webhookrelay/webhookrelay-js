/**
 * Route outbound webhooks with channels and payload filters, and try an
 * endpoint out with a test event.
 *
 * Run with:
 *   RELAY_API_KEY=sk-... CUSTOMER_WEBHOOK_URL=https://... npx tsx examples/outbound-routing.ts
 *
 * test/outbound-routing.test.ts runs these functions against a mocked API.
 */
import { WebhookRelay } from "@webhookrelay/sdk";

// An endpoint that receives only project-123's large paid or refunded invoices.
export async function createFilteredEndpoint(relay: WebhookRelay, customerURL: string) {
  await relay.outbound.eventTypes.upsert("invoice.paid", { description: "An invoice was paid" });
  await relay.outbound.consumers.upsert("customer_42", { name: "Acme" });
  return relay.outbound.endpoints.create("customer_42", {
    url: customerURL,
    eventTypes: ["invoice.paid"],
    // Only messages published with one of these channels.
    channels: ["project-123"],
    // Only payloads that match: status paid or refunded and amount >= 100.
    filter: { status: { $in: ["paid", "refunded"] }, amount: { $gte: 100 } },
  });
}

// Publish to the endpoints of one project. Endpoints without channels receive
// it too; endpoints subscribed to other channels do not.
export function publishToProject(relay: WebhookRelay) {
  return relay.outbound.messages.publish(
    {
      consumer: "customer_42",
      eventType: "invoice.paid",
      channels: ["project-123"],
      payload: { invoice_id: "inv_123", status: "paid", amount: 4900 },
    },
    { idempotencyKey: "invoice-paid:inv_123" },
  );
}

// Send the endpoint a test event: the filter applies, so this checks it lets
// a matching payload through. Test events have their own daily allowance.
export function sendTestEvent(relay: WebhookRelay, endpointId: string) {
  return relay.outbound.endpoints.sendTest(endpointId, {
    eventType: "invoice.paid",
    payload: { invoice_id: "inv_test", status: "paid", amount: 250 },
  });
}

// Widen the filter later without touching the endpoint's other settings.
// (`endpoints.update` replaces the whole configuration instead.)
export function includeVoidedInvoices(relay: WebhookRelay, endpointId: string) {
  return relay.outbound.endpoints.patch(endpointId, {
    filter: {
      $or: [
        { status: { $in: ["paid", "refunded"] }, amount: { $gte: 100 } },
        { status: "void" },
      ],
    },
  });
}

async function main() {
  const customerURL = process.env.CUSTOMER_WEBHOOK_URL;
  if (!customerURL) throw new Error("set CUSTOMER_WEBHOOK_URL");
  const relay = new WebhookRelay();
  const endpoint = await createFilteredEndpoint(relay, customerURL);
  console.log("endpoint:", endpoint.id, endpoint.channels, endpoint.filter);
  const message = await publishToProject(relay);
  console.log("message:", message.id, "->", message.endpoint_ids.length, "endpoint(s)");
  const test = await sendTestEvent(relay, endpoint.id);
  console.log("test message:", test.id, "test:", test.test);
  console.log("filter:", (await includeVoidedInvoices(relay, endpoint.id)).filter);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
