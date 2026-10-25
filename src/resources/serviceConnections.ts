import type { HttpClient } from "../http.js";
import { WebhookRelayAPIError } from "../errors.js";
import {
  managedServiceParams,
  mergeForReplace,
  serviceConnectionParams,
} from "../params.js";
import type {
  CreateServiceConnectionParams,
  ServiceConnection,
  ServiceConnectionInput,
  ServiceConnectionOutput,
  UpdateServiceConnectionParams,
} from "../types.js";

/** Server-owned fields left out of managed input/output replace bodies. */
const MANAGED_READ_ONLY = [
  "id",
  "bucket_id",
  "status",
  "error",
  "created_at",
  "updated_at",
] as const;

function notFound(kind: string, id: string, bucketId: string): WebhookRelayAPIError {
  return new WebhookRelayAPIError({
    status: 404,
    method: "PUT",
    path: `/v1/buckets/{id}/${kind.replace(/ /g, "-")}s/{detailed}`,
    body: undefined,
    message: `${kind} '${id}' not found in bucket '${bucketId}'`,
  });
}

/**
 * Manage service connections — credentials for managed cloud integrations
 * (AWS, GCP, Azure) plus the per-bucket managed inputs/outputs that use them
 * (S3, SQS, SNS, Pub/Sub, GCS, Slack, Discord).
 *
 * ```ts
 * const sc = await relay.serviceConnections.create({
 *   name: "prod-aws",
 *   service_type: "aws",
 *   aws_service_connection: { access_key_id: "…", secret_access_key: "…" },
 * });
 * await relay.serviceConnections.createOutput(bucketId, {
 *   name: "to-slack",
 *   service_connection_id: sc.id,
 *   service_connection_output_type: "slack",
 *   slack_output: { channel: "#alerts" },
 * });
 * ```
 */
export class ServiceConnectionsResource {
  constructor(private readonly http: HttpClient) {}

  /** List all service connections. */
  list(): Promise<ServiceConnection[]> {
    return this.http.unwrap(
      this.http.api.v1.serviceConnectionsList(),
      "GET",
      "/v1/service-connections",
    );
  }

  /** Create a service connection. */
  create(params: CreateServiceConnectionParams): Promise<ServiceConnection> {
    return this.http.unwrap(
      this.http.api.v1.serviceConnectionsCreate(
        serviceConnectionParams(params) as never,
      ),
      "POST",
      "/v1/service-connections",
    );
  }

  /** Fetch a single service connection by ID. */
  get(id: string): Promise<ServiceConnection> {
    return this.http.unwrap(
      this.http.api.v1.serviceConnectionsDetail(encodeURIComponent(id)),
      "GET",
      "/v1/service-connections/{id}",
    );
  }

  /**
   * Update a service connection. Credential fields you omit are kept. The API
   * always replaces the name (and rejects an empty one), so when `name` is
   * omitted the current name is fetched and sent.
   */
  async update(
    id: string,
    params: UpdateServiceConnectionParams,
  ): Promise<ServiceConnection> {
    const body = serviceConnectionParams(params);
    if (body.name === undefined) body.name = (await this.get(id)).name;
    return this.http.unwrap(
      this.http.api.v1.serviceConnectionsUpdate(
        encodeURIComponent(id),
        body as never,
      ),
      "PUT",
      "/v1/service-connections/{id}",
    );
  }

  /** Delete a service connection. */
  delete(id: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.serviceConnectionsDelete(encodeURIComponent(id)),
      "DELETE",
      "/v1/service-connections/{id}",
    );
  }

  // --- Managed inputs (cloud queues/buckets feeding a bucket) ---------------

  /** List a bucket's service-connection inputs. */
  listInputs(bucketId: string): Promise<ServiceConnectionInput[]> {
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionInputsList(
        encodeURIComponent(bucketId),
      ),
      "GET",
      "/v1/buckets/{id}/service-connection-inputs",
    );
  }

  /** Create a service-connection input on a bucket. */
  createInput(
    bucketId: string,
    params: Partial<ServiceConnectionInput> & { service_connection_id: string },
  ): Promise<ServiceConnectionInput> {
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionInputsCreate(
        encodeURIComponent(bucketId),
        managedServiceParams(params) as never,
      ),
      "POST",
      "/v1/buckets/{id}/service-connection-inputs",
    );
  }

  /**
   * Update a service-connection input. Only the fields you pass change: the
   * API's `PUT` replaces the whole input, so the current one is read from
   * {@link listInputs} first and `params` are merged over it.
   */
  async updateInput(
    bucketId: string,
    inputId: string,
    params: Partial<ServiceConnectionInput>,
  ): Promise<ServiceConnectionInput> {
    const current = (await this.listInputs(bucketId)).find((i) => i.id === inputId);
    if (!current) throw notFound("service-connection input", inputId, bucketId);
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionInputsUpdate(
        encodeURIComponent(bucketId),
        encodeURIComponent(inputId),
        mergeForReplace(current, managedServiceParams(params), MANAGED_READ_ONLY) as never,
      ),
      "PUT",
      "/v1/buckets/{id}/service-connection-inputs/{inputId}",
    );
  }

  /** Delete a service-connection input. */
  deleteInput(bucketId: string, inputId: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionInputsDelete(
        encodeURIComponent(bucketId),
        encodeURIComponent(inputId),
      ),
      "DELETE",
      "/v1/buckets/{id}/service-connection-inputs/{inputId}",
    );
  }

  // --- Managed outputs (forward to cloud queues/buckets/Slack/Discord) ------

  /** List a bucket's service-connection outputs. */
  listOutputs(bucketId: string): Promise<ServiceConnectionOutput[]> {
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionOutputsList(
        encodeURIComponent(bucketId),
      ),
      "GET",
      "/v1/buckets/{id}/service-connection-outputs",
    );
  }

  /** Create a service-connection output on a bucket. */
  createOutput(
    bucketId: string,
    params: Partial<ServiceConnectionOutput> & {
      service_connection_id: string;
    },
  ): Promise<ServiceConnectionOutput> {
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionOutputsCreate(
        encodeURIComponent(bucketId),
        managedServiceParams(params) as never,
      ),
      "POST",
      "/v1/buckets/{id}/service-connection-outputs",
    );
  }

  /**
   * Update a service-connection output. Only the fields you pass change: the
   * API's `PUT` replaces the whole output, so the current one is read from
   * {@link listOutputs} first and `params` are merged over it.
   */
  async updateOutput(
    bucketId: string,
    outputId: string,
    params: Partial<ServiceConnectionOutput>,
  ): Promise<ServiceConnectionOutput> {
    const current = (await this.listOutputs(bucketId)).find((o) => o.id === outputId);
    if (!current) throw notFound("service-connection output", outputId, bucketId);
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionOutputsUpdate(
        encodeURIComponent(bucketId),
        encodeURIComponent(outputId),
        mergeForReplace(current, managedServiceParams(params), MANAGED_READ_ONLY) as never,
      ),
      "PUT",
      "/v1/buckets/{id}/service-connection-outputs/{outputId}",
    );
  }

  /** Delete a service-connection output. */
  deleteOutput(bucketId: string, outputId: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.bucketsServiceConnectionOutputsDelete(
        encodeURIComponent(bucketId),
        encodeURIComponent(outputId),
      ),
      "DELETE",
      "/v1/buckets/{id}/service-connection-outputs/{outputId}",
    );
  }
}
