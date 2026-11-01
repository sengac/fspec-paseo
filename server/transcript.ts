/**
 * Feature: spec/features/fspec-live-transcript.feature
 *
 * Folds one fspec session's StreamChunks into complete Paseo timeline
 * snapshots: deltas are accumulated here and re-published under a stable id so
 * Paseo derives the live delta. The same fold serves the live stream and
 * history replay.
 */
import type {
  ProviderTimelineItem,
  ProviderToolCallDetail,
  ProviderUsage,
} from "@getpaseo/plugin/server/provider";
import type { StreamChunk } from "./wire.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface TranscriptOutput {
  items: ProviderTimelineItem[];
  usage: ProviderUsage[];
}

interface Segment {
  kind: "assistant" | "reasoning";
  id: string;
  text: string;
}

interface ToolState {
  id: string;
  callId: string;
  /**
   * fspec's tool name, or null for a result whose ToolCall this session never
   * saw: fspec's chunk broadcast has no backlog, so a listener that joined
   * mid-tool gets only the result (FSPEC-070).
   */
  name: string | null;
  input: JsonValue;
  command: string | undefined;
  output: string | undefined;
  status: "running" | "completed" | "failed" | "canceled";
  error: string | null;
  revertToken?: JsonValue;
}

/** The item name of a result whose call this session never saw (FSPEC-070). */
const UNMATCHED_RESULT = "unmatched tool result";

/** fspec marks stderr lines in tool output with this sentinel (rust/tools/src/bash_output.rs). */
const STDERR_MARKER = "⚠stderr⚠";

function withoutStderrMarkers(text: string): string {
  return text.split(STDERR_MARKER).join("");
}

function parseInput(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

/** fspec's AgentManager tool (rust/tools/src/agent_manager/mod.rs). */
const AGENT_MANAGER = "AgentManager";

function isSpawnOf(state: ToolState, sessionId: string): boolean {
  const input = state.input;
  if (state.name !== AGENT_MANAGER || state.status !== "completed" || state.output === undefined) return false;
  if (input === null || typeof input !== "object" || Array.isArray(input) || input["action"] !== "spawn") return false;
  let result: unknown;
  try {
    result = JSON.parse(state.output);
  } catch {
    // Not a Spawned result (e.g. an error text): it names no session.
    return false;
  }
  return result !== null && typeof result === "object" && (result as Record<string, unknown>)["session_id"] === sessionId;
}

function shellCommand(input: JsonValue): string | undefined {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const command = input["command"];
    if (typeof command === "string") return command;
  }
  return undefined;
}

/**
 * The agent's fspec tool: { command, ...args, work_unit_id }. Shown as
 * "fspec <command> <args>" with its output instead of a raw JSON dump.
 */
function fspecDetail(tool: ToolState): ProviderToolCallDetail | undefined {
  if (tool.name?.toLowerCase() !== "fspec") return undefined;
  const input = tool.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const { command, work_unit_id: workUnit, ...args } = input;
  if (typeof command !== "string") return undefined;
  const base = Object.keys(args).length > 0 ? `fspec ${command} ${JSON.stringify(args)}` : `fspec ${command}`;
  const label = typeof workUnit === "string" && workUnit !== "NONE" ? `${base} · ${workUnit}` : base;
  return { type: "plain_text", label, icon: "wrench", ...(tool.output !== undefined ? { text: tool.output } : {}) };
}

/** fspec requires every tool call to name the work unit it is charged to. */
function workUnitOf(tool: ToolState): string | undefined {
  const input = tool.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const workUnit = input["work_unit_id"];
  return typeof workUnit === "string" ? workUnit : undefined;
}

function unmatchedDetail(tool: ToolState): ProviderToolCallDetail | undefined {
  if (tool.name !== null) return undefined;
  const label = `${UNMATCHED_RESULT} · ${tool.callId}`;
  return { type: "plain_text", label, ...(tool.output !== undefined ? { text: tool.output } : {}) };
}

function toolItem(tool: ToolState): ProviderTimelineItem {
  const detail: ProviderToolCallDetail =
    unmatchedDetail(tool) ??
    fspecDetail(tool) ??
    (tool.command !== undefined
      ? { type: "shell", command: tool.command, ...(tool.output !== undefined ? { output: tool.output } : {}) }
      : { type: "unknown", input: tool.input, output: tool.output ?? null });
  const base = {
    type: "tool_call" as const,
    id: tool.id,
    callId: tool.callId,
    name: tool.name ?? UNMATCHED_RESULT,
    detail,
    ...(tool.revertToken !== undefined ? { revertToken: tool.revertToken } : {}),
    ...(workUnitOf(tool) !== undefined ? { metadata: { workUnitId: workUnitOf(tool)! } } : {}),
  };
  return tool.status === "failed"
    ? { ...base, status: "failed", error: tool.error ?? "tool failed" }
    : { ...base, status: tool.status, error: null };
}

/**
 * `epoch` namespaces every minted id for one session.open, so a reopened
 * session never reuses ids Paseo already stored; tool ids come from the daemon.
 */
