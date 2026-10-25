import type { HttpClient } from "../http.js";
import { WebhookRelayAPIError } from "../errors.js";
import { mergeForReplace, outputParams } from "../params.js";
import type {
  CreateOutputParams,
  Output,
  Rules,
  UpdateOutputParams,
} from "../types.js";

/** Server-owned output fields left out of the replace body (the API keeps them). */
const OUTPUT_READ_ONLY = [
  "id",
  "bucket_id",
  "rules",
  "cron_id",
  "created_at",
  "updated_at",
  "created_by",
] as const;

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

  /**
   * Update an output. Only the fields you pass change; the rest keep their
   * current values.
   *
   * The API's `PUT /v1/buckets/{id}/outputs/{outputId}` replaces the whole
   * output (a missing `destination` or `function_id` would be cleared), so
   * this reads the output from its bucket first and merges `params` over it.
   * Forward rules are untouched; manage them with {@link setRules}.
   */
  async update(
    bucketId: string,
    outputId: string,
    params: UpdateOutputParams,
  ): Promise<Output> {
    const current = (await this.list(bucketId)).find((o) => o.id === outputId);
    if (!current) {
      throw new WebhookRelayAPIError({
        status: 404,
        message: `output '${outputId}' not found in bucket '${bucketId}'`,
        body: undefined,
        method: "PUT",
        path: "/v1/buckets/{id}/outputs/{outputId}",
      });
    }
    return this.http.unwrap(
      this.http.api.v1.bucketsOutputsUpdate(
        encodeURIComponent(bucketId),
        encodeURIComponent(outputId),
        mergeForReplace(current, outputParams(params), OUTPUT_READ_ONLY) as never,
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
