import type { HttpClient } from "../http.js";
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
    return this.http.get<WebhookFunction[]>("/v1/functions");
  }

  /** Create a JavaScript function. `driver` defaults to `"js"`. */
  create(params: CreateFunctionParams): Promise<WebhookFunction> {
    return this.http.post<WebhookFunction>("/v1/functions", {
      body: { driver: "js", ...params },
    });
  }

  /** Fetch a single function by ID. */
  get(functionId: string): Promise<WebhookFunction> {
    return this.http.get<WebhookFunction>(
      `/v1/functions/${encodeURIComponent(functionId)}`,
    );
  }

  /** Update a function's name or source. */
  update(
    functionId: string,
    params: UpdateFunctionParams,
  ): Promise<WebhookFunction> {
    return this.http.put<WebhookFunction>(
      `/v1/functions/${encodeURIComponent(functionId)}`,
      { body: params },
    );
  }

  /** Delete a function. */
  delete(functionId: string): Promise<void> {
    return this.http.delete<void>(
      `/v1/functions/${encodeURIComponent(functionId)}`,
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
    return this.http.post<FunctionExecuteResponse>(
      `/v1/functions/${encodeURIComponent(functionId)}/invoke`,
      sampleRequest === undefined ? {} : { body: sampleRequest },
    );
  }

  /** List a function's runtime config variables. */
  listConfig(functionId: string): Promise<FunctionConfigVariable[]> {
    return this.http.get<FunctionConfigVariable[]>(
      `/v1/functions/${encodeURIComponent(functionId)}/config`,
    );
  }

  /** Set a single runtime config variable, available to the function as configuration. */
  setConfig(
    functionId: string,
    key: string,
    value: string,
  ): Promise<FunctionConfigVariable> {
    return this.http.put<FunctionConfigVariable>(
      `/v1/functions/${encodeURIComponent(functionId)}/config`,
      { body: { key, value } },
    );
  }

  /** Delete a runtime config variable by key. */
  deleteConfig(functionId: string, key: string): Promise<void> {
    return this.http.delete<void>(
      `/v1/functions/${encodeURIComponent(functionId)}/config/${encodeURIComponent(key)}`,
    );
  }

  /** Fetch execution logs for a function. */
  logs<T = unknown>(functionId: string): Promise<T> {
    return this.http.get<T>(
      `/v1/functions/${encodeURIComponent(functionId)}/logs`,
    );
  }

  /**
   * Generate a JavaScript function from a description and/or example payloads.
   * Returns the generated source (create it with {@link create}).
   */
  generate(params: GenerateFunctionParams): Promise<GenerateFunctionResponse> {
    return this.http.post<GenerateFunctionResponse>("/v1/functions-generate", {
      body: params,
    });
  }
}
