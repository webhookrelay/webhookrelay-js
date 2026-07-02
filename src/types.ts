/**
 * Public data model for the Webhook Relay API.
 *
 * Field names mirror the JSON returned by the API (snake_case) so that values
 * you read here line up 1:1 with the REST reference at
 * https://webhookrelay.com/docs/api/ — no translation layer to reason about.
 */

/** HTTP headers as returned/accepted by the API: each header maps to a list of values. */
export type Headers = Record<string, string[]>;

/** Unix epoch seconds. */
export type UnixSeconds = number;

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

export interface BucketAuth {
  id?: string;
  /** "none" | "basic" | "token" — how inbound requests to inputs are authenticated. */
  type?: string;
  username?: string;
  password?: string;
  token?: string;
  created_at?: UnixSeconds;
  updated_at?: UnixSeconds;
}

export interface Bucket {
  id: string;
  name: string;
  description?: string;
  account_id?: string;
  /** Ephemeral buckets are auto-deleted once idle; handy for one-off testing. */
  ephemeral?: boolean;
  /** When true, webhooks are streamed to connected WebSocket/poll clients. */
  stream?: boolean;
  suspended?: boolean;
  static_ip?: boolean;
  large_webhooks?: boolean;
  cron_id?: string;
  auth?: BucketAuth;
  inputs?: Input[];
  outputs?: Output[];
  service_connection_inputs?: ServiceConnectionInput[];
  service_connection_outputs?: ServiceConnectionOutput[];
  created_at?: UnixSeconds;
  updated_at?: UnixSeconds;
}

export interface CreateBucketParams {
  name: string;
  description?: string;
  ephemeral?: boolean;
  stream?: boolean;
  static_ip?: boolean;
  large_webhooks?: boolean;
  auth?: BucketAuth;
}

export type UpdateBucketParams = Partial<CreateBucketParams>;

// ---------------------------------------------------------------------------
// Inputs (public endpoints that receive webhooks)
// ---------------------------------------------------------------------------

export interface Input {
  id: string;
  name?: string;
  description?: string;
  bucket_id?: string;
  /** ID of a Function that transforms/validates the request on the way in. */
  function_id?: string;
  /** Default response status code returned to the sender. */
  status_code?: number;
  /** Default response body returned to the sender (byte array or string). */
  body?: number[] | string;
  headers?: Headers;
  custom_domain?: string;
  path_prefix?: string;
  strip_path_prefix?: boolean;
  /** Return the response produced by this output ID instead of the canned one. */
  response_from_output?: string;
  legacy_tls?: boolean;
  tls_version?: string;
  created_at?: UnixSeconds;
  updated_at?: UnixSeconds;
  created_by?: string;
}

export interface CreateInputParams {
  name?: string;
  description?: string;
  /** CamelCase alias for `function_id`. */
  functionId?: string;
  function_id?: string;
  /** CamelCase alias for `status_code`. */
  statusCode?: number;
  status_code?: number;
  body?: number[] | string;
  headers?: Headers;
  /** CamelCase alias for `custom_domain`. */
  customDomain?: string;
  custom_domain?: string;
  /** CamelCase alias for `path_prefix`. */
  pathPrefix?: string;
  path_prefix?: string;
  /** CamelCase alias for `strip_path_prefix`. */
  stripPathPrefix?: boolean;
  strip_path_prefix?: boolean;
  /** CamelCase alias for `response_from_output`. */
  responseFromOutput?: string;
  response_from_output?: string;
}

export type UpdateInputParams = Partial<CreateInputParams>;

// ---------------------------------------------------------------------------
// Outputs (destinations webhooks are forwarded to)
// ---------------------------------------------------------------------------

export interface Output {
  id: string;
  name?: string;
  description?: string;
  bucket_id?: string;
  /** Where matching webhooks are forwarded, e.g. "http://localhost:8080". */
  destination?: string;
  /** ID of a Function that transforms the request before it is forwarded. */
  function_id?: string;
  headers?: Headers;
  /** Forward rules — only requests matching these are delivered to this output. */
  rules?: Rules;
  internal?: boolean;
  disabled?: boolean;
  lock_path?: boolean;
  retries?: number;
  timeout?: number;
  tls_verification?: boolean;
  throttle?: unknown;
  durability?: unknown;
  cron_id?: string;
  created_at?: UnixSeconds;
  updated_at?: UnixSeconds;
  created_by?: string;
}

