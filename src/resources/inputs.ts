import type { HttpClient } from "../http.js";
import { inputParams } from "../params.js";
import type { CreateInputParams, Input, UpdateInputParams } from "../types.js";

/**
 * Manage a bucket's inputs — the public HTTPS endpoints that receive webhooks.
 * Attach a JavaScript function to an input via `function_id` to validate or
 * transform requests as they arrive.
 *
 * ```ts
 * const input = await relay.inputs.create(bucketId, {
 *   name: "github",
 *   function_id: fn.id,
 * });
 * ```
 */
export class InputsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create an input on a bucket. Returns the created input, whose public URL is derived from its ID. */
  create(bucketId: string, params: CreateInputParams): Promise<Input> {
    return this.http.unwrap(
      this.http.api.v1.bucketsInputsCreate(
        encodeURIComponent(bucketId),
        inputParams(params) as never,
      ),
      "POST",
      "/v1/buckets/{id}/inputs",
    );
  }

  /** Update an input. */
  update(
    bucketId: string,
    inputId: string,
    params: UpdateInputParams,
  ): Promise<Input> {
    return this.http.unwrap(
      this.http.api.v1.bucketsInputsUpdate(
        encodeURIComponent(bucketId),
        encodeURIComponent(inputId),
        inputParams(params) as never,
      ),
      "PUT",
      "/v1/buckets/{id}/inputs/{inputId}",
    );
  }

  /** Delete an input. */
  delete(bucketId: string, inputId: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.bucketsInputsDelete(
        encodeURIComponent(bucketId),
        encodeURIComponent(inputId),
      ),
      "DELETE",
      "/v1/buckets/{id}/inputs/{inputId}",
    );
  }

  /**
   * The public URL that receives webhooks for an input. Give this to the
   * provider (Stripe, GitHub, …) sending you webhooks.
   *
   * ```ts
   * const url = relay.inputs.endpointUrl(input.id);
   * // → https://my.webhookrelay.com/v1/webhooks/<input.id>
   * ```
   */
  endpointUrl(inputOrId: string | Input): string {
    const id = typeof inputOrId === "string" ? inputOrId : inputOrId.id;
    return `${this.http.baseUrl}/v1/webhooks/${encodeURIComponent(id)}`;
  }

  /**
   * List a bucket's inputs. The API returns inputs inline on the bucket, so
   * this fetches the bucket and returns its `inputs`.
   */
  async list(bucketId: string): Promise<Input[]> {
    const bucket = await this.http.unwrap<{ inputs?: Input[] }>(
      this.http.api.v1.bucketsDetail(encodeURIComponent(bucketId)),
      "GET",
      "/v1/buckets/{id}",
    );
    return bucket.inputs ?? [];
  }
}
