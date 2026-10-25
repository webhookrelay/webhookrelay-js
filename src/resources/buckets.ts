import type { HttpClient } from "../http.js";
import { bucketParams } from "../params.js";
import type {
  Bucket,
  BucketAuth,
  CreateBucketParams,
  UpdateBucketParams,
} from "../types.js";

/** Top-level bucket fields `PUT /v1/buckets/{id}` reads (besides `auth`). */
const BUCKET_UPDATE_FIELDS = [
  "name",
  "description",
  "stream",
  "ephemeral",
  "static_ip",
  "large_webhooks",
] as const;

/** Auth fields `PUT /v1/buckets/{id}` reads. */
const BUCKET_AUTH_FIELDS = ["type", "username", "password", "token"] as const;

function pick(source: object | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source) return out;
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Build the full-replace body for `PUT /v1/buckets/{id}`: the current bucket's
 * editable fields with `params` merged over them. `workspace_id` is only sent
 * when the caller gave it, because the API treats a present `workspace_id`
 * (even `null`) as a request to move the bucket.
 */
function bucketUpdateBody(
  current: Bucket,
  params: UpdateBucketParams,
): Record<string, unknown> {
  const changes = bucketParams(params) as Record<string, unknown>;
  const body: Record<string, unknown> = {
    ...pick(current, BUCKET_UPDATE_FIELDS),
    ...pick(changes, BUCKET_UPDATE_FIELDS),
  };
  const auth = {
    ...pick(current.auth, BUCKET_AUTH_FIELDS),
    ...pick(changes.auth as BucketAuth | undefined, BUCKET_AUTH_FIELDS),
  };
  if (Object.keys(auth).length > 0) body.auth = auth;
  if (changes.workspace_id !== undefined) body.workspace_id = changes.workspace_id;
  return body;
}

/**
 * Manage buckets — the top-level containers that receive webhooks and route
 * them to outputs.
 *
 * ```ts
 * const bucket = await relay.buckets.create({ name: "orders" });
 * const all = await relay.buckets.list();
 * ```
 */
export class BucketsResource {
  constructor(private readonly http: HttpClient) {}

  /** List every bucket on the account. */
  list(): Promise<Bucket[]> {
    return this.http.unwrap(
      this.http.api.v1.bucketsList(),
      "GET",
      "/v1/buckets",
    );
  }

  /** Create a bucket. */
  create(params: CreateBucketParams): Promise<Bucket> {
    return this.http.unwrap(
      this.http.api.v1.bucketsCreate(bucketParams(params) as never),
      "POST",
      "/v1/buckets",
    );
  }

  /** Fetch a single bucket by ID (includes its inputs and outputs). */
  get(bucketId: string): Promise<Bucket> {
    return this.http.unwrap(
      this.http.api.v1.bucketsDetail(encodeURIComponent(bucketId)),
      "GET",
      "/v1/buckets/{id}",
    );
  }

  /**
   * Update a bucket. Only the fields you pass change; the rest keep their
   * current values.
   *
   * The API's `PUT /v1/buckets/{id}` replaces the whole bucket (and rejects a
   * body without `name`), so this fetches the bucket first, merges `params`
   * over its editable fields (`name`, `description`, `stream`, `ephemeral`,
   * `static_ip`, `large_webhooks`, and `auth` field by field) and sends the
   * result. That costs one extra `GET`, and a change made by someone else
   * between the two requests is overwritten. `workspace_id` is sent only when
   * you pass it. To clear a text field, pass `""`.
   *
   * ```ts
   * await relay.buckets.update(bucket.id, { description: "Production orders" });
   * ```
   */
  async update(bucketId: string, params: UpdateBucketParams): Promise<Bucket> {
    const current = await this.get(bucketId);
    return this.http.unwrap(
      this.http.api.v1.bucketsUpdate(
        encodeURIComponent(bucketId),
        bucketUpdateBody(current, params) as never,
      ),
      "PUT",
      "/v1/buckets/{id}",
    );
  }

  /** Delete a bucket and everything in it. */
  delete(bucketId: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.bucketsDelete(encodeURIComponent(bucketId)),
      "DELETE",
      "/v1/buckets/{id}",
    ) as Promise<void>;
  }

  /**
   * Find a bucket by its (account-unique) name. Convenience over {@link list};
   * returns `undefined` when no bucket matches.
   */
  async findByName(name: string): Promise<Bucket | undefined> {
    const buckets = await this.list();
    return buckets.find((b) => b.name === name);
  }
}