export interface CreateOutputParams {
  destination: string;
  name?: string;
  description?: string;
  /** CamelCase alias for `function_id`. */
  functionId?: string;
  function_id?: string;
  headers?: Headers;
  rules?: Rules;
  internal?: boolean;
  disabled?: boolean;
  /** CamelCase alias for `lock_path`. */
  lockPath?: boolean;
  lock_path?: boolean;
  retries?: number;
  timeout?: number;
  /** CamelCase alias for `tls_verification`. */
  tlsVerification?: boolean;
  tls_verification?: boolean;
}

export type UpdateOutputParams = Partial<CreateOutputParams>;

// ---------------------------------------------------------------------------
// Output forward rules
// ---------------------------------------------------------------------------

/** Where a match rule reads its value from (header, query param, body path, ...). */
export interface RuleArgument {
  name?: string;
  source?: string;
  envname?: string;
  base64decode?: boolean;
}

export interface MatchRule {
  type?: string;
  value?: string;
  regex?: string;
  substring?: string;
  secret?: string;
  "ip-range"?: string;
  parameter?: RuleArgument;
}

export interface NotRule {
  match?: MatchRule;
  and?: Rules[];
  or?: Rules[];
}

/** A boolean tree of match rules attached to an output. */
export interface Rules {
  match?: MatchRule;
  and?: Rules[];
  or?: Rules[];
  not?: NotRule;
}

// ---------------------------------------------------------------------------
// Functions (transformation / forwarding control)
// ---------------------------------------------------------------------------

/** This SDK focuses on JavaScript functions. */
export type FunctionDriver = "js" | "lua";

export interface WebhookFunction {
  id: string;
  name: string;
  /** The function source code. */
  payload: string;
  /** Runtime driver. Defaults to "js" when created through this SDK. */
  driver: FunctionDriver;
  account_id?: string;
  compression?: string;
  payload_size?: number;
  metadata?: Record<string, unknown>;
  created?: UnixSeconds;
  updated?: UnixSeconds;
}

export interface CreateFunctionParams {
  name: string;
  /** JavaScript source. Exposed globals include `request`, `response`, `r` helpers. */
  payload: string;
  /** Defaults to "js". */
  driver?: FunctionDriver;
}

export interface UpdateFunctionParams {
  name?: string;
  payload?: string;
  driver?: FunctionDriver;
}

/** Result of invoking a function against a sample request. */
export interface FunctionExecuteResponse {
  function_id?: string;
  request_id?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  request_modified?: boolean;
  response_modified?: boolean;
  stop_forwarding?: boolean;
  error?: string;
}

