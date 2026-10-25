type Params = Record<string, unknown>;

const bucketAliases: Record<string, string> = {
  staticIp: "static_ip",
  largeWebhooks: "large_webhooks",
  workspaceId: "workspace_id",
};

const inputAliases: Record<string, string> = {
  functionId: "function_id",
  statusCode: "status_code",
  customDomain: "custom_domain",
  pathPrefix: "path_prefix",
  stripPathPrefix: "strip_path_prefix",
  responseFromOutput: "response_from_output",
};

const outputAliases: Record<string, string> = {
  functionId: "function_id",
  lockPath: "lock_path",
  tlsVerification: "tls_verification",
};

const serviceConnectionAliases: Record<string, string> = {
  serviceType: "service_type",
  awsServiceConnection: "aws_service_connection",
  gcpServiceConnection: "gcp_service_connection",
  azureServiceConnection: "azure_service_connection",
};

const managedServiceAliases: Record<string, string> = {
  serviceConnectionId: "service_connection_id",
  functionId: "function_id",
  serviceConnectionOutputType: "service_connection_output_type",
  awsS3Input: "aws_s3_input",
  awsSnsInput: "aws_sns_input",
  awsSqsInput: "aws_sqs_input",
  gcpGcsInput: "gcp_gcs_input",
  gcpPubsubInput: "gcp_pubsub_input",
  awsS3Output: "aws_s3_output",
  awsSnsOutput: "aws_sns_output",
  awsSqsOutput: "aws_sqs_output",
  gcpGcsOutput: "gcp_gcs_output",
  gcpPubsubOutput: "gcp_pubsub_output",
  slackOutput: "slack_output",
  discordOutput: "discord_output",
};

const functionAliases: Record<string, string> = {
  additionalInfo: "additional_info",
  inputPayload: "input_payload",
  outputPayload: "output_payload",
};

const outboundEndpointAliases: Record<string, string> = {
  eventTypes: "event_types",
  autoDisable: "auto_disable",
  functionId: "function_id",
};

const outboundMessageAliases: Record<string, string> = {
  eventType: "event_type",
  eventId: "event_id",
};

export function bucketParams<T extends object>(params: T): T {
  return applyAliases(params, bucketAliases) as T;
}

export function inputParams<T extends object>(params: T): T {
  return applyAliases(params, inputAliases) as T;
}

export function outputParams<T extends object>(params: T): T {
  return applyAliases(params, outputAliases) as T;
}

export function serviceConnectionParams<T extends object>(params: T): T {
  return applyAliases(params, serviceConnectionAliases) as T;
}

export function managedServiceParams<T extends object>(params: T): T {
  return applyAliases(params, managedServiceAliases) as T;
}

export function functionParams<T extends object>(params: T): T {
  return applyAliases(params, functionAliases) as T;
}

export function outboundEndpointParams<T extends object>(params: T): T {
  return applyAliases(params, outboundEndpointAliases) as T;
}

export function outboundMessageParams<T extends object>(params: T): T {
  return applyAliases(params, outboundMessageAliases) as T;
}

/**
 * Overlay update params on the current state of a resource whose `PUT`
 * replaces it whole, so callers can send only the fields they change.
 * `undefined` values in `params` keep the current value; keys in `omit`
 * (read-only or server-owned fields) are dropped from `current`.
 */
export function mergeForReplace(
  current: object,
  params: object,
  omit: readonly string[] = [],
): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && !omit.includes(key)) out[key] = value;
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function applyAliases(params: object, aliases: Record<string, string>): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    const wireKey = aliases[key] ?? key;
    if (out[wireKey] === undefined) out[wireKey] = value;
  }
  return out;
}
