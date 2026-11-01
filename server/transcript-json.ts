/**
 * Feature: spec/features/fspec-live-transcript.feature
 *
 * Parses one assembled transcript entry — a serde-JSON StreamChunk from the
 * daemon journal (rust/rpc-types StreamChunk, externally tagged) — into the
 * same StreamChunk shape the bincode codec yields for live frames, so replay
 * and the live stream share one mapper.
 */
import {
  asObject,
  boolean,
  type Json,
  nullableNumber,
  nullableObject,
  nullableString,
  nullableStrings,
  number,
  object,
  oneOf,
  string,
  strings,
} from "./json-fields.js";
import type { NotificationSeverity, StreamChunk } from "./wire.js";

/** StreamChunk variant names in wire order (index = bincode variant index). */
const VARIANTS = [
  "ResponseAttemptStarted",
  "ResponseAttemptAborted",
  "Text",
  "Thinking",
  "ToolCall",
  "ToolResult",
  "ToolProgress",
  "SessionStateChange",
  "UserNotification",
  "Interrupted",
  "TokenUpdate",
  "ContextFillUpdate",
  "ContextSnapshot",
  "Done",
  "Error",
  "UserInput",
  "IncomingMessage",
  "SupervisorPendingInjection",
  "CompactionComplete",
  "CommittedCompaction",
  "FspecCommandRequest",
  "FspecCommandResult",
  "WorkUnitsUpdate",
  "IsolationStateChange",
  "FooterStateUpdate",
  "DebugStateChange",
  "ContinueStateUpdate",
  "ExecStdinRequest",
  "ExecStdinRequestCleared",
  "CompactionProgressUpdate",
  "InterruptedWithReason",
  "ProviderWaiting",
] as const;

/** Variants serde writes as a bare string (no body). */
const UNIT_VARIANTS = new Set(["ResponseAttemptStarted", "ResponseAttemptAborted", "Done", "ExecStdinRequestCleared"]);

const SEVERITIES = ["Info", "Warning", "Error"] as const;
const REASONS = ["user", "loopDetector"] as const;

function correlation(body: Json, where: string) {
  return {
    correlationId: nullableString(body, "correlationId", where),
    observedCorrelationIds: nullableStrings(body, "observedCorrelationIds", where),
  };
}

/**
 * One transcript entry, decoded exactly as fspec's serde writes it
 * (FSPEC-068): a bare string for a unit variant, else a one-key object whose
 * body carries every field. A missing or mistyped field is an error.
 */