export function createTranscript(epoch: string) {
  let counter = 0;
  let segment: Segment | null = null;
  let compaction: string | null = null;
  const tools = new Map<string, ToolState>();
  const echoes: Array<{ text: string; clientMessageId: string }> = [];

  const mint = (kind: string) => `${epoch}:${++counter}:${kind}`;

  function tool(callId: string, name: string | null): ToolState {
    let state = tools.get(callId);
    if (!state) {
      counter += 1;
      state = {
        id: `tool:${callId}`,
        callId,
        name,
        input: null,
        command: undefined,
        output: undefined,
        status: "running",
        error: null,
      };
      tools.set(callId, state);
    }
    return state;
  }

  function stream(kind: Segment["kind"], delta: string): ProviderTimelineItem {
    if (segment === null || segment.kind !== kind) {
      segment = { kind, id: mint(kind), text: "" };
    }
    segment.text += delta;
    return kind === "assistant"
      ? { type: "assistant_message", id: segment.id, text: segment.text }
      : { type: "reasoning", id: segment.id, text: segment.text };
  }

  /** Closes running tools and loading compaction before a terminal turn event. */
  function terminalize(): ProviderTimelineItem[] {
    const items: ProviderTimelineItem[] = [];
    for (const state of tools.values()) {
      if (state.status !== "running") continue;
      state.status = "canceled";
      items.push(toolItem(state));
    }
    if (compaction !== null) {
      items.push({ type: "compaction", id: compaction, status: "completed" });
      compaction = null;
    }
    segment = null;
    return items;
  }

  function fold(chunk: StreamChunk): TranscriptOutput {
    const items: ProviderTimelineItem[] = [];
    const usage: ProviderUsage[] = [];
    // Any rendered row other than a continuing text/reasoning delta closes the segment.
    const row = (item: ProviderTimelineItem) => {
      segment = null;
      items.push(item);
    };
    switch (chunk.type) {
      case "text":
        items.push(stream("assistant", chunk.text));
        break;
      case "thinking":
        items.push(stream("reasoning", chunk.thinking));
        break;
      case "toolCall": {
        const state = tool(chunk.toolCall.id, chunk.toolCall.name);
        state.name = chunk.toolCall.name;
        state.input = parseInput(chunk.toolCall.input);
        state.command = shellCommand(state.input);
        row(toolItem(state));
        break;
      }
      case "toolProgress": {
        const state = tool(chunk.toolProgress.toolCallId, chunk.toolProgress.toolName);
        state.output = (state.output ?? "") + withoutStderrMarkers(chunk.toolProgress.outputChunk);
        row(toolItem(state));
        break;
      }
      case "toolResult": {
        const state = tool(chunk.toolResult.toolCallId, null);
        state.output = withoutStderrMarkers(chunk.toolResult.content);
        state.status = chunk.toolResult.isError ? "failed" : "completed";
        state.error = chunk.toolResult.isError ? state.output : null;
        row(toolItem(state));
        break;
      }
      case "userNotification":
        row({ type: "notification", id: mint("notification"), level: chunk.severity, message: chunk.message });
        break;
      case "userInput": {
        const echo = echoes.findIndex((entry) => entry.text === chunk.text);
        const clientMessageId = echo >= 0 ? echoes.splice(echo, 1)[0]!.clientMessageId : undefined;
        row({
          type: "user_message",
          id: mint("user"),
          text: chunk.text,
          ...(clientMessageId !== undefined ? { clientMessageId } : {}),
        });
        break;
      }
      case "compactionProgressUpdate":
        if (chunk.progress !== null && compaction === null) {
          compaction = mint("compaction");
          row({ type: "compaction", id: compaction, status: "loading" });
        }
        break;
      case "compactionComplete": {
        const id = compaction ?? mint("compaction");
        compaction = null;
        row({
          type: "compaction",
          id,
          status: "completed",
          preTokens: chunk.compactionResult.originalTokens,
        });
        break;
      }
      case "tokenUpdate":
        usage.push({
          inputTokens: chunk.tokens.inputTokens,
          outputTokens: chunk.tokens.outputTokens,
          ...(chunk.tokens.cacheReadInputTokens !== null
            ? { cachedInputTokens: chunk.tokens.cacheReadInputTokens }
            : {}),
        });
        break;
      case "contextFillUpdate":
        usage.push({
          contextWindowUsedTokens: Math.round(chunk.contextFill.effectiveTokens),
          contextWindowMaxTokens: Math.round(chunk.contextFill.contextWindow),
        });
        break;
      case "error":
        row({ type: "error", id: mint("error"), message: chunk.error });
        items.push(...terminalize());
        break;
      case "done":
      case "interrupted":
      case "interruptedWithReason":
        items.push(...terminalize());
        break;
      default:
        break; // not rendered; does not close an open segment
    }
    return { items, usage };
  }

  return {
    fold,
    terminalize,
    /** The tool's name, or undefined for an unknown call id or an unmatched result. */
    toolName(callId: string): string | undefined {
      return tools.get(callId)?.name ?? undefined;
    },
    /** Marks a tool call as a revert point and returns its re-rendered item. */
    setRevertToken(callId: string, token: JsonValue): ProviderTimelineItem | undefined {
      const state = tools.get(callId);
      if (!state) return undefined;
      state.revertToken = token;
      return toolItem(state);
    },
    /**
     * The AgentManager spawn call that created daemon session `sessionId`
     * (FSPEC-063): input action "spawn" and a JSON result whose session_id is
     * it (fspec AgentManagerResult::Spawned). No output text is searched.
     */
    spawnCallOf(sessionId: string): string | undefined {
      return [...tools.values()].find((state) => isSpawnOf(state, sessionId))?.callId;
    },
    /** One tool call by its daemon id, e.g. the call an approval pause gates (FSPEC-050). */
    toolCall(callId: string): { name: string; detail: ProviderToolCallDetail; toolCallId: string } | undefined {
      const state = tools.get(callId);
      if (!state) return undefined;
      const item = toolItem(state);
      return item.type === "tool_call" ? { name: item.name, detail: item.detail, toolCallId: callId } : undefined;
    },
    /** Remembers a Paseo prompt so its daemon UserInput echo carries clientMessageId. */
    expectEcho(text: string, clientMessageId: string): void {
      echoes.push({ text, clientMessageId });
    },
  };
}

export type Transcript = ReturnType<typeof createTranscript>;
