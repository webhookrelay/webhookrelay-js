/**
 * Poll a bucket for webhooks using the pull-delivery queue (/v1/events).
 * Each webhook is delivered exactly once; the queue drains as you iterate.
 *
 * Run with:  RELAY_API_KEY=sk-... npx tsx examples/poll-webhooks.ts <bucket>
 */
import { WebhookRelay } from "@webhookrelay/sdk";

const bucket = process.argv[2] ?? "default";
const relay = new WebhookRelay();

async function main() {
  const poller = relay.webhooks.poll({ bucket, intervalMs: 2000 });

  // Stop cleanly on Ctrl-C.
  process.on("SIGINT", () => {
    console.log("\nstopping…");
    poller.stop();
  });

  console.log(`polling bucket "${bucket}" — send it a webhook…`);
  for await (const webhook of poller) {
    console.log(`${webhook.method} ${webhook.id} (${webhook.body?.length ?? 0} bytes)`);

    // If your handler failed, report a different outcome so the sender sees it:
    // await relay.webhooks.update(webhook.id, { status_code: 500 });
  }
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