/** A single function configuration variable (key/value available to the function at runtime). */
export interface FunctionConfigVariable {
  key: string;
  value: string;
  function_id?: string;
  account_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GenerateFunctionParams {
  /** CamelCase alias for `additional_info`. */
  additionalInfo?: string;
  /** Natural-language description of what the function should do. */
  additional_info?: string;
  /** CamelCase alias for `input_payload`. */
  inputPayload?: string;
  /** Example inbound payload. */
  input_payload?: string;
  /** CamelCase alias for `output_payload`. */
  outputPayload?: string;
  /** Desired outbound payload. */
  output_payload?: string;
}

export interface GenerateFunctionResponse {
  /** Generated JavaScript source. */
  code: string;
  validation_ok?: boolean;
  validation_err?: string;
}

// ---------------------------------------------------------------------------
// Service connections (managed cloud inputs/outputs: AWS, GCP, Azure, Slack…)
// ---------------------------------------------------------------------------

export type ServiceType = "gcp" | "aws" | "azure";

export type ServiceConnectionStatus = "pending" | "connected" | "error";

export type ServiceConnectionOutputType =
  | "gcp_pubsub"
  | "gcp_gcs"
  | "aws_s3"
  | "aws_sqs"
  | "aws_sns"
  | "discord"
  | "slack";

export interface AWSServiceConnectionCredentials {
  /** CamelCase alias for `access_key_id`. */
  accessKeyId?: string;
  access_key_id?: string;
  /** CamelCase alias for `secret_access_key`. */
  secretAccessKey?: string;
  secret_access_key?: string;
}

export interface ServiceConnection {
  id: string;
  name: string;
  account_id?: string;
  service_type?: ServiceType;
  status?: ServiceConnectionStatus;
  error?: string;
  retries?: number;
  last_checked?: string;
  aws_service_connection?: AWSServiceConnectionCredentials;
  gcp_service_connection?: Record<string, unknown>;
  azure_service_connection?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface CreateServiceConnectionParams {
  name: string;
  /** CamelCase alias for `service_type`. */
  serviceType?: ServiceType;
  service_type: ServiceType;
  /** CamelCase alias for `aws_service_connection`. */
  awsServiceConnection?: AWSServiceConnectionCredentials;
  aws_service_connection?: AWSServiceConnectionCredentials;
  /** CamelCase alias for `gcp_service_connection`. */
  gcpServiceConnection?: Record<string, unknown>;
  gcp_service_connection?: Record<string, unknown>;
  /** CamelCase alias for `azure_service_connection`. */
  azureServiceConnection?: Record<string, unknown>;
  azure_service_connection?: Record<string, unknown>;
}

export type UpdateServiceConnectionParams = Partial<CreateServiceConnectionParams>;

export interface ServiceConnectionInput {
  id: string;
  name?: string;
  bucket_id?: string;
  service_connection_id?: string;
  function_id?: string;
  status?: string;
  error?: string;
  aws_s3_input?: Record<string, unknown>;
  aws_sns_input?: Record<string, unknown>;
  aws_sqs_input?: Record<string, unknown>;
  gcp_gcs_input?: Record<string, unknown>;
  gcp_pubsub_input?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ServiceConnectionOutput {
  id: string;
  name?: string;
  bucket_id?: string;
  service_connection_id?: string;
  function_id?: string;
  service_connection_output_type?: ServiceConnectionOutputType;
  aws_s3_output?: Record<string, unknown>;
  aws_sns_output?: Record<string, unknown>;
  aws_sqs_output?: Record<string, unknown>;
  gcp_gcs_output?: Record<string, unknown>;
  gcp_pubsub_output?: Record<string, unknown>;
  slack_output?: Record<string, unknown>;
  discord_output?: Record<string, unknown>;
  created_at?: UnixSeconds;
  updated_at?: UnixSeconds;
}

// ---------------------------------------------------------------------------
// Webhook logs
// ---------------------------------------------------------------------------

/** Delivery status of a webhook log entry. */
export enum RequestStatus {
  Preparing = 0,
  Sent = 1,
  Failed = 2,
  Stalled = 3,
  Received = 4,
  Rejected = 5,
}

export interface WebhookLog {
  id: string;
  account_id?: string;
  bucket_id?: string;
  input_id?: string;
  output_id?: string;
  method?: string;
  status?: RequestStatus;
  status_code?: number;
  body?: string;
  headers?: Headers;
  raw_query?: string;
  extra_path?: string;
  ip_address?: string;
  response_body?: number[] | string;
  response_headers?: Headers;
  duration_ms?: number;
  retries?: number;
  ephemeral?: boolean;
  internal?: boolean;
  service_connection_input_type?: string;
  service_connection_output_type?: string;
  input_function_execution_id?: string;
  output_function_execution_id?: string;
  created_at?: UnixSeconds;
  updated_at?: UnixSeconds;
}

export interface ListWebhookLogsParams {
  /** Bucket ID or account-unique bucket name. Required. */
  bucket: string;
  limit?: number;
  offset?: number;
  /** RFC3339 / unix start of the time window. */
  from?: string;
  /** RFC3339 / unix end of the time window. */
  to?: string;
  status?: string;
  /** Opaque pagination cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

export interface WebhookLogsPage {
  data: WebhookLog[];
  total?: number;
  limit?: number;
  offset?: number;
  next_cursor?: string;
  truncated?: boolean;
}
