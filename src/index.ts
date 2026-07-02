/**
 * Official TypeScript/JavaScript SDK for the Webhook Relay API.
 *
 * @packageDocumentation
 */

export { WebhookRelay } from "./client.js";

// Config
export {
  resolveConfig,
  DEFAULT_BASE_URL,
  type WebhookRelayConfig,
  type ResolvedConfig,
  type SocketAuth,
} from "./config.js";

// Errors
export {
  WebhookRelayError,
  WebhookRelayAPIError,
  WebhookRelayConnectionError,
  WebhookRelayConfigError,
} from "./errors.js";

// HTTP core
export {
  HttpClient,
  type RequestOptions,
  type QueryParams,
  type QueryValue,
} from "./http.js";

// Resource clients
export { BucketsResource } from "./resources/buckets.js";
export { InputsResource } from "./resources/inputs.js";
export { OutputsResource } from "./resources/outputs.js";
export { ServiceConnectionsResource } from "./resources/serviceConnections.js";
export { FunctionsResource } from "./resources/functions.js";
export { WebhooksResource } from "./resources/webhooks.js";

// Streaming
export { WebhookPoller, type PollOptions } from "./streaming/poller.js";
export {
  WebhookSubscription,
  type SubscribeOptions,
  type WebhookEvent,
  type WebhookEventMeta,
  type StatusEvent,
} from "./streaming/socket.js";
export {
  socketUrlFromBase,
  resolveWebSocketCtor,
  type WebSocketCtor,
  type WebSocketLike,
} from "./streaming/websocket.js";

// Data model
export * from "./types.js";
