import type { HttpClient } from "../http.js";
import { outboundEndpointParams, outboundMessageParams } from "../params.js";
import type {
  ListAllOutboundEndpointsParams,
  ListOutboundDeliveriesParams,
  ListOutboundMessagesParams,
  OutboundConsumer,
  OutboundDelivery,
  OutboundEndpoint,
  OutboundEndpointParams,
  OutboundEndpointWithSecret,
  OutboundEventType,
  OutboundHealth,
  OutboundMessage,
  OutboundRecoveryParams,
  OutboundRecoveryTask,
  PublishOutboundMessageOptions,
  PublishOutboundMessageParams,
  UpsertOutboundConsumerParams,
  UpsertOutboundEventTypeParams,
} from "../types.js";

const segment = encodeURIComponent;

/** Your customers (consumers) that receive outbound webhooks. */
export class OutboundConsumersResource {
  constructor(private readonly http: HttpClient) {}

  /** List your consumers. */
  list(): Promise<OutboundConsumer[]> {
    return this.http.unwrap(
      this.http.api.v1.outboundConsumersList(),
      "GET",
      "/v1/outbound/consumers",
    );
  }

  /** Get a consumer by ID. */
  get(id: string): Promise<OutboundConsumer> {
    return this.http.unwrap(
      this.http.api.v1.outboundConsumersDetail(segment(id)),
      "GET",
      "/v1/outbound/consumers/{id}",
    );
  }

  /**
   * Create the consumer or update its name and rate. A deleted consumer's ID
   * cannot be reused.
   */
  upsert(id: string, params: UpsertOutboundConsumerParams = {}): Promise<OutboundConsumer> {
    return this.http.unwrap(
      this.http.api.v1.outboundConsumersUpdate(segment(id), params),
      "PUT",
      "/v1/outbound/consumers/{id}",
    );
  }

  /** Delete the consumer and its endpoints. Delivery history is kept. */
  delete(id: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.outboundConsumersDelete(segment(id)),
      "DELETE",
      "/v1/outbound/consumers/{id}",
    );
  }
}

/** Your event catalog, such as `invoice.paid`. */
export class OutboundEventTypesResource {
  constructor(private readonly http: HttpClient) {}

  /** List your event types. */
  list(): Promise<OutboundEventType[]> {
    return this.http.unwrap(
      this.http.api.v1.outboundEventTypesList(),
      "GET",
      "/v1/outbound/event-types",
    );
  }

  /** Create the event type or update its description, example and deprecation. */
  upsert(name: string, params: UpsertOutboundEventTypeParams = {}): Promise<OutboundEventType> {
    return this.http.unwrap(
      // The generated type narrows `example` to an object; any JSON value is valid.
      this.http.api.v1.outboundEventTypesUpdate(segment(name), { ...params, name } as never),
      "PUT",
      "/v1/outbound/event-types/{name}",
    );
  }

  /** Delete an event type no endpoint subscribes to. */
  delete(name: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.outboundEventTypesDelete(segment(name)),
      "DELETE",
      "/v1/outbound/event-types/{name}",
    );
  }
}

/** Consumers' HTTPS destinations, their delivery history and recovery. */
export class OutboundEndpointsResource {
  constructor(private readonly http: HttpClient) {}

  /** List a consumer's endpoints, newest first, with their stats. */
  list(consumerId: string): Promise<OutboundEndpoint[]> {
    return this.http.unwrap(
      this.http.api.v1.outboundConsumersEndpointsList(segment(consumerId)),
      "GET",
      "/v1/outbound/consumers/{consumer}/endpoints",
    );
  }