export function parseStreamChunkJson(json: string): StreamChunk {
  const value: unknown = JSON.parse(json);
  let name: string;
  let body: Json | null;
  if (typeof value === "string") {
    name = value;
    body = null;
  } else if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1) {
    const [entry] = Object.entries(value);
    name = entry![0];
    body = asObject(entry![1], `transcript entry ${name} body`);
  } else {
    throw new Error("transcript entry is not a unit variant string or a one-key object");
  }
  const index = VARIANTS.indexOf(name as (typeof VARIANTS)[number]);
  if (index < 0) throw new Error(`unknown transcript StreamChunk variant "${name}"`);
  if (UNIT_VARIANTS.has(name) !== (body === null)) {
    throw new Error(body === null ? `transcript entry ${name} has no body` : `transcript entry ${name} is a unit variant but has a body`);
  }
  const where = `transcript entry ${name}`;
  const b = body ?? {};
  switch (name) {
    case "ResponseAttemptStarted":
      return { type: "responseAttemptStarted" };
    case "ResponseAttemptAborted":
      return { type: "responseAttemptAborted" };
    case "Text":
      return { type: "text", text: string(b, "text", where), ...correlation(b, where) };
    case "Thinking":
      return { type: "thinking", thinking: string(b, "thinking", where), ...correlation(b, where) };
    case "ToolCall": {
      const call = object(b, "toolCall", where);
      const at = `${where}.toolCall`;
      return {
        type: "toolCall",
        toolCall: { id: string(call, "id", at), name: string(call, "name", at), input: string(call, "input", at) },
        ...correlation(b, where),
      };
    }
    case "ToolResult": {
      const result = object(b, "toolResult", where);
      const at = `${where}.toolResult`;
      return {
        type: "toolResult",
        toolResult: {
          toolCallId: string(result, "tool_call_id", at),
          content: string(result, "content", at),
          isError: boolean(result, "is_error", at),
        },
        ...correlation(b, where),
      };
    }
    case "ToolProgress": {
      const progress = object(b, "toolProgress", where);
      const at = `${where}.toolProgress`;
      return {
        type: "toolProgress",
        toolProgress: {
          toolCallId: string(progress, "tool_call_id", at),
          toolName: string(progress, "tool_name", at),
          outputChunk: string(progress, "output_chunk", at),
          isStderr: boolean(progress, "is_stderr", at),
        },
        ...correlation(b, where),
      };
    }
    case "UserNotification":
      return {
        type: "userNotification",
        message: string(b, "message", where),
        severity: oneOf(b, "severity", where, SEVERITIES).toLowerCase() as NotificationSeverity,
      };
    case "Interrupted":
      return { type: "interrupted", queuedInputs: strings(b, "queuedInputs", where) };
    case "TokenUpdate": {
      const tokens = object(b, "tokens", where);
      const at = `${where}.tokens`;
      return {
        type: "tokenUpdate",
        tokens: {
          inputTokens: number(tokens, "input_tokens", at),
          outputTokens: number(tokens, "output_tokens", at),
          cacheReadInputTokens: nullableNumber(tokens, "cache_read_input_tokens", at),
          cacheCreationInputTokens: nullableNumber(tokens, "cache_creation_input_tokens", at),
          tokensPerSecond: nullableNumber(tokens, "tokens_per_second", at),
          cumulativeBilledInput: nullableNumber(tokens, "cumulative_billed_input", at),
          cumulativeBilledOutput: nullableNumber(tokens, "cumulative_billed_output", at),
          reasoningTokens: nullableNumber(tokens, "reasoning_tokens", at),
        },
      };
    }
    case "ContextFillUpdate": {
      const fill = object(b, "contextFill", where);
      const at = `${where}.contextFill`;
      return {
        type: "contextFillUpdate",
        contextFill: {
          fillPercentage: number(fill, "fill_percentage", at),
          effectiveTokens: number(fill, "effective_tokens", at),
          threshold: number(fill, "threshold", at),
          contextWindow: number(fill, "context_window", at),
        },
      };
    }
    case "Done":
      return { type: "done" };
    case "Error":
      return { type: "error", error: string(b, "error", where) };
    case "UserInput":
      return { type: "userInput", text: string(b, "text", where) };
    case "CompactionComplete": {
      const result = object(b, "compactionResult", where);
      const at = `${where}.compactionResult`;
      return {
        type: "compactionComplete",
        compactionResult: {
          originalTokens: number(result, "original_tokens", at),
          compactedTokens: number(result, "compacted_tokens", at),
          compressionRatio: number(result, "compression_ratio", at),
          turnsSummarized: number(result, "turns_summarized", at),
          turnsKept: number(result, "turns_kept", at),
        },
      };
    }
    case "CompactionProgressUpdate": {
      const progress = nullableObject(b, "progress", where);
      if (progress === null) return { type: "compactionProgressUpdate", progress: null };
      const at = `${where}.progress`;
      return {
        type: "compactionProgressUpdate",
        progress: { phase: string(progress, "phase", at), current: number(progress, "current", at), total: number(progress, "total", at) },
      };
    }
    case "InterruptedWithReason":
      return {
        type: "interruptedWithReason",
        queuedInputs: strings(b, "queuedInputs", where),
        reason: oneOf(b, "reason", where, REASONS),
      };
    case "ProviderWaiting":
      return { type: "providerWaiting", message: nullableString(b, "message", where) };
    default:
      // Variants the timeline does not render keep their wire index.
      return { type: "unsupported", index };
  }
}
