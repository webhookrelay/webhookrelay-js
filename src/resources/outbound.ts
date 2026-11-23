import type { HttpClient, RequestOptions } from "../http.js";
import { WebhookRelayConfigError } from "../errors.js";
import { rawJsonMember, stringifyWithRawMembers } from "../rawJson.js";
import {
  mergeForReplace,
  outboundEndpointParams,
  outboundImportParams,
  outboundMessageParams,
  outboundPortalSessionParams,
} from "../params.js";
import type {
  CreateOutboundEnvironmentParams,
  CreateOutboundPortalSessionParams,
  ExpireOutboundPortalSessionsParams,
  ListAllOutboundEndpointsParams,
  ListOutboundDeliveriesParams,
  ListOutboundMessagesParams,
  OutboundAccess,
  OutboundConsumer,
  OutboundDelivery,
  OutboundEndpoint,
  OutboundEndpointCreateParams,
  OutboundEndpointParams,
  OutboundEndpointWithSecret,
  OutboundEnvironment,
  OutboundEventType,
  OutboundHealth,
  OutboundImportRequest,
  OutboundImportTask,
  OutboundMessage,
  OutboundPortalLink,
  OutboundPortalSettings,
  OutboundRecoveryParams,
  OutboundRecoveryTask,
  PublishOutboundMessageOptions,
  PublishOutboundMessageParams,
  SendOutboundTestParams,
  UpdateOutboundPortalSettingsParams,
  UpsertOutboundConsumerParams,
  UpsertOutboundEventTypeParams,
} from "../types.js";

const segment = encodeURIComponent;

/** The header that selects the outbound environment of a request. */
export const OUTBOUND_ENVIRONMENT_HEADER = "X-Outbound-Environment";

/** Server-owned endpoint fields that `endpoints.patch` does not send back. */
const ENDPOINT_READ_ONLY = [
  "id",
  "consumer",
  "environment",
  "credentials_identity",
  "state",
  "consecutive_failures",
  "failing_since",
  "previous_secret_expires_at",
  "stats",
  "created_at",
  "updated_at",
] as const;