  /**
   * List endpoints across all consumers, for example to find the failing
   * ones. Failing endpoints come longest failing first, others newest first.
   * Each endpoint carries its attempts and failures over the last 24 hours.
   *
   * ```ts
   * const failing = await relay.outbound.endpoints.listAll({ state: "failing", limit: 20 });
   * ```
   */
  listAll(params: ListAllOutboundEndpointsParams = {}): Promise<OutboundEndpoint[]> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsList(params),
      "GET",
      "/v1/outbound/endpoints",
    );
  }

  /** Get an endpoint by ID. */
  get(id: string): Promise<OutboundEndpoint> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsDetail(segment(id)),
      "GET",
      "/v1/outbound/endpoints/{id}",
    );
  }

  /**
   * Register an HTTPS endpoint for a consumer. The result carries the signing
   * secret your customer verifies deliveries with.
   *
   * ```ts
   * const endpoint = await relay.outbound.endpoints.create("customer_42", {
   *   url: "https://customer.example/webhooks",
   *   eventTypes: ["invoice.paid"],
   * });
   * ```
   */
  create(consumerId: string, params: OutboundEndpointParams): Promise<OutboundEndpointWithSecret> {
    return this.http.unwrap(
      this.http.api.v1.outboundConsumersEndpointsCreate(
        segment(consumerId),
        outboundEndpointParams(params),
      ),
      "POST",
      "/v1/outbound/consumers/{consumer}/endpoints",
    );
  }

  /** Replace an endpoint's configuration. Its state and signing secrets are kept. */
  update(id: string, params: OutboundEndpointParams): Promise<OutboundEndpoint> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsUpdate(segment(id), outboundEndpointParams(params)),
      "PUT",
      "/v1/outbound/endpoints/{id}",
    );
  }

  /** Delete an endpoint. Delivery history is kept. */
  delete(id: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsDelete(segment(id)),
      "DELETE",
      "/v1/outbound/endpoints/{id}",
    );
  }

  /**
   * Stop deliveries. Messages published while paused are recorded as skipped;
   * send them later with {@link replayMissing}.
   */
  pause(id: string): Promise<OutboundEndpoint> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsPauseCreate(segment(id)),
      "POST",
      "/v1/outbound/endpoints/{id}/pause",
    );
  }

  /** Restart deliveries and reset the failure count. */
  resume(id: string): Promise<OutboundEndpoint> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsResumeCreate(segment(id)),
      "POST",
      "/v1/outbound/endpoints/{id}/resume",
    );
  }

  /** Replace the signing secret. The previous one keeps signing for 24 hours. */
  async rotateSecret(id: string): Promise<string> {
    const { secret } = await this.http.unwrap<{ secret: string }>(
      this.http.api.v1.outboundEndpointsSecretRotateCreate(segment(id)),
      "POST",
      "/v1/outbound/endpoints/{id}/secret/rotate",
    );
    return secret;
  }

  /** Return the current signing secret. */
  async revealSecret(id: string): Promise<string> {
    const { secret } = await this.http.unwrap<{ secret: string }>(
      this.http.api.v1.outboundEndpointsSecretRevealCreate(segment(id)),
      "POST",
      "/v1/outbound/endpoints/{id}/secret/reveal",
    );
    return secret;
  }

  /** List the endpoint's deliveries, newest first. */
  deliveries(id: string, params: ListOutboundDeliveriesParams = {}): Promise<OutboundDelivery[]> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsDeliveriesList(segment(id), params),
      "GET",
      "/v1/outbound/endpoints/{id}/deliveries",
    );
  }

  /** Re-send one message to the endpoint in the background. */
  retry(id: string, messageId: string): Promise<OutboundRecoveryTask> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsRetryCreate(segment(id), { message_id: messageId }),
      "POST",
      "/v1/outbound/endpoints/{id}/retry",
    );
  }

  /** Re-send deliveries whose retries were exhausted since `since` (default: last 24 hours). */
  recover(id: string, params: OutboundRecoveryParams = {}): Promise<OutboundRecoveryTask> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsRecoverCreate(segment(id), params),
      "POST",
      "/v1/outbound/endpoints/{id}/recover",
    );
  }

  /**
   * Send deliveries skipped while the endpoint was paused or disabled, since
   * `since` (default: last 24 hours). Resume the endpoint first.
   */
  replayMissing(id: string, params: OutboundRecoveryParams = {}): Promise<OutboundRecoveryTask> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsReplayMissingCreate(segment(id), params),
      "POST",
      "/v1/outbound/endpoints/{id}/replay-missing",
    );
  }
}

