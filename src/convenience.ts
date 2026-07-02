import { WebhookRelay } from "./client.js";
import type { WebhookRelayConfig } from "./config.js";
import type { PollOptions } from "./streaming/poller.js";
import type { SubscribeOptions } from "./streaming/socket.js";
import type {
  Bucket,
  CreateBucketParams,
  CreateInputParams,
  CreateOutputParams,
  Input,
  Output,
  Rules,
} from "./types.js";

export interface ConfigureOptions {
  /** SDK client config. Omit to read credentials from the environment. */
  config?: WebhookRelayConfig;
  /** Existing account-unique bucket name, or the name to create. */
  bucket: string;
  /** Destination URL to forward webhooks to. */
  destination: string;
  /** Bucket fields used when a bucket must be created. */
  bucketOptions?: Omit<CreateBucketParams, "name">;
  /** Input endpoint fields. */
  input?: CreateInputParams | false;
  /** Output fields. `destination` is supplied from the top-level option. */
  output?: Omit<CreateOutputParams, "destination">;
  /** Convenience alias for `output.functionId`. */
  functionId?: string;
  /** Forward rules to attach to the output. */
  rules?: Rules;
}

export interface ConfigureResult {
  relay: WebhookRelay;
  bucket: Bucket;
  input: Input | undefined;
  output: Output;
  endpointUrl: string | undefined;
}

export type EventsOptions = Omit<PollOptions, "bucket"> & {
  /** SDK client config. Omit to read credentials from the environment. */
  config?: WebhookRelayConfig;
};

export type SubscribeBucketOptions = Omit<SubscribeOptions, "buckets"> & {
  /** SDK client config. Omit to read credentials from the environment. */
  config?: WebhookRelayConfig;
};

/**
 * Configure a common forwarding flow: bucket + public input + output.
 */
export async function configure(
  options: ConfigureOptions,
): Promise<ConfigureResult> {
  const relay = new WebhookRelay(options.config);
  const bucket =
    (await relay.buckets.findByName(options.bucket)) ??
    (await relay.buckets.create({
      name: options.bucket,
      stream: true,
      ...options.bucketOptions,
    }));

  const input =
    options.input === false
      ? undefined
      : await relay.inputs.create(bucket.id, {
          name: "public",
          ...(options.input ?? {}),
        });

  const output = await relay.outputs.create(bucket.id, {
    ...(options.output ?? {}),
    functionId: options.functionId ?? options.output?.functionId,
    destination: options.destination,
  });

  if (options.rules) {
    await relay.outputs.setRules(bucket.id, output.id, options.rules);
  }

  return {
    relay,
    bucket,
    input,
    output,
    endpointUrl: input ? relay.inputs.endpointUrl(input) : undefined,
  };
}

/**
 * Poll webhooks from a bucket using the durable pull-delivery queue.
 */
export function events(bucket: string, options: EventsOptions = {}) {
  const { config, ...pollOptions } = options;
  return new WebhookRelay(config).webhooks.poll({ bucket, ...pollOptions });
}

/**
 * Subscribe to one or more buckets over WebSocket.
 */
export function subscribe(
  bucket: string | string[],
  options: SubscribeBucketOptions = {},
) {
  const { config, ...subscribeOptions } = options;
  return new WebhookRelay(config).webhooks.subscribe({
    buckets: Array.isArray(bucket) ? bucket : [bucket],
    ...subscribeOptions,
  });
}
