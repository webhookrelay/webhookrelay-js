import type { HttpClient } from "../http.js";
import {
  managedServiceParams,
  serviceConnectionParams,
} from "../params.js";
import type {
  CreateServiceConnectionParams,
  ServiceConnection,
  ServiceConnectionInput,
  ServiceConnectionOutput,
  UpdateServiceConnectionParams,
} from "../types.js";

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
    return this.http.get<ServiceConnection[]>("/v1/service-connections");
  }

  /** Create a service connection. */
  create(params: CreateServiceConnectionParams): Promise<ServiceConnection> {
    return this.http.post<ServiceConnection>("/v1/service-connections", {
      body: serviceConnectionParams(params),
    });
  }

  /** Fetch a single service connection by ID. */
  get(id: string): Promise<ServiceConnection> {
    return this.http.get<ServiceConnection>(
      `/v1/service-connections/${encodeURIComponent(id)}`,
    );
  }

  /** Update a service connection. */
  update(
    id: string,
    params: UpdateServiceConnectionParams,
  ): Promise<ServiceConnection> {
    return this.http.put<ServiceConnection>(
      `/v1/service-connections/${encodeURIComponent(id)}`,
      { body: serviceConnectionParams(params) },
    );
  }

  /** Delete a service connection. */
  delete(id: string): Promise<void> {
    return this.http.delete<void>(
      `/v1/service-connections/${encodeURIComponent(id)}`,
    );
  }

  // --- Managed inputs (cloud queues/buckets feeding a bucket) ---------------

  /** List a bucket's service-connection inputs. */
  listInputs(bucketId: string): Promise<ServiceConnectionInput[]> {
    return this.http.get<ServiceConnectionInput[]>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-inputs`,
    );
  }

  /** Create a service-connection input on a bucket. */
  createInput(
    bucketId: string,
    params: Partial<ServiceConnectionInput> & { service_connection_id: string },
  ): Promise<ServiceConnectionInput> {
    return this.http.post<ServiceConnectionInput>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-inputs`,
      { body: managedServiceParams(params) },
    );
  }

  /** Update a service-connection input. */
  updateInput(
    bucketId: string,
    inputId: string,
    params: Partial<ServiceConnectionInput>,
  ): Promise<ServiceConnectionInput> {
    return this.http.put<ServiceConnectionInput>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-inputs/${encodeURIComponent(inputId)}`,
      { body: managedServiceParams(params) },
    );
  }

  /** Delete a service-connection input. */
  deleteInput(bucketId: string, inputId: string): Promise<void> {
    return this.http.delete<void>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-inputs/${encodeURIComponent(inputId)}`,
    );
  }

  // --- Managed outputs (forward to cloud queues/buckets/Slack/Discord) ------

  /** List a bucket's service-connection outputs. */
  listOutputs(bucketId: string): Promise<ServiceConnectionOutput[]> {
    return this.http.get<ServiceConnectionOutput[]>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-outputs`,
    );
  }

  /** Create a service-connection output on a bucket. */
  createOutput(
    bucketId: string,
    params: Partial<ServiceConnectionOutput> & {
      service_connection_id: string;
    },
  ): Promise<ServiceConnectionOutput> {
    return this.http.post<ServiceConnectionOutput>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-outputs`,
      { body: managedServiceParams(params) },
    );
  }

  /** Update a service-connection output. */
  updateOutput(
    bucketId: string,
    outputId: string,
    params: Partial<ServiceConnectionOutput>,
  ): Promise<ServiceConnectionOutput> {
    return this.http.put<ServiceConnectionOutput>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-outputs/${encodeURIComponent(outputId)}`,
      { body: managedServiceParams(params) },
    );
  }

  /** Delete a service-connection output. */
  deleteOutput(bucketId: string, outputId: string): Promise<void> {
    return this.http.delete<void>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/service-connection-outputs/${encodeURIComponent(outputId)}`,
    );
  }
}
