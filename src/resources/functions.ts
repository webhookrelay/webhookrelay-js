import type { HttpClient } from "../http.js";
import { functionParams } from "../params.js";
import type {
  CreateFunctionParams,
  FunctionConfigVariable,
  FunctionExecuteResponse,
  GenerateFunctionParams,
  GenerateFunctionResponse,
  UpdateFunctionParams,
  WebhookFunction,
} from "../types.js";

/**
 * Manage JavaScript functions — the code that transforms webhooks and controls
 * forwarding. Attach a function to an {@link import("./inputs.js").InputsResource | input}
 * (runs on the way in) or an {@link import("./outputs.js").OutputsResource | output}
 * (runs before forwarding) via its `function_id`.
 *
 * A function receives the request/response and can rewrite the body, headers,
 * method and path, set the response, or stop forwarding entirely.
 *
 * ```ts
 * const fn = await relay.functions.create({
 *   name: "to-slack",
 *   payload: `function transform(r) {
 *     const p = JSON.parse(r.RequestBody || "{}");
 *     r.RequestBody = JSON.stringify({ text: "New event: " + p.title });
 *     return r;
 *   }`,
 * });
 * ```
 */
export class FunctionsResource {
  constructor(private readonly http: HttpClient) {}

  /** List all functions on the account. */
  list(): Promise<WebhookFunction[]> {
    return this.http.unwrap(
      this.http.api.v1.functionsList(),
      "GET",
      "/v1/functions",
    );
  }

  /** Create a JavaScript function. `driver` defaults to `"js"`. */
  create(params: CreateFunctionParams): Promise<WebhookFunction> {
    return this.http.unwrap(
      this.http.api.v1.functionsCreate({ driver: "js", ...params }),
      "POST",
      "/v1/functions",
    );
  }

  /** Fetch a single function by ID. */
  get(functionId: string): Promise<WebhookFunction> {
    return this.http.unwrap(
      this.http.api.v1.functionsDetail(encodeURIComponent(functionId)),
      "GET",
      "/v1/functions/{id}",
    );
  }

  /** Update a function's name or source. */
  async update(
    functionId: string,
    params: UpdateFunctionParams,
  ): Promise<WebhookFunction> {
    let body = params;
    if (params.name === undefined || params.driver === undefined) {
      const current = await this.get(functionId);
      body = {
        name: current.name,
        driver: current.driver,
        ...params,
      };
    }

    await this.http.unwrap(
      this.http.api.v1.functionsUpdate(encodeURIComponent(functionId), body),
      "PUT",
      "/v1/functions/{id}",
    );
    return this.get(functionId);
  }

  /** Delete a function. */
  delete(functionId: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.functionsDelete(encodeURIComponent(functionId)),
      "DELETE",
      "/v1/functions/{id}",
    );
  }

  /**
   * Run a function against a sample request without forwarding anything —
   * useful for testing a transformation. Pass a sample request payload; the
   * response reports how the request/response were modified.
   */
  invoke(
    functionId: string,
    sampleRequest?: unknown,
  ): Promise<FunctionExecuteResponse> {
    return this.http.request<FunctionExecuteResponse>(
      "POST",
      `/v1/functions/${encodeURIComponent(functionId)}/invoke`,
      sampleRequest === undefined ? {} : { body: sampleRequest },
    );
  }

  /** List a function's runtime config variables. */
  listConfig(functionId: string): Promise<FunctionConfigVariable[]> {
    return this.http.unwrap(
      this.http.api.v1.functionsConfigList(encodeURIComponent(functionId)),
      "GET",
      "/v1/functions/{id}/config",
    );
  }

  /** Set a single runtime config variable, available to the function as configuration. */
  setConfig(
    functionId: string,
    key: string,
    value: string,
  ): Promise<FunctionConfigVariable> {
    return this.http.unwrap(
      this.http.api.v1.functionsConfigUpdate(encodeURIComponent(functionId), {
        key,
        value,
      }),
      "PUT",
      "/v1/functions/{id}/config",
    );
  }

  /** Delete a runtime config variable by key. */
  deleteConfig(functionId: string, key: string): Promise<void> {
    return this.http.unwrap(
      this.http.api.v1.functionsConfigDelete(
        encodeURIComponent(functionId),
        encodeURIComponent(key),
      ),
      "DELETE",
      "/v1/functions/{id}/config/{key}",
    );
  }

  /** Fetch execution logs for a function. */
  logs<T = unknown>(functionId: string): Promise<T> {
    return this.http.unwrap(
      this.http.api.v1.functionsLogsList(encodeURIComponent(functionId)),
      "GET",
      "/v1/functions/{id}/logs",
    );
  }

  /**
   * Generate a JavaScript function from a description and/or example payloads.
   * Returns the generated source (create it with {@link create}).
   */
  generate(params: GenerateFunctionParams): Promise<GenerateFunctionResponse> {
    return this.http.unwrap(
      this.http.api.v1.functionsGenerateCreate(functionParams(params)),
      "POST",
      "/v1/functions-generate",
    );
  }
}
