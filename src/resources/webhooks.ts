import type { ResolvedConfig } from "../config.js";
import type { HttpClient } from "../http.js";
import type {
  ListWebhookLogsParams,
  WebhookLog,
  WebhookLogsPage,
} from "../types.js";
import { WebhookPoller, type PollOptions } from "../streaming/poller.js";
import {
  WebhookSubscription,
  type SubscribeOptions,
} from "../streaming/socket.js";

/**
 * Read webhook history and receive webhooks in real time.
 *
 * Three delivery modes:
 *  - {@link list}/{@link get} — query stored webhook logs.
 *  - {@link poll} — pull-delivery queue (`/v1/events`), exactly-once, durable.
 *  - {@link subscribe} — push over WebSocket (`/v1/socket`), lowest latency.
 */
export class WebhooksResource {
  constructor(
    private readonly http: HttpClient,
    private readonly config: ResolvedConfig,
  ) {}

  /** List stored webhook logs for a bucket (paginated). */
  list(params: ListWebhookLogsParams): Promise<WebhookLogsPage> {
    return this.http.get<WebhookLogsPage>("/v1/logs", {
      query: {
        bucket: params.bucket,
        limit: params.limit,
        offset: params.offset,
        from: params.from,
        to: params.to,
        status: params.status,
        cursor: params.cursor,
      },
    });
  }

  /** Fetch a single webhook log by ID. */
  get(logId: string): Promise<WebhookLog> {
    return this.http.get<WebhookLog>(`/v1/logs/${encodeURIComponent(logId)}`);
  }

  /**
   * Update a webhook log — used to report the real outcome of a webhook you
   * consumed via {@link poll} (e.g. a different response status code/body).
   */
  update(logId: string, log: Partial<WebhookLog>): Promise<WebhookLog> {
    return this.http.put<WebhookLog>(`/v1/logs/${encodeURIComponent(logId)}`, {
      body: log,
    });
  }

  /**
   * Iterate stored webhook logs across pages, newest first, transparently
   * following the pagination cursor.
   */
  async *iterate(
    params: ListWebhookLogsParams,
  ): AsyncGenerator<WebhookLog> {
    let cursor = params.cursor;
    do {
      const page = await this.list({ ...params, cursor });
      for (const log of page.data ?? []) yield log;
      cursor = page.next_cursor || undefined;
    } while (cursor);
  }

  /**
   * Create a pull-delivery poller over `GET /v1/events`. Each webhook is
   * delivered exactly once and the queue drains as you iterate.
   */
  poll(options: PollOptions): WebhookPoller {
    return new WebhookPoller(this.http, options);
  }

  /**
   * Open a real-time WebSocket subscription to one or more buckets. Returns a
   * {@link WebhookSubscription} that auto-reconnects until closed.
   */
  subscribe(options: SubscribeOptions): WebhookSubscription {
    return new WebhookSubscription(this.config, options);
  }
}