function idempotencyHeaders(idempotencyKey: string | undefined): Record<string, string> | undefined {
  return idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined;
}

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
   * Register an endpoint for a consumer: an HTTPS URL, or a cloud destination
   * (`type`, `destination` and `credentials`). The result carries the signing
   * secret your customer verifies deliveries with: a new one, or `secret` when
   * importing an existing Standard Webhooks secret (e.g. from Svix).
   * `channels` and `filter` narrow which messages it receives.
   *
   * ```ts
   * const endpoint = await relay.outbound.endpoints.create("customer_42", {
   *   url: "https://customer.example/webhooks",
   *   eventTypes: ["invoice.paid"],
   *   channels: ["project-123"],
   *   filter: { amount: { $gte: 100 } },
   * });
   * ```
   */
  create(consumerId: string, params: OutboundEndpointCreateParams): Promise<OutboundEndpointWithSecret> {
    return this.http.unwrap(
      // The generated type predates cloud endpoints, channels and filters.
      this.http.api.v1.outboundConsumersEndpointsCreate(
        segment(consumerId),
        outboundEndpointParams(params) as never,
      ),
      "POST",
      "/v1/outbound/consumers/{consumer}/endpoints",
    );
  }

  /**
   * Replace an endpoint's configuration. Its state and signing secrets are
   * kept, and so are cloud credentials unless `credentials` is set. Fields
   * left out are cleared, `filter` and `channels` included; use
   * {@link patch} to change only some fields.
   */
  update(id: string, params: OutboundEndpointParams): Promise<OutboundEndpoint> {
    return this.http.unwrap(
      this.http.api.v1.outboundEndpointsUpdate(segment(id), outboundEndpointParams(params) as never),
      "PUT",
      "/v1/outbound/endpoints/{id}",
    );
  }

  /**
   * Change only the given fields: reads the endpoint, overlays `params` and
   * replaces it, so its other settings (filter, channels, headers, ...) are
   * kept. `undefined` keeps a field; set `filter: {}` or `channels: []` to
   * clear one. A kept filter is sent back exactly as the server returned it,
   * so numbers beyond float64 precision are not rounded. Not atomic: a
   * concurrent change between the read and the write is overwritten.
   *
   * ```ts
   * await relay.outbound.endpoints.patch(endpoint.id, { filter: { status: { $in: ["paid", "refunded"] } } });
   * ```
   */
  async patch(id: string, params: Partial<OutboundEndpointParams>): Promise<OutboundEndpoint> {
    const path = `/v1/outbound/endpoints/${segment(id)}`;
    const currentText = await this.http.requestText("GET", path);
    const current = JSON.parse(currentText) as OutboundEndpoint;
    const body = mergeForReplace(current, outboundEndpointParams(params), ENDPOINT_READ_ONLY);
    // JSON.parse rounds filter numbers (9007199254740993 becomes
    // 9007199254740992), and the PUT replaces the filter whole: send a kept
    // filter back as the server's own text.
    const rawFilter = params.filter === undefined ? rawJsonMember(currentText, "filter") : undefined;
    let json: string;
    if (rawFilter === undefined) {
      json = JSON.stringify(body);
    } else {
      const { filter: _parsed, ...rest } = body;
      json = stringifyWithRawMembers(rest, { filter: rawFilter });
    }
    const updated = await this.http.requestText("PUT", path, { json });
    return JSON.parse(updated) as OutboundEndpoint;
  }

  /**
   * Send a test event that only this endpoint receives, signed, retried and
   * recorded like any other and marked `test`. It always reaches the
   * endpoint: neither its channels nor its filter apply. Test events do not count
   * toward the monthly message quota; an account may send 100 in any 24
   * hours (429 beyond). Paused and disabled endpoints refuse it with 409.
   *
   * ```ts
   * const receipt = await relay.outbound.endpoints.sendTest(endpoint.id, {
   *   eventType: "invoice.paid",
   *   payload: { invoice_id: "inv_test", amount: 4900 },
   * });
   * ```
   */
  sendTest(
    id: string,
    params: SendOutboundTestParams = {},
    options: PublishOutboundMessageOptions = {},
  ): Promise<OutboundMessage> {
    return this.http.request<OutboundMessage>("POST", `/v1/outbound/endpoints/${segment(id)}/test`, {
      body: outboundMessageParams(params),
      headers: idempotencyHeaders(options.idempotencyKey),
    });
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
   * subscribed to its event type (and, with `channels`, to one of its
   * channels; endpoints without channels receive every message). Delivery is
   * asynchronous: the result is the durable acceptance receipt.
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
    const headers = idempotencyHeaders(options.idempotencyKey);
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

/** Per-call cancellation and timeout for bulk import calls. `timeoutMs: 0` disables the timeout. */
export type OutboundImportCallOptions = Pick<RequestOptions, "signal" | "timeoutMs">;

/**
 * Reports whether an import has finished: any status but `pending`,
 * `validating` and `running` is final, including statuses added after this
 * SDK. A task without a status is not finished.
 */
export function isOutboundImportDone(task: Pick<OutboundImportTask, "status">): boolean {
  return !!task.status && !["pending", "validating", "running"].includes(task.status);
}

/**
 * Bulk import of event types, consumers and endpoints, for migrations from
 * another webhook sender (Svix, Hookdeck Outpost, ...). The generated client
 * does not cover /v1/outbound/imports yet, so these call the path directly;
 * switch to it when it is regenerated.
 */
export class OutboundImportsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Validate the whole import, then create its items in the background.
   * Items that already exist (event types by name, consumers by ID, endpoints
   * by URL or destination per consumer) are left unchanged, so re-running an
   * import is safe. At most 5000 items and 10 MiB per import, one import at a
   * time.
   *
   * Sending the same import again while it runs returns the running task, so
   * retrying after a timeout or connection error is safe. If it already
   * finished, the retry starts a new import, which finds the items of a
   * completed one unchanged and resumes a failed one.
   * A large import can take longer to upload and validate than the client's
   * default timeout; raise it per call with `options.timeoutMs`.
   *
   * Throws {@link WebhookRelayAPIError}: 400 with up to 100 of the invalid
   * items in `itemErrors` (nothing was written; the message gives the total
   * and the reason when no item is at fault), 409 while a different import is
   * running, 413 when the request is too large. Poll {@link get} until
   * {@link isOutboundImportDone}; `examples/outbound.ts` (`importCustomers`)
   * shows the whole flow.
   *
   * ```ts
   * const task = await relay.outbound.imports.start({
   *   eventTypes: [{ name: "invoice.paid" }],
   *   consumers: [{ id: "customer_42", name: "Acme" }],
   *   endpoints: [{
   *     consumer: "customer_42",
   *     url: "https://customer.example/webhooks",
   *     eventTypes: ["invoice.paid"],
   *     secret: "whsec_...", // keep the consumer's existing signing secret
   *     paused: true,        // resume after the cutover
   *   }],
   * }, { timeoutMs: 120_000 });
   * ```
   */
  start(request: OutboundImportRequest, { signal, timeoutMs }: OutboundImportCallOptions = {}): Promise<OutboundImportTask> {
    return this.http.request<OutboundImportTask>("POST", "/v1/outbound/imports", {
      signal,
      timeoutMs,
      body: outboundImportParams(request),
    });
  }

  /**
   * Get an import's progress by ID. Poll every few seconds until
   * {@link isOutboundImportDone}.
   */
  get(id: string, { signal, timeoutMs }: OutboundImportCallOptions = {}): Promise<OutboundImportTask> {
    return this.http.request<OutboundImportTask>("GET", `/v1/outbound/imports/${segment(id)}`, { signal, timeoutMs });
  }
}

