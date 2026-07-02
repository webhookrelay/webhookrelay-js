/**
 * Configure a bucket with a public input and an output that forwards webhooks
 * to a destination.
 *
 * Run with:  RELAY_API_KEY=sk-... npx tsx examples/manage-buckets.ts
 */
import { configure } from "@webhookrelay/sdk";

async function main() {
  const { relay, bucket, input, output, endpointUrl } = await configure({
    bucket: "orders-" + Date.now(),
    destination: "https://example.com/webhook",
    bucketOptions: {
      description: "Created by the @webhookrelay/sdk example",
    },
    input: {
      name: "public",
    },
    output: {
      name: "example",
    },
  });

  console.log("bucket:", bucket.id, bucket.name);
  console.log("input:", input?.id);
  console.log("endpoint:", endpointUrl);
  console.log("output:", output.id, "->", output.destination);

  if (process.env.CLEANUP === "1") {
    await relay.outputs.delete(bucket.id, output.id);
    if (input) await relay.inputs.delete(bucket.id, input.id);
    await relay.request("DELETE", `/v1/buckets/${bucket.id}`, {
      query: { force: true },
    });
    console.log("cleaned up:", bucket.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
