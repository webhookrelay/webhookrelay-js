import { resolveConfig, type WebhookRelayConfig } from "./config.js";
import { HttpClient, type RequestOptions } from "./http.js";
import { BucketsResource } from "./resources/buckets.js";
import { InputsResource } from "./resources/inputs.js";
import { OutputsResource } from "./resources/outputs.js";
import { ServiceConnectionsResource } from "./resources/serviceConnections.js";
import { FunctionsResource } from "./resources/functions.js";
import { WebhooksResource } from "./resources/webhooks.js";

/**
 * The Webhook Relay API client.
 *
 * ```ts
 * import { WebhookRelay } from "@webhookrelay/sdk";
 *
 * const relay = new WebhookRelay({ apiKey: "sk-..." });
 *
 * const bucket = await relay.buckets.create({ name: "orders" });
 * relay.webhooks.subscribe({
 *   buckets: [bucket.id],
 *   onWebhook: (w) => console.log(w.method, w.body),
 * });
 * ```
 *
 * Credentials resolve from the constructor config, falling back to the
 * `RELAY_API_KEY` (or `RELAY_KEY` + `RELAY_SECRET`) environment variables.
 */
export class WebhookRelay {
  /** Low-level HTTP client. Use `request()` for endpoints not yet wrapped. */
  readonly http: HttpClient;

  /** Manage buckets. */
  readonly buckets: BucketsResource;
  /** Manage bucket inputs (public webhook endpoints). */
  readonly inputs: InputsResource;
  /** Manage bucket outputs (forwarding destinations) and their rules. */
  readonly outputs: OutputsResource;
  /** Manage service connections and managed cloud inputs/outputs. */
  readonly serviceConnections: ServiceConnectionsResource;
  /** Manage JavaScript transformation/forwarding functions. */
  readonly functions: FunctionsResource;
  /** Read webhook history, poll, and subscribe over WebSocket. */
  readonly webhooks: WebhooksResource;

  constructor(config: WebhookRelayConfig = {}) {
    const resolved = resolveConfig(config);
    this.http = new HttpClient(resolved);
    this.buckets = new BucketsResource(this.http);
    this.inputs = new InputsResource(this.http);
    this.outputs = new OutputsResource(this.http);
    this.serviceConnections = new ServiceConnectionsResource(this.http);
    this.functions = new FunctionsResource(this.http);
    this.webhooks = new WebhooksResource(this.http, resolved);
  }

  /**
   * Escape hatch for calling any API endpoint directly with the configured
   * auth, base URL, timeout and error handling.
   *
   * ```ts
   * const usage = await relay.request("GET", "/v1/usage");
   * ```
   */
  request<T = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    return this.http.request<T>(method, path, options);
  }
}