/** Publish messages and inspect them. */
export class OutboundMessagesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Accept a message for signed delivery to every endpoint of the consumer
   * subscribed to its event type. Delivery is asynchronous: the result is the
   * durable acceptance receipt.
   *
   * ```ts
   * await relay.outbound.messages.publish(
   *   { consumer: "customer_42", eventType: "invoice.paid", payload: { invoice_id: "inv_123" } },
   *   { idempotencyKey: "invoice-paid:inv_123" },
   * );
   * ```
   */
  publish(
    params: PublishOutboundMessageParams,
    options: PublishOutboundMessageOptions = {},
  ): Promise<OutboundMessage> {
    const headers = options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined;
    return this.http.unwrap(
      // The generated type narrows `payload` to an object; any JSON value is valid.
      this.http.api.v1.outboundMessagesCreate(outboundMessageParams(params) as never, { headers }),
      "POST",
      "/v1/outbound/messages",
    );
  }

  /** Get a message with its payload and one delivery per addressed endpoint. */
  get(id: string): Promise<OutboundMessage> {
    return this.http.unwrap(
      this.http.api.v1.outboundMessagesDetail(segment(id)),
      "GET",
      "/v1/outbound/messages/{id}",
    );
  }

  /** List accepted messages, newest first, without payloads. */
  list(params: ListOutboundMessagesParams = {}): Promise<OutboundMessage[]> {
    return this.http.unwrap(
      this.http.api.v1.outboundMessagesList(outboundMessageParams(params)),
      "GET",
      "/v1/outbound/messages",
    );
  }
}

/** Progress of background re-sends started by endpoint recovery. */
export class OutboundRecoveryTasksResource {
  constructor(private readonly http: HttpClient) {}

  /** Get a recovery task by ID. */
  get(id: string): Promise<OutboundRecoveryTask> {
    return this.http.unwrap(
      this.http.api.v1.outboundRecoveryTasksDetail(segment(id)),
      "GET",
      "/v1/outbound/recovery-tasks/{id}",
    );
  }
}

/**
 * Outbound webhooks (pilot): send signed webhooks to your own customers.
 * Register each customer as a consumer with the HTTPS endpoints they give
 * you, then publish messages. Webhook Relay signs every delivery (Standard
 * Webhooks), retries failures durably and keeps the delivery history.
 */
export class OutboundResource {
  readonly consumers: OutboundConsumersResource;
  readonly eventTypes: OutboundEventTypesResource;
  readonly endpoints: OutboundEndpointsResource;
  readonly messages: OutboundMessagesResource;
  readonly recoveryTasks: OutboundRecoveryTasksResource;

  constructor(private readonly http: HttpClient) {
    this.consumers = new OutboundConsumersResource(http);
    this.eventTypes = new OutboundEventTypesResource(http);
    this.endpoints = new OutboundEndpointsResource(http);
    this.messages = new OutboundMessagesResource(http);
    this.recoveryTasks = new OutboundRecoveryTasksResource(http);
  }

  /**
   * Count your endpoints by state and their delivery attempts and failures
   * over the last 24 hours, to the hour. Attempts are counted within about
   * 15 seconds.
   *
   * ```ts
   * const { endpoints, stats } = await relay.outbound.health();
   * console.log(endpoints.failing, stats.failures / Math.max(stats.attempts, 1));
   * ```
   */
  health(): Promise<OutboundHealth> {
    return this.http.unwrap(
      this.http.api.v1.outboundHealthList(),
      "GET",
      "/v1/outbound/health",
    );
  }
}
