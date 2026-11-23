/**
 * Deliver outbound webhooks into a customer's own AWS SQS queue instead of
 * an HTTPS URL.
 *
 * Run with:
 *   RELAY_API_KEY=sk-... QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/123456789012/orders \
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npx tsx examples/outbound-cloud.ts
 *
 * test/outbound-routing.test.ts runs these functions against a mocked API.
 */
import { WebhookRelay } from "@webhookrelay/sdk";

export interface CustomerQueue {
  queueURL: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// The credentials are the customer's, scoped to sqs:SendMessage on the queue.
// They are write-only: stored encrypted and never returned; reads show only
// credentials_identity (the access key ID).
export async function createQueueEndpoint(relay: WebhookRelay, queue: CustomerQueue) {
  await relay.outbound.consumers.upsert("customer_42", { name: "Acme" });
  return relay.outbound.endpoints.create("customer_42", {
    type: "aws_sqs",
    destination: { aws_sqs: { queue_url: queue.queueURL, region: queue.region } },
    credentials: { aws: { access_key_id: queue.accessKeyId, secret_access_key: queue.secretAccessKey } },
    eventTypes: ["invoice.paid"],
  });
}

async function main() {
  const { QUEUE_URL, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
  if (!QUEUE_URL || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error("set QUEUE_URL, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
  }
  const relay = new WebhookRelay();
  const endpoint = await createQueueEndpoint(relay, {
    queueURL: QUEUE_URL,
    region: AWS_REGION ?? "eu-west-1",
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  });
  console.log("endpoint:", endpoint.id, endpoint.type, "->", endpoint.url, "as", endpoint.credentials_identity);
  const test = await relay.outbound.endpoints.sendTest(endpoint.id);
  console.log("test message:", test.id);
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
