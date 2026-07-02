import type { HttpClient } from "../http.js";
import type {
  Bucket,
  CreateBucketParams,
  UpdateBucketParams,
} from "../types.js";

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
      this.http.api.v1.bucketsCreate(params as never),
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

  /** Update a bucket. */
  update(bucketId: string, params: UpdateBucketParams): Promise<Bucket> {
    return this.http.unwrap(
      this.http.api.v1.bucketsUpdate(encodeURIComponent(bucketId), params as never),
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