/**
 * Outbound environments (`test`, `live`, ...), each with its own consumers,
 * event types, endpoints and messages. `default` always exists and holds
 * everything created without an environment. Quotas are shared by all
 * environments. The generated client does not cover these paths yet.
 */
export class OutboundEnvironmentsResource {
  constructor(private readonly http: HttpClient) {}

  /** List the environments, `default` included. */
  list(): Promise<OutboundEnvironment[]> {
    return this.http.request("GET", "/v1/outbound/environments");
  }

  /**
   * Create an environment (at most 20 besides `default`). 409 when it
   * exists. Use it with `relay.outbound.withEnvironment(name)`.
   */
  create(params: CreateOutboundEnvironmentParams): Promise<OutboundEnvironment> {
    return this.http.request("POST", "/v1/outbound/environments", { body: params });
  }

  /**
   * Delete an environment. 409 while it still has consumers or event types;
   * `default` cannot be deleted.
   */
  async delete(name: string): Promise<void> {
    await this.http.request("DELETE", `/v1/outbound/environments/${segment(name)}`);
  }
}

/**
 * Links to the hosted consumer portal, where one consumer manages its own
 * endpoints and reads its deliveries. Embed the link in your app with
 * `<WebhookRelayPortal url={link.url} />` from `@webhookrelay/sdk/react`, or
 * open it as a page. Sessions are created in the client's environment.
 */
