import type { HttpClient } from "../http.js";
import { outputParams } from "../params.js";
import type {
  CreateOutputParams,
  Output,
  Rules,
  UpdateOutputParams,
} from "../types.js";

/**
 * Manage a bucket's outputs — the destinations webhooks are forwarded to.
 * Control forwarding with {@link OutputsResource.setRules | forward rules} and
 * transform payloads by attaching a function via `function_id`.
 *
 * ```ts
 * const output = await relay.outputs.create(bucketId, {
 *   destination: "https://example.com/hook",
 *   function_id: fn.id,
 * });
 * await relay.outputs.setRules(bucketId, output.id, {
 *   match: { type: "value", parameter: { name: "X-Event", source: "header" }, value: "push" },
 * });
 * ```
 */
export class OutputsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create an output on a bucket. */
  create(bucketId: string, params: CreateOutputParams): Promise<Output> {
    return this.http.unwrap(
      this.http.api.v1.bucketsOutputsCreate(
        encodeURIComponent(bucketId),
        outputParams(params),
      ),
      "POST",
      "/v1/buckets/{id}/outputs",
    );
  }

  /** Update an output. */
  update(
    bucketId: string,
    outputId: string,
    params: UpdateOutputParams,
  ): Promise<Output> {
    return this.http.unwrap(
      this.http.api.v1.bucketsOutputsUpdate(
        encodeURIComponent(bucketId),
        encodeURIComponent(outputId),
        outputParams(params),
      ),
      "PUT",
      "/v1/buckets/{id}/outputs/{outputId}",
    );
  }

  /** Delete an output. */
  delete(bucketId: string, outputId: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.bucketsOutputsDelete(
        encodeURIComponent(bucketId),
        encodeURIComponent(outputId),
      ),
      "DELETE",
      "/v1/buckets/{id}/outputs/{outputId}",
    );
  }

  /**
   * Replace an output's forward rules. Only requests matching the rule tree are
   * delivered to this output — the core primitive for conditional forwarding.
   */
  setRules(bucketId: string, outputId: string, rules: Rules): Promise<Output> {
    return this.http.request<Output>(
      "PUT",
      `/v1/buckets/${encodeURIComponent(bucketId)}/outputs/${encodeURIComponent(outputId)}/rules`,
      { body: rules },
    );
  }

  /** Remove all forward rules from an output (every request is forwarded). */
  deleteRules(bucketId: string, outputId: string): Promise<void> {
    return this.http.request<void>(
      "DELETE",
      `/v1/buckets/${encodeURIComponent(bucketId)}/outputs/${encodeURIComponent(outputId)}/rules`,
    );
  }

  /**
   * List a bucket's outputs. The API returns outputs inline on the bucket, so
   * this fetches the bucket and returns its `outputs`.
   */
  async list(bucketId: string): Promise<Output[]> {
    const bucket = await this.http.unwrap<{ outputs?: Output[] }>(
      this.http.api.v1.bucketsDetail(encodeURIComponent(bucketId)),
      "GET",
      "/v1/buckets/{id}",
    );
    return bucket.outputs ?? [];
  }
}
