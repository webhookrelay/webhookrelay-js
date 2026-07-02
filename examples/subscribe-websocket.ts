/**
 * Subscribe to a bucket over WebSocket and print webhooks as they arrive.
 * The subscription authenticates, subscribes, answers server pings, and
 * reconnects automatically until you close it.
 *
 * In Node.js < 21 install the `ws` package: npm install ws
 *
 * Run with:  RELAY_API_KEY=sk-... npx tsx examples/subscribe-websocket.ts <bucket>
 */
import { WebhookRelay } from "@webhookrelay/sdk";

const bucket = process.argv[2] ?? "default";
const relay = new WebhookRelay();

const sub = relay.webhooks.subscribe({
  buckets: [bucket],
  onSubscribed: () => console.log(`subscribed to "${bucket}" — waiting for webhooks…`),
  onWebhook: (w) => {
    console.log(`${w.method} ${w.meta.bucket_name}${w.query ? "?" + w.query : ""}`);
    console.log("  body:", w.body);
  },
  onError: (err) => console.error("error:", err.message),
});

process.on("SIGINT", () => {
  console.log("\nclosing…");
  sub.close();
  process.exit(0);
});