export class OutboundPortalSessionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Mint a portal link for one consumer, server-side, once per page load.
   * The URL carries a one-time token in its fragment that must be opened
   * within 15 minutes: hand it only to that consumer and never log it.
   * Embedding needs your page's origin in the portal settings'
   * `allowed_origins`.
   *
   * ```ts
   * const { url } = await relay.outbound.portalSessions.create("customer_42", {
   *   sessionId: `user-${user.id}`,
   *   next: "endpoints/new",
   * });
   * ```
   */
  create(consumerId: string, params: CreateOutboundPortalSessionParams = {}): Promise<OutboundPortalLink> {
    return this.http.request(
      "POST",
      `/v1/outbound/consumers/${segment(consumerId)}/portal-sessions`,
      { body: outboundPortalSessionParams(params) },
    );
  }

  /**
   * End the consumer's open portal sessions, or only those tagged
   * `sessionId` (e.g. when your user signs out). Returns how many ended.
   */
  expire(consumerId: string, params: ExpireOutboundPortalSessionsParams = {}): Promise<{ ended: number }> {
    return this.http.request(
      "POST",
      `/v1/outbound/consumers/${segment(consumerId)}/portal-sessions/expire`,
      { body: outboundPortalSessionParams(params) },
    );
  }
}

/** The consumer portal's branding and the origins allowed to embed it. */
export class OutboundPortalSettingsResource {
  constructor(private readonly http: HttpClient) {}

  /** Read the portal settings. */
  get(): Promise<OutboundPortalSettings> {
    return this.http.request("GET", "/v1/outbound/portal-settings");
  }

  /**
   * Replace the portal settings: fields left out are cleared, so start from
   * {@link get}. `allowed_origins` are https origins that may embed the
   * portal; changes reach portal pages within about 10 seconds.
   */
  update(params: UpdateOutboundPortalSettingsParams): Promise<OutboundPortalSettings> {
    return this.http.request("PUT", "/v1/outbound/portal-settings", { body: params });
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
  readonly imports: OutboundImportsResource;
  readonly environments: OutboundEnvironmentsResource;
  readonly portalSessions: OutboundPortalSessionsResource;
  readonly portalSettings: OutboundPortalSettingsResource;

  /**
   * `http` already carries the client's environment header, if any; the
   * resource sends everything through it.
   */
  constructor(private readonly http: HttpClient) {
    this.consumers = new OutboundConsumersResource(http);
    this.eventTypes = new OutboundEventTypesResource(http);
    this.endpoints = new OutboundEndpointsResource(http);
    this.messages = new OutboundMessagesResource(http);
    this.recoveryTasks = new OutboundRecoveryTasksResource(http);
    this.imports = new OutboundImportsResource(http);
    this.environments = new OutboundEnvironmentsResource(http);
    this.portalSessions = new OutboundPortalSessionsResource(http);
    this.portalSettings = new OutboundPortalSettingsResource(http);
  }

  /**
   * The same outbound API acting in another environment: every call sends
   * `X-Outbound-Environment: <name>`. Cheap; nothing is fetched. An unknown
   * environment fails each call with 404, and a token bound to a different
   * environment with 403.
   *
   * ```ts
   * const live = relay.outbound.withEnvironment("live");
   * await live.messages.publish({ consumer: "customer_42", eventType: "invoice.paid", payload });
   * ```
   */
  withEnvironment(name: string): OutboundResource {
    const environment = name.trim();
    if (!environment) {
      throw new WebhookRelayConfigError("withEnvironment needs an environment name, e.g. \"default\"");
    }
    return new OutboundResource(this.http.withHeaders({ [OUTBOUND_ENVIRONMENT_HEADER]: environment }));
  }

  /**
   * Report whether outbound webhooks are enabled for the account, with its
   * limits (consumers, endpoints per consumer, event types). Works even when
   * they are not enabled, unlike the other outbound methods.
   *
   * ```ts
   * const { enabled, limits } = await relay.outbound.access();
   * ```
   */
  access(): Promise<OutboundAccess> {
    return this.http.unwrap(
      this.http.api.v1.outboundAccessList(),
      "GET",
      "/v1/outbound/access",
    );
  }

  /**
   * Ask support to enable outbound webhooks by opening a support ticket.
   * Asking again while that ticket is open returns it; nothing is opened when
   * outbound webhooks are already enabled.
   */
  requestAccess(): Promise<OutboundAccess> {
    return this.http.unwrap(
      this.http.api.v1.outboundAccessRequestCreate(),
      "POST",
      "/v1/outbound/access/request",
    );
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
