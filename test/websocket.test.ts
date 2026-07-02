import { describe, expect, it } from "vitest";
import {
  socketUrlFromBase,
  resolveWebSocketCtor,
} from "../src/streaming/websocket.js";

describe("socketUrlFromBase", () => {
  it("maps https → wss and points at /v1/socket", () => {
    expect(socketUrlFromBase("https://my.webhookrelay.com")).toBe(
      "wss://my.webhookrelay.com/v1/socket",
    );
  });

  it("maps http → ws and preserves the port", () => {
    expect(socketUrlFromBase("http://localhost:8080")).toBe(
      "ws://localhost:8080/v1/socket",
    );
  });

  it("replaces any existing path/query", () => {
    expect(socketUrlFromBase("https://relay.example.com/api?x=1")).toBe(
      "wss://relay.example.com/v1/socket",
    );
  });
});

describe("resolveWebSocketCtor", () => {
  it("returns a provided override verbatim", async () => {
    const Fake = class {} as never;
    expect(await resolveWebSocketCtor(Fake)).toBe(Fake);
  });

  it("falls back to the `ws` package when no global WebSocket exists", async () => {
    // Node < 21 has no global WebSocket, so this exercises the dynamic import.
    const ctor = await resolveWebSocketCtor();
    expect(typeof ctor).toBe("function");
  });
});
