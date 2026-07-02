import type { HttpClient } from "../http.js";
import { WebhookRelayConnectionError } from "../errors.js";
import type { WebhookLog } from "../types.js";

export interface PollOptions {
  /** Bucket ID or account-unique bucket name. Required. */
  bucket: string;
  /** Only consume webhooks routed to this output ID. */
  output?: string;
  /** Page size per poll (1–100). Default 100 for throughput. */
  limit?: number;
  /** How far back to look for unsent webhooks (Go duration, e.g. "24h"). */
  maxAge?: string;
  /**
   * Delay between polls when the queue is empty, in milliseconds. Default 1000.
   * When a poll returns a full page the next poll happens immediately.
   */
  intervalMs?: number;
  /** Abort the poll loop. */
  signal?: AbortSignal;
}

interface EventsResponse {
  logs: WebhookLog[] | null;
  has_more: boolean;
}

/**
 * Pull-delivery consumer over `GET /v1/events`. Each webhook is returned exactly
 * once (marked delivered as it is handed out), so the queue drains as you
 * iterate — a durable alternative to the WebSocket when you'd rather poll.
 *
 * Iterate it directly, or use {@link WebhookPoller.listen}:
 *
 * ```ts
 * const poller = relay.webhooks.poll({ bucket: "orders" });
 * for await (const webhook of poller) {
 *   console.log(webhook.method, webhook.id);
 * }
 * ```
 *
 * Report a non-default outcome for a consumed webhook with
 * `relay.webhooks.update(id, { status_code, response_body })`.
 */
export class WebhookPoller implements AsyncIterable<WebhookLog> {
  private stopped = false;

  constructor(
    private readonly http: HttpClient,
    private readonly options: PollOptions,
  ) {}

  /** Stop the loop. Any in-flight poll finishes first. */
  stop(): void {
    this.stopped = true;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<WebhookLog> {
    const { bucket, output, maxAge, signal } = this.options;
    const limit = clampLimit(this.options.limit ?? 100);
    const intervalMs = this.options.intervalMs ?? 1000;

    while (!this.stopped && !signal?.aborted) {
      let page: EventsResponse;
      try {
        page = await this.http.get<EventsResponse>("/v1/events", {
          query: { bucket, output, limit, max_age: maxAge },
          signal,
        });
      } catch (err) {
        if (this.stopped || signal?.aborted) return;
        if (err instanceof WebhookRelayConnectionError) {
          // Transient network hiccup — back off and retry rather than kill the loop.
          await sleep(intervalMs, signal);
          continue;
        }
        throw err;
      }

      const logs = page.logs ?? [];
      for (const log of logs) {
        if (this.stopped || signal?.aborted) return;
        yield log;
      }

      if (!page.has_more) {
        await sleep(intervalMs, signal);
      }
    }
  }

  /**
   * Convenience loop: calls `onWebhook` for each consumed webhook until you
   * {@link stop} it, the signal aborts, or `onError` (if provided) is invoked
   * on a fatal error. Resolves when the loop ends.
   */
  async listen(
    onWebhook: (webhook: WebhookLog) => void | Promise<void>,
    onError?: (err: unknown) => void,
  ): Promise<void> {
    try {
      for await (const webhook of this) {
        await onWebhook(webhook);
      }
    } catch (err) {
      if (onError) onError(err);
      else throw err;
    }
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), 100);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    if (signal) {
      if (signal.aborted) return done();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
