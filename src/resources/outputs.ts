import type { HttpClient } from "../http.js";
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
    return this.http.post<Output>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/outputs`,
      { body: params },
    );
  }

  /** Update an output. */
  update(
    bucketId: string,
    outputId: string,
    params: UpdateOutputParams,
  ): Promise<Output> {
    return this.http.put<Output>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/outputs/${encodeURIComponent(outputId)}`,
      { body: params },
    );
  }

  /** Delete an output. */
  delete(bucketId: string, outputId: string): Promise<void> {
    return this.http.delete<void>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/outputs/${encodeURIComponent(outputId)}`,
    );
  }

  /**
   * Replace an output's forward rules. Only requests matching the rule tree are
   * delivered to this output — the core primitive for conditional forwarding.
   */
  setRules(bucketId: string, outputId: string, rules: Rules): Promise<Output> {
    return this.http.put<Output>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/outputs/${encodeURIComponent(outputId)}/rules`,
      { body: rules },
    );
  }

  /** Remove all forward rules from an output (every request is forwarded). */
  deleteRules(bucketId: string, outputId: string): Promise<void> {
    return this.http.delete<void>(
      `/v1/buckets/${encodeURIComponent(bucketId)}/outputs/${encodeURIComponent(outputId)}/rules`,
    );
  }

  /**
   * List a bucket's outputs. The API returns outputs inline on the bucket, so
   * this fetches the bucket and returns its `outputs`.
   */
  async list(bucketId: string): Promise<Output[]> {
    const bucket = await this.http.get<{ outputs?: Output[] }>(
      `/v1/buckets/${encodeURIComponent(bucketId)}`,
    );
    return bucket.outputs ?? [];
  }
}
