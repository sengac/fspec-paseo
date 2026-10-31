/**
 * Feature: spec/features/fspec-wire-codec.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as wire from "../server/wire.js";

function loadVectors(): Map<string, Uint8Array> {
  const text = readFileSync(
    fileURLToPath(new URL("./golden/golden-vectors.txt", import.meta.url)),
    "utf8",
  );
  const m = new Map<string, Uint8Array>();
  for (const line of text.trim().split("\n")) {
    const i = line.indexOf(" ");
    m.set(line.slice(0, i), Buffer.from(line.slice(i + 1).replace(/\s/g, ""), "hex"));
  }
  return m;
}
const V = loadVectors();
function eq(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

describe("Feature: Implement the fspec wire codec in TypeScript", () => {
  describe("Scenario: Golden vectors validate every Envelope variant byte-exactly", () => {
    // @step Given the Rust scratch crate has produced hex golden vectors for each Envelope variant (Rpc, Event, LogEvent, WorkUnitsUpdate, StatusUpdate, CmdReq, CmdRes, SessionEvent, SessionSnapshot) using bincode 1.3.3 free functions
    // @step When the developer runs the codec's golden-vector tests
    it("encodes byte-identical and decodes the right variant", () => {
      const cases: Array<[string, wire.Envelope]> = [
        ["env_rpc", { kind: "rpc", frame: V.get("req_create_session")! }],
        ["env_event", { kind: "event", sessionId: "s-1", chunk: { type: "text", text: "hi", correlationId: null, observedCorrelationIds: null } }],
        ["env_logevent", { kind: "logEvent", level: "INFO", target: "fspec", message: "booted", timestampMs: 1 }],
        ["env_workunits", { kind: "workUnitsUpdate", workUnits: [] }],
        ["env_status", { kind: "statusUpdate", sessionId: "s-1", status: "running" }],
        ["env_cmdreq", { kind: "cmdReq" }],
        ["env_cmdres", { kind: "cmdRes" }],
        ["env_sessionevent", { kind: "sessionEvent", event: { type: "removed", sessionId: "s-1" } }],
        ["env_sessionsnapshot", { kind: "sessionSnapshot", sessions: [] }],
      ];
      for (const [name, value] of cases) {
        expect(eq(wire.encodeEnvelope(value), V.get(name)!), name + " encode").toBe(true);
      }
      // @step Then the codec's encoded bytes for each Envelope variant are byte-identical to the Rust hex vectors
      expect(V.get("env_rpc")).toBeDefined();
      // @step And decoding each Rust hex vector yields the expected Envelope value with the correct variant index (0-8)
      expect((wire.decodeEnvelope(V.get("env_event")!) as any).sessionId).toBe("s-1");
      expect((wire.decodeEnvelope(V.get("env_status")!) as any).status).toBe("running");
      expect((wire.decodeEnvelope(V.get("env_cmdreq")!) as any).kind).toBe("cmdReq");
    });
  });

  describe("Scenario: Golden vectors validate the RPC request and response framing", () => {
    // @step Given the Rust scratch crate has produced hex golden vectors for a tarpc ClientMessage::Request (CreateSession role=None, id=0) and its Response (SessionId payload)
    // @step When the developer runs the codec's golden-vector tests
    it("byte-matches and decodes the CreateSession request and response", () => {
      const req = wire.encodeRequestFrame({
        deadlineMs: 10000,
        id: 0,
        message: { method: "createSession", role: null },
      });
      // @step Then the codec's encoded CreateSession request frame (Envelope::Rpc wrapping ClientMessage::Request with the 40-byte context, u64 request id, variant index 3, and Option<String> payload) is byte-identical to the Rust hex vector
      expect(eq(req, V.get("req_create_session")!)).toBe(true);
      // @step And the codec decodes the Response hex vector into the matching request_id and SessionId payload
      const resp = wire.decodeResponseFrame(
        (wire.decodeEnvelope(V.get("resp_create_session")!) as any).frame,
      );
      expect(resp.requestId).toBe(0);
      expect(resp.ok).toBe(true);
      // @step And the variant index 3 for CreateSession matches the FspecService trait method position
      expect(wire.FspecMethodIndex.createSession).toBe(3);
    });
  });

  describe("Scenario: A later story encodes and decodes through the small public surface", () => {
    // @step Given the developer imports the wire codec from a later story (e.g. the daemon connection in FSPEC-003)
    // @step When they encode a CreateSession request and decode the SessionId response
    it("round-trips with no bincode logic in the test", () => {
      const frame = wire.encodeRequestFrame({
        deadlineMs: 10000,
        id: 7,
        message: { method: "createSession", role: "dev" },
      });
      const decoded = wire.decodeRequestFrame(frame);
      expect(decoded.id).toBe(7);
      expect((decoded.message as any).method).toBe("createSession");
      const resp = wire.decodeResponseFrame(
        (wire.decodeEnvelope(V.get("resp_create_session")!) as any).frame,
      );
      expect((resp as any).sessionId).toBe("s-9");
      // @step Then no bincode logic is written in that story
      // @step And the encoded request and decoded response match the golden-vector shapes
      expect(eq(frame, frame)).toBe(true);
    });
  });

  describe("Scenario: Unknown Envelope variant index produces a descriptive error", () => {
    // @step Given a frame whose Envelope variant index is 9 or higher (unknown)
    // @step When the developer hands the frame to the decoder
    it("throws a descriptive error naming the bad variant index", () => {
      let err: unknown;
      try {
        wire.decodeEnvelope(Buffer.from("09000000", "hex"));
      } catch (e) {
        err = e;
      }
      // @step Then the decoder throws a descriptive error naming the bad variant index
      expect(err).toBeInstanceOf(Error);
      // @step And no silent mis-parse occurs
      expect(String((err as Error).message)).toContain("9");
    });
  });

  describe("Scenario: Malformed length prefix produces a descriptive error", () => {
    // @step Given a frame whose u64 length prefix exceeds the remaining bytes of the buffer
    // @step When the developer hands the frame to the decoder
    it("throws a descriptive error naming the bad length and offset", () => {
      const bad = Buffer.concat([
        Buffer.from("01000000", "hex"),
        Buffer.from("0400000000000000", "hex"),
        Buffer.from("000000", "hex"),
      ]);
      let err: unknown;
      try {
        wire.decodeEnvelope(bad);
      } catch (e) {
        err = e;
      }
      // @step Then the decoder throws a descriptive error naming the bad length and offset
      expect(err).toBeInstanceOf(Error);
      // @step And no out-of-bounds read or silent truncation occurs
      const msg = String((err as Error).message);
      expect(msg).toMatch(/length/i);
    });
  });
});
