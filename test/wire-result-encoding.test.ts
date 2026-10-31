/**
 * Feature: spec/features/fspec-wire-result-encoding.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 *
 * The vectors are produced by Rust bincode 1.3.3 (see the FSPEC-007
 * attachment), so they pin the real daemon encoding, not the codec's own.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as wire from "../server/wire.js";

function vectors(): Map<string, string> {
  const text = readFileSync(
    fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)),
    "utf8",
  );
  const map = new Map<string, string>();
  for (const line of text.trim().split("\n")) {
    const space = line.indexOf(" ");
    map.set(line.slice(0, space), line.slice(space + 1).trim());
  }
  return map;
}
const V = vectors();
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

describe("Feature: Decode and encode tarpc Result payloads with bincode u32 variant tags", () => {
  describe("Scenario: A successful tarpc response decodes from the u32 Ok tag", () => {
    it("decodes and re-encodes the Ok golden vector", () => {
      // @step Given the Rust golden vector for Response { request_id: 7, message: Ok(CreateSession(SessionId { value: "s" })) } is 07000000000000000000000003000000010000000000000073
      const golden = V.get("resp_ok_create")!;
      expect(golden).toBe("07000000000000000000000003000000010000000000000073");
      // @step When the codec decodes that response frame
      const decoded = wire.decodeResponseFrame(bytes(golden));
      // @step Then it yields { requestId: 7, ok: true, method: "createSession", sessionId: "s" }
      expect(decoded).toEqual({ requestId: 7, ok: true, method: "createSession", sessionId: "s" });
      // @step And encoding that response reproduces the golden bytes exactly
      expect(
        hex(wire.encodeResponseFrame({ requestId: 7, message: "createSession", value: "s" })),
      ).toBe(golden);
    });
  });

  describe("Scenario: A server-aborted tarpc response decodes from the u32 Err tag", () => {
    it("decodes and re-encodes the ServerError golden vector", () => {
      // @step Given the Rust golden vector for Response { request_id: 7, message: Err(ServerError { kind: 0, detail: "x" }) } is 07000000000000000100000000000000010000000000000078
      const golden = V.get("resp_err")!;
      expect(golden).toBe("07000000000000000100000000000000010000000000000078");
      // @step When the codec decodes that response frame
      const decoded = wire.decodeResponseFrame(bytes(golden));
      // @step Then it yields { requestId: 7, ok: false, error: "x" }
      expect(decoded).toEqual({ requestId: 7, ok: false, error: "x" });
      // @step And encoding that error response reproduces the golden bytes exactly
      expect(
        hex(wire.encodeResponseFrame({ requestId: 7, message: "createSession", error: "x" })),
      ).toBe(golden);
    });
  });

  describe("Scenario: A service-level Result payload uses the u32 variant index", () => {
    it("matches Result<(), String> golden vectors inside destroy_session", () => {
      // @step Given the Rust golden vectors Ok(()) = 00000000 and Err("no") = 0100000002000000000000006e6f for Result<(), String>
      const ok = V.get("result_void_ok")!;
      const err = V.get("result_void_err")!;
      // @step When the codec encodes and decodes destroy_session responses carrying each value
      const okFrame = wire.encodeResponseFrame({
        requestId: 1,
        message: "destroySession",
        value: { ok: true, value: undefined },
      });
      const errFrame = wire.encodeResponseFrame({
        requestId: 1,
        message: "destroySession",
        value: { ok: false, error: "no" },
      });
      // @step Then the payload bytes after the method index equal the golden vectors
      // request_id (8) + Result::Ok tag (4) + FspecServiceResponse index (4)
      const header = 16;
      expect(hex(okFrame.subarray(header))).toBe(ok);
      expect(hex(errFrame.subarray(header))).toBe(err);
      // @step And they decode to result { ok: true } and result { ok: false, error: "no" }
      expect(wire.decodeResponseFrame(okFrame)).toMatchObject({
        method: "destroySession",
        result: { ok: true },
      });
      expect(wire.decodeResponseFrame(errFrame)).toMatchObject({
        method: "destroySession",
        result: { ok: false, error: "no" },
      });
    });
  });
});
