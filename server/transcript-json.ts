/**
 * Feature: spec/features/fspec-live-transcript.feature
 *
 * Parses one assembled transcript entry — a serde-JSON StreamChunk from the
 * daemon journal (rust/rpc-types StreamChunk, externally tagged) — into the
 * same StreamChunk shape the bincode codec yields for live frames, so replay
 * and the live stream share one mapper.
 */
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

type Json = Record<string, unknown>;

function object(value: unknown, what: string): Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`transcript entry ${what} is not an object`);
  }
  return value as Json;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const optNum = (value: unknown): number | null => (typeof value === "number" ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function severity(value: unknown): NotificationSeverity {
  const lower = str(value).toLowerCase();
  return lower === "warning" || lower === "error" ? lower : "info";
}

function correlation(body: Json) {
  return {
    correlationId: typeof body["correlationId"] === "string" ? body["correlationId"] : null,
    observedCorrelationIds: Array.isArray(body["observedCorrelationIds"])
      ? strings(body["observedCorrelationIds"])
      : null,
  };
}

export function parseStreamChunkJson(json: string): StreamChunk {
  const value: unknown = JSON.parse(json);
  const [name, raw] =
    typeof value === "string" ? [value, {}] : (Object.entries(object(value, "chunk"))[0] ?? ["", {}]);
  const index = VARIANTS.indexOf(name as (typeof VARIANTS)[number]);
  if (index < 0) throw new Error(`unknown transcript StreamChunk variant "${name}"`);
  const body = typeof raw === "object" && raw !== null ? (raw as Json) : {};
  switch (name) {
    case "ResponseAttemptStarted":
      return { type: "responseAttemptStarted" };
    case "ResponseAttemptAborted":
      return { type: "responseAttemptAborted" };
    case "Text":
      return { type: "text", text: str(body["text"]), ...correlation(body) };
    case "Thinking":
      return { type: "thinking", thinking: str(body["thinking"]), ...correlation(body) };
    case "ToolCall": {
      const call = object(body["toolCall"], "toolCall");
      return {
        type: "toolCall",
        toolCall: { id: str(call["id"]), name: str(call["name"]), input: str(call["input"]) },
        ...correlation(body),
      };
    }
    case "ToolResult": {
      const result = object(body["toolResult"], "toolResult");
      return {
        type: "toolResult",
        toolResult: {
          toolCallId: str(result["tool_call_id"]),
          content: str(result["content"]),
          isError: result["is_error"] === true,
        },
        ...correlation(body),
      };
    }
    case "ToolProgress": {
      const progress = object(body["toolProgress"], "toolProgress");
      return {
        type: "toolProgress",
        toolProgress: {
          toolCallId: str(progress["tool_call_id"]),
          toolName: str(progress["tool_name"]),
          outputChunk: str(progress["output_chunk"]),
          isStderr: progress["is_stderr"] === true,
        },
        ...correlation(body),
      };
    }
    case "UserNotification":
      return {
        type: "userNotification",
        message: str(body["message"]),
        severity: severity(body["severity"]),
      };
    case "Interrupted":
      return { type: "interrupted", queuedInputs: strings(body["queuedInputs"]) };
    case "TokenUpdate": {
      const tokens = object(body["tokens"], "tokens");
      return {
        type: "tokenUpdate",
        tokens: {
          inputTokens: num(tokens["input_tokens"]),
          outputTokens: num(tokens["output_tokens"]),
          cacheReadInputTokens: optNum(tokens["cache_read_input_tokens"]),
          cacheCreationInputTokens: optNum(tokens["cache_creation_input_tokens"]),
          tokensPerSecond: optNum(tokens["tokens_per_second"]),
          cumulativeBilledInput: optNum(tokens["cumulative_billed_input"]),
          cumulativeBilledOutput: optNum(tokens["cumulative_billed_output"]),
          reasoningTokens: optNum(tokens["reasoning_tokens"]),
        },
      };
    }
    case "ContextFillUpdate": {
      const fill = object(body["contextFill"], "contextFill");
      return {
        type: "contextFillUpdate",
        contextFill: {
          fillPercentage: num(fill["fill_percentage"]),
          effectiveTokens: num(fill["effective_tokens"]),
          threshold: num(fill["threshold"]),
          contextWindow: num(fill["context_window"]),
        },
      };
    }
    case "Done":
      return { type: "done" };
    case "Error":
      return { type: "error", error: str(body["error"]) };
    case "UserInput":
      return { type: "userInput", text: str(body["text"]) };
    case "CompactionComplete": {
      const result = object(body["compactionResult"], "compactionResult");
      return {
        type: "compactionComplete",
        compactionResult: {
          originalTokens: num(result["original_tokens"]),
          compactedTokens: num(result["compacted_tokens"]),
          compressionRatio: num(result["compression_ratio"]),
          turnsSummarized: num(result["turns_summarized"]),
          turnsKept: num(result["turns_kept"]),
        },
      };
    }
    case "CompactionProgressUpdate": {
      const progress = body["progress"];
      if (progress === null || progress === undefined) {
        return { type: "compactionProgressUpdate", progress: null };
      }
      const p = object(progress, "progress");
      return {
        type: "compactionProgressUpdate",
        progress: { phase: str(p["phase"]), current: num(p["current"]), total: num(p["total"]) },
      };
    }
    case "InterruptedWithReason":
      return {
        type: "interruptedWithReason",
        queuedInputs: strings(body["queuedInputs"]),
        reason: str(body["reason"]).toLowerCase() === "loopdetector" ? "loopDetector" : "user",
      };
    case "ProviderWaiting":
      return {
        type: "providerWaiting",
        message: typeof body["message"] === "string" ? body["message"] : null,
      };
    default:
      // Variants the timeline does not render keep their wire index.
      return { type: "unsupported", index };
  }
}
