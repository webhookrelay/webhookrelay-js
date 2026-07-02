import { describe, expect, it } from "vitest";
import {
  inputParams,
  outputParams,
  serviceConnectionParams,
  managedServiceParams,
  functionParams,
} from "../src/params.js";
import { createClient } from "./helpers.js";

describe("param normalizers (camelCase → snake_case wire keys)", () => {
  it("maps input aliases", () => {
    expect(
      inputParams({
        name: "public",
        functionId: "fn1",
        statusCode: 200,
        stripPathPrefix: true,
        responseFromOutput: "out1",
      }),
    ).toEqual({
      name: "public",
      function_id: "fn1",
      status_code: 200,
      strip_path_prefix: true,
      response_from_output: "out1",
    });
  });

  it("maps output aliases", () => {
    expect(
      outputParams({ destination: "https://x", functionId: "fn1", tlsVerification: false }),
    ).toEqual({ destination: "https://x", function_id: "fn1", tls_verification: false });
  });

  it("maps service-connection and managed aliases", () => {
    expect(serviceConnectionParams({ name: "aws", serviceType: "aws" })).toEqual({
      name: "aws",
      service_type: "aws",
    });
    expect(
      managedServiceParams({ serviceConnectionId: "sc1", serviceConnectionOutputType: "slack" }),
    ).toEqual({ service_connection_id: "sc1", service_connection_output_type: "slack" });
  });

  it("maps function generate aliases", () => {
    expect(functionParams({ additionalInfo: "do a thing", inputPayload: "{}" })).toEqual({
      additional_info: "do a thing",
      input_payload: "{}",
    });
  });

  it("passes snake_case through unchanged", () => {
    expect(inputParams({ function_id: "fn1", status_code: 201 })).toEqual({
      function_id: "fn1",
      status_code: 201,
    });
  });

  it("keeps the explicit snake_case value when both spellings are present", () => {
    // snake_case is listed first in the object, so it wins the wire key.
    expect(inputParams({ function_id: "snake", functionId: "camel" })).toEqual({
      function_id: "snake",
    });
  });
});

describe("resources accept camelCase params and send snake_case", () => {
  it("inputs.create normalizes functionId → function_id on the wire", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "in1" } }));
    await relay.inputs.create("b1", { name: "public", functionId: "fn1" });
    expect(calls[0].body).toEqual({ name: "public", function_id: "fn1" });
  });

  it("outputs.create normalizes tlsVerification → tls_verification", async () => {
    const { relay, calls } = createClient(() => ({ json: { id: "o1" } }));
    await relay.outputs.create("b1", { destination: "https://x", tlsVerification: false });
    expect(calls[0].body).toEqual({ destination: "https://x", tls_verification: false });
  });
});
