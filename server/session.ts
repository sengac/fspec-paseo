/**
 * Feature: spec/features/fspec-session-lifecycle.feature
 *
 * The per-connection fspec session registry: maps each Paseo session onto a
 * daemon session (create_session / persistence reuse), applies model and
 * thinking selection, sends prompts, and settles every started turn exactly
 * once from the daemon's terminal stream chunks. Every chunk is first folded
 * into timeline snapshots by the session's transcript (FSPEC-006).
 */
import { randomUUID } from "node:crypto";
import type {
  ProviderConfigState,
  ProviderContent,
  ProviderTimelineItem,
  ProviderError,
  ProviderEvent,
  ProviderInput,
  ProviderModel,
  ProviderPermissionRequest,
  ProviderPersistence,
} from "@getpaseo/plugin/server/provider";
import {
  DEFAULT_THINKING_OPTION,
  THINKING_OPTIONS,
  buildCatalog,
  isThinkingLevel,
  parseCatalogModelId,
} from "./catalog.js";
import {
  interactionReply,
  parseInteractionSnapshot,
  permissionRequest,
  type Interaction,
} from "./interactions.js";
import { promptText, removeAttachments } from "./attachments.js";
import { DEFAULT_MODE, FSPEC_MODES, ORCHESTRATOR_ROLE, fspecMode, isBotRole, type FspecMode } from "./bot.js";
import {
  FSPEC_COMMANDS,
  applyContinue,
  parseContinue,
  parseFocus,
  parseGoal,
} from "./commands.js";
import { createTranscript, type Transcript } from "./transcript.js";
import { servingWorkspace, within } from "./workspaces.js";
import { parseStreamChunkJson } from "./transcript-json.js";
import {
  describeTranscriptError,
  type TranscriptCursor,
  type TranscriptPage,
  type TranscriptResult,
} from "./wire.js";
import type {
  DecodedResponse,
  ExecStdinRequest,
  GoalState,
  PauseState,
  WorkUnitFocus,
  SessionEvent,
  FspecServiceRequest,
  Result,
  StreamChunk,
  ThinkingLevel,
  WorkspaceEntry,
} from "./wire.js";

type Input<T extends ProviderInput["type"]> = Extract<ProviderInput, { type: T }>;
type Event<T extends ProviderEvent["type"]> = Extract<ProviderEvent, { type: T }>;
type TurnTerminal = "completed" | "failed" | "canceled";

export type DaemonRequest = <M extends FspecServiceRequest["method"]>(
  message: Extract<FspecServiceRequest, { method: M }>,
) => Promise<Extract<DecodedResponse, { ok: true; method: M }>>;

export interface SessionDeps {
  capabilities: readonly string[];
  request: DaemonRequest;
  emit: (event: ProviderEvent) => void;
}

interface QueuedTurn {
  turnId: string;
  /** The prompt text handed to the daemon; matched against its UserInput echo. */
  text?: string;
  /** Set when the daemon never accepted the input; reported when the turn is due. */
  failure?: ProviderError;
  /**
   * Held by fspec after an interrupt (RIG-016): never started until the next
   * prompt resumes the parked inputs with submit_input Queue (FSPEC-051).
   */
  parked?: boolean;
}

interface FspecSession {
  readonly sessionId: string;
  readonly daemonSessionId: string;
  readonly cwd: string;
  /**
   * False for a sub-agent: fspec owns its daemon session, so it is destroyed
   * here only along with the owned session at the root of its tree.
   */
  readonly owned: boolean;
  readonly parentSessionId?: string;
  model: string | undefined;
  /** 'bot' when the daemon session carries fspec's orchestrator role (FSPEC-055). */
  mode: FspecMode;
  thinking: ThinkingLevel;
  models: readonly ProviderModel[];
  defaultModel: string | undefined;
  turnCounter: number;
  /** The started head of `queue`; null while no turn is running. */
  activeTurnId: string | null;
  /** Unsettled turns in daemon order; only the head is ever started. */
  queue: QueuedTurn[];
  /** Exactly-once guard: a turn is settled at most once. */
  readonly turns: Map<string, "active" | "settled">;
  readonly epoch: string;
  readonly transcript: Transcript;
  /** The approval gate or HITL question currently shown in Paseo, if any. */
  pause: { permissionId: string; interaction: Interaction } | null;
  /** An interactive command waiting for typed input, shown as a question. */
  stdin: { permissionId: string; execSessionId: string } | null;
  stdinCounter: number;
  commandCounter: number;
  /** Numbers images saved for this session's prompts. */
  readonly attachments: { images: number };
  /** Bumped on every Paused report so a late get_pause_state reply is dropped. */
  pauseGeneration: number;
  pausedNow: boolean;
  /** Texts steered into the running turn (FSPEC-051). */
  steers: string[];
  /**
   * Set when a turn that was steered completes: fspec starts the steers it
   * never reached as their own turn, ahead of the queue, so the next turn is
   * only known from the daemon's UserInput.
   */
  awaitSteerTurn: boolean;
}

/** Chunks that mean a sub-agent is working, so its supervisor-driven run shows as a turn. */
const WORK_CHUNKS = new Set<StreamChunk["type"]>([
  "responseAttemptStarted",
  "text",
  "thinking",
  "toolCall",
  "toolResult",
  "toolProgress",
  "userInput",
  "providerWaiting",
]);

function isWork(chunk: StreamChunk): boolean {
  return WORK_CHUNKS.has(chunk.type) || (chunk.type === "sessionStateChange" && chunk.state === "running");
}

/** How a sub-agent is named in Paseo: its child session title and request prefix. */
function subAgentTitle(daemonSessionId: string): string {
  return `Sub-agent ${daemonSessionId.slice(0, 8)}`;
}

/** Longest matched prompt shown as an import-list description. */
const PROMPT_PREVIEW_CHARS = 200;

/** A matched prompt cut to the preview length around the query, so Paseo's own filter still sees it. */
function promptPreview(text: string, query: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= PROMPT_PREVIEW_CHARS) return trimmed;
  const at = trimmed.toLowerCase().indexOf(query);
  const start = Math.max(0, Math.min(at - 60, trimmed.length - PROMPT_PREVIEW_CHARS));
  return trimmed.slice(start, start + PROMPT_PREVIEW_CHARS);
}

/** Why an open fails when fspec declined to create a session for want of a default model. */
const NO_DEFAULT_MODEL = "fspec could not create a session: fspec has no default model — choose one under fspec providers";

/** The single question of a stdin request; Paseo returns its answer under this header. */
const STDIN_HEADER = "Input";

/** The daemon accepts 1024..=65536; replay asks for the largest page. */
const TRANSCRIPT_PAGE_BYTES = 65536;

export { within };

/** One folder per open, so reused or concurrent session ids never share images. */
function attachmentKey(session: FspecSession): string {
  return `${session.sessionId}-${session.epoch}`;
}

export function unknownSession(sessionId: string): Error {
  return new Error(`Unknown session: ${sessionId}`);
}

function unwrap(result: Result<void>, what: string): void {
  if (!result.ok) throw new Error(`fspec daemon ${what} failed: ${result.error}`);
}

/** Reads the daemon session id (and saved selection) out of v1 persistence. */
function readPersistence(persistence: ProviderPersistence): {
  sessionId: string;
  model?: string;
  thinkingOption?: string;
} {
  const data = persistence.data as Record<string, unknown> | null;
  if (
    persistence.version !== 1 ||
    data === null ||
    typeof data !== "object" ||
    typeof data["sessionId"] !== "string"
  ) {
    throw new Error("unsupported fspec session persistence — expected { version: 1, data: { sessionId } }");
  }
  return {
    sessionId: data["sessionId"],
    ...(typeof data["model"] === "string" ? { model: data["model"] } : {}),
    ...(typeof data["thinkingOption"] === "string" ? { thinkingOption: data["thinkingOption"] } : {}),
  };
}

function thinkingLevel(option: string): ThinkingLevel {
  if (!isThinkingLevel(option)) {
    throw new Error(`invalid fspec thinking option "${option}" — expected off, low, medium, or high`);
  }
  return option;
}


export function createSessionRegistry(deps: SessionDeps) {
  const { request, emit } = deps;
  const sessions = new Map<string, FspecSession>();
  const byDaemonId = new Map<string, FspecSession>();
  /** Daemon sessions driven by other clients: never looked up again. */
  const foreign = new Set<string>();
  /** Chunks for daemon sessions whose supervisor lookup is still running. */
  const pendingLookup = new Map<string, StreamChunk[]>();
  /** Checkpoints already seen ("<work unit>/<name>"); new ones become revert points. */
  const knownCheckpoints = new Set<string>();
  const checkpointKey = (c: { workUnitId: string; name: string }) => `${c.workUnitId}/${c.name}`;

  async function rememberCheckpoints(): Promise<void> {
    const { checkpoints } = await request({ method: "listCheckpoints" });
    for (const checkpoint of checkpoints) knownCheckpoints.add(checkpointKey(checkpoint));
  }

  /**
   * fspec creates ghost-commit checkpoints from its own commands (status
   * transitions, `fspec checkpoint`): a new one after an fspec tool call makes
   * that card a point Paseo can revert files to.
   */
  async function attachCheckpoint(session: FspecSession, callId: string): Promise<void> {
    const { checkpoints } = await request({ method: "listCheckpoints" });
    const fresh = checkpoints.filter((checkpoint) => !knownCheckpoints.has(checkpointKey(checkpoint)));
    for (const checkpoint of fresh) knownCheckpoints.add(checkpointKey(checkpoint));
    const newest = fresh[0]; // list_checkpoints is most-recent-first
    if (newest === undefined || !sessions.has(session.sessionId)) return;
    const item = session.transcript.setRevertToken(callId, { workUnitId: newest.workUnitId, name: newest.name });
    if (item) emit({ type: "timeline.item", sessionId: session.sessionId, item });
  }

  function live(sessionId: string): FspecSession {
    const session = sessions.get(sessionId);
    if (!session) throw unknownSession(sessionId);
    return session;
  }

  function persistence(session: FspecSession): ProviderPersistence {
    return {
      version: 1,
      data: {
        sessionId: session.daemonSessionId,
        ...(session.model ? { model: session.model } : {}),
        thinkingOption: session.thinking,
      },
    };
  }

  function configState(session: FspecSession): ProviderConfigState {
    return {
      ...(session.model ? { model: session.model } : {}),
      mode: session.mode,
      thinkingOption: session.thinking,
      models: session.models,
      modes: FSPEC_MODES,
      thinkingOptions: THINKING_OPTIONS,
      settings: [],
    };
  }

  async function applyModel(session: FspecSession, model: string | undefined): Promise<void> {
    if (model === undefined) return;
    const { providerId, modelId } = parseCatalogModelId(model);
    const { result } = await request({
      method: "setSessionModel",
      sessionId: session.daemonSessionId,
      providerId,
      modelId,
    });
    unwrap(result, "set_session_model");
    session.model = model;
  }

  /**
   * Bot mode is fspec's orchestrator role (set_session_role, idx 45): 'bot'
   * sets it, 'agent' clears it — and only it, so another role stays.
   */
  async function applyMode(session: FspecSession, mode: FspecMode): Promise<void> {
    const sessionId = session.daemonSessionId;
    if (mode === "bot") {
      unwrap((await request({ method: "setSessionRole", sessionId, role: ORCHESTRATOR_ROLE })).result, "set_session_role");
    } else if (isBotRole((await request({ method: "getSessionRole", sessionId })).role)) {
      unwrap((await request({ method: "setSessionRole", sessionId, role: null })).result, "set_session_role");
    }
    session.mode = mode;
  }

  async function applyThinking(session: FspecSession, level: ThinkingLevel): Promise<void> {
    const { result } = await request({
      method: "setThinkingLevel",
      sessionId: session.daemonSessionId,
      level,
    });
    unwrap(result, "set_thinking_level");
    session.thinking = level;
  }

  /** Live path: every delta snapshot is published so Paseo can stream it. */
  function publish(session: FspecSession, chunk: StreamChunk): void {
    const { items, usage } = session.transcript.fold(chunk);
    for (const item of items) {
      emit({ type: "timeline.item", sessionId: session.sessionId, item });
    }
    for (const entry of usage) {
      emit({
        type: "session.usage",
        sessionId: session.sessionId,
        ...(session.activeTurnId !== null ? { turnId: session.activeTurnId } : {}),
        usage: entry,
      });
    }
  }

  /**
   * Pages the daemon transcript from the start and folds every assembled
   * serde-JSON StreamChunk through the same mapper as the live stream. Only
   * each item's final snapshot is published (first-seen order and timestamp);
   * usage is a live signal and is not replayed.
   */
  async function replay(session: FspecSession): Promise<void> {
    const replayed = new Map<string, { item: ProviderTimelineItem; timestamp?: string }>();
    try {
      await pageTranscript(session, (chunk, timestamp) => {
        for (const item of session.transcript.fold(chunk).items) {
          const first = replayed.get(item.id);
          replayed.set(item.id, { item, timestamp: first ? first.timestamp : timestamp });
        }
      });
    } finally {
      // A partial history is still worth showing when a later page fails.
      for (const { item, timestamp } of replayed.values()) {
        emit({
          type: "timeline.item",
          sessionId: session.sessionId,
          item,
          ...(timestamp !== undefined ? { timestamp } : {}),
        });
      }
    }
  }

  async function pageTranscript(
    session: FspecSession,
    onChunk: (chunk: StreamChunk, timestamp: string | undefined) => void,
  ): Promise<void> {
    let cursor: TranscriptCursor | null = null;
    let snapshotEnd: number | null = null;
    let pending = "";
    for (;;) {
      const { result }: { result: TranscriptResult } = await request({
        method: "getTranscriptPage",
        sessionId: session.daemonSessionId,
        cursor,
        snapshotEnd,
        maxBytes: TRANSCRIPT_PAGE_BYTES,
      });
      if (!result.ok) throw new Error(describeTranscriptError(result.error));
      const page: TranscriptPage = result.value;
      const fragment = page.fragment;
      if (fragment !== null) {
        pending += fragment.jsonFragment;
        if (Buffer.byteLength(pending, "utf8") >= fragment.totalBytes) {
          onChunk(parseStreamChunkJson(pending), fragment.original?.timestamp || undefined);
          pending = "";
        }
      }
      if (page.complete) return;
      const next: TranscriptCursor = page.nextCursor;
      if (
        cursor !== null &&
        next.sequence === cursor.sequence &&
        next.byteOffset === cursor.byteOffset
      ) {
        throw new Error("invalid transcript cursor");
      }
      cursor = next;
      snapshotEnd = page.snapshotEnd;
    }
  }

  /** Resumes a saved daemon session; returns the failure text, or null on success. */
  async function resume(daemonSessionId: string): Promise<string | null> {
    try {
      const { result } = await request({ method: "resumeSession", sessionId: daemonSessionId });
      return result.ok ? null : result.error;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * fspec holds a gated tool call or a HITL question by pausing the session;
   * the only stream signal is SessionStateChange Paused, so the pending
   * interaction is read from get_interaction_snapshot and shown in Paseo.
   */
  /** The top-level Paseo session a sub-agent (at any depth) belongs to. */
  function rootOf(session: FspecSession): FspecSession {
    let root = session;
    while (root.parentSessionId !== undefined) {
      const parent = sessions.get(root.parentSessionId);
      if (parent === undefined) break;
      root = parent;
    }
    return root;
  }

  /**
   * Paseo drops a child session's permission events, so a sub-agent's
   * requests are raised on its top-level agent, labelled with who asks.
   */
  function showPermission(session: FspecSession, request: ProviderPermissionRequest): void {
    const labelled = session.owned
      ? request
      : { ...request, title: `${subAgentTitle(session.daemonSessionId)}: ${request.title ?? request.name}` };
    emit({ type: "session.permission", sessionId: rootOf(session).sessionId, request: labelled });
  }

  function permissionResolved(session: FspecSession, permissionId: string): void {
    emit({ type: "session.permission_resolved", sessionId: rootOf(session).sessionId, permissionId });
  }

  async function openPause(session: FspecSession): Promise<void> {
    const generation = ++session.pauseGeneration;
    const { result } = await request({ method: "getInteractionSnapshot", sessionId: session.daemonSessionId });
    if (!result.ok) return;
    const parsed = parseInteractionSnapshot(result.value);
    // The snapshot names no tool call: get_pause_state's tool_call_id does (fspec BUG-291).
    const pause = parsed?.kind === "pause" ? await pauseState(session) : null;
    const interaction =
      parsed?.kind === "pause" && parsed.details === null && pause?.details ? { ...parsed, details: pause.details } : parsed;
    if (interaction === null || !session.pausedNow || generation !== session.pauseGeneration) return;
    if (!sessions.has(session.sessionId) || session.pause !== null) return;
    const permissionId = `${session.epoch}:${interaction.kind}:${generation}`;
    session.pause = { permissionId, interaction };
    const gated = pause?.toolCallId ? session.transcript.toolCall(pause.toolCallId) : undefined;
    showPermission(session, permissionRequest(interaction, permissionId, gated ?? session.transcript.runningToolCall()));
  }

  /** The daemon's PauseState, or null when it has none or cannot be read. */
  async function pauseState(session: FspecSession): Promise<PauseState | null> {
    try {
      return (await request({ method: "getPauseState", sessionId: session.daemonSessionId })).pause;
    } catch {
      return null;
    }
  }

  /**
   * A chunk from a daemon session nobody here opened: when one of its
   * supervisors is an open Paseo session it is a sub-agent, shown as a child.
   */
  function adoptUnknown(daemonSessionId: string, chunk: StreamChunk): void {
    if (foreign.has(daemonSessionId)) return;
    const pending = pendingLookup.get(daemonSessionId);
    if (pending) {
      pending.push(chunk);
      return;
    }
    pendingLookup.set(daemonSessionId, [chunk]);
    void request({ method: "getSupervisors", sessionId: daemonSessionId })
      .then(({ sessions: supervisors }) => supervisors.map((id) => byDaemonId.get(id)).find((s) => s !== undefined))
      .catch(() => undefined)
      .then((parent) => {
        const buffered = pendingLookup.get(daemonSessionId) ?? [];
        pendingLookup.delete(daemonSessionId);
        if (parent === undefined) {
          foreign.add(daemonSessionId);
          return;
        }
        openChild(parent, daemonSessionId);
        for (const queued of buffered) registry.handleChunk(daemonSessionId, queued);
      });
  }

  function openChild(parent: FspecSession, daemonSessionId: string): void {
    const epoch = randomUUID().slice(0, 8);
    const child: FspecSession = {
      ...parent,
      sessionId: `${parent.sessionId}:sub:${daemonSessionId}`,
      daemonSessionId,
      owned: false,
      mode: DEFAULT_MODE,
      parentSessionId: parent.sessionId,
      turnCounter: 0,
      activeTurnId: null,
      queue: [],
      turns: new Map(),
      epoch,
      transcript: createTranscript(epoch),
      pause: null,
      stdin: null,
      stdinCounter: 0,
      commandCounter: 0,
      attachments: { images: 0 },
      pauseGeneration: 0,
      pausedNow: false,
      steers: [],
      awaitSteerTurn: false,
    };
    sessions.set(child.sessionId, child);
    byDaemonId.set(daemonSessionId, child);
    const toolCallId = parent.transcript.toolCallMentioning(daemonSessionId);
    emit({
      type: "session.opened",
      sessionId: child.sessionId,
      parentSessionId: parent.sessionId,
      ...(toolCallId ? { toolCallId } : {}),
      capabilities: deps.capabilities,
      restoration: "parent",
      title: subAgentTitle(daemonSessionId),
      cwd: child.cwd,
    });
    emit({ type: "session.config", sessionId: child.sessionId, config: configState(child) });
  }

  /** Drops a sub-agent child without touching its daemon session. */
  function closeChild(child: FspecSession): void {
    resolvePause(child);
    resolveStdin(child);
    sessions.delete(child.sessionId);
    byDaemonId.delete(child.daemonSessionId);
    removeAttachments(attachmentKey(child));
    emit({ type: "session.closed", sessionId: child.sessionId });
    // A child is never destroyed here, so its active mark is cleared by hand,
    // but only while it still holds it: another client may have moved it.
    void request({ method: "getActiveSession" })
      .then(({ sessionId }) => (sessionId === child.daemonSessionId ? request({ method: "clearActiveSession" }) : undefined))
      .catch(() => {});
  }

  /** One live todo row per session: the work unit the agent is focused on. */
  function publishFocus(session: FspecSession, focus: WorkUnitFocus): void {
    const context = focus.context;
    const entry =
      context === null
        ? { text: "No work unit in focus", completed: false, status: "pending" as const }
        : context.status === "done"
          ? { text: `${context.id} — ${context.title}`, completed: true, status: "completed" as const }
          : { text: `${context.id} — ${context.title}`, completed: false, status: "in_progress" as const };
    emit({ type: "timeline.item", sessionId: session.sessionId, item: { type: "todo", id: `${session.epoch}:focus`, items: [entry] } });
  }

  async function seedFocus(session: FspecSession): Promise<void> {
    const { result } = await request({ method: "getWorkUnitFocus", sessionId: session.daemonSessionId });
    // Nothing to show until a work unit is focused; changes arrive as focusChanged.
    if (result.ok && result.value.context !== null && sessions.has(session.sessionId)) {
      publishFocus(session, result.value);
    }
  }

  /** Mirrors the fspec TUI: the session being driven shows as live on fspec's board. */
  function markActive(session: FspecSession): void {
    void request({ method: "setActiveSession", sessionId: session.daemonSessionId }).catch(() => {});
  }

  /**
   * Runs one fspec session command; returns the notice text to show, or
   * throws with the reason it was refused.
   */
  async function runCommand(session: FspecSession, name: string, args: string): Promise<string | null> {
    const sessionId = session.daemonSessionId;
    switch (name) {
      case "compact": {
        const { result } = await request({ method: "compactSession", sessionId });
        if (!result.ok) throw new Error(result.error);
        return `Compacted ${result.value.originalTokens} -> ${result.value.compactedTokens} tokens`;
      }
      case "clear": {
        unwrap((await request({ method: "clearHistory", sessionId })).result, "clear_history");
        return "History cleared";
      }
      case "continue": {
        const { state } = await request({ method: "getContinueState", sessionId });
        const { goal } = await request({ method: "getGoalState", sessionId });
        const next = applyContinue(state, goal !== null, parseContinue(args));
        if ("error" in next) throw new Error(next.error);
        unwrap(
          (await request({ method: "setContinueState", sessionId, enabled: next.enabled, budget: next.budget })).result,
          "set_continue_state",
        );
        return next.message;
      }
      case "goal": {
        const command = parseGoal(args);
        if (command.kind === "show") {
          const { goal } = await request({ method: "getGoalState", sessionId });
          return goal === null ? "No goal set" : `Goal: ${goal.text}${goal.verify ? ` (verify: ${goal.verify})` : ""}`;
        }
        let goal: GoalState | null = null;
        if (command.kind === "set") goal = { text: command.text, verify: null };
        if (command.kind === "verify") {
          const current = (await request({ method: "getGoalState", sessionId })).goal;
          if (current === null) throw new Error("No goal to verify — set one with /goal <text>");
          goal = { text: current.text, verify: command.command };
        }
        unwrap((await request({ method: "setGoalState", sessionId, goal })).result, "set_goal_state");
        return goal === null ? "Goal cleared" : `Goal: ${goal.text}${goal.verify ? ` (verify: ${goal.verify})` : ""}`;
      }
      case "focus": {
        const workUnitId = parseFocus(args);
        if (workUnitId === undefined) throw new Error("Usage: /focus <work-unit-id|none>");
        const { result } = await request({ method: "setWorkUnitFocus", sessionId, workUnitId, source: "paseo" });
        if (!result.ok) throw new Error(result.error);
        return workUnitId === null ? "Work unit focus cleared" : `Focused on ${workUnitId}`;
      }
      default:
        throw new Error(`Unknown fspec command /${name}`);
    }
  }

  /** A quiet exec command may be waiting for stdin: ask Paseo for the input. */
  function openStdin(session: FspecSession, request: ExecStdinRequest): void {
    resolveStdin(session);
    const permissionId = `${session.epoch}:stdin:${++session.stdinCounter}`;
    session.stdin = { permissionId, execSessionId: request.execSessionId };
    showPermission(session, {
      id: permissionId,
      name: "stdin",
      kind: "question",
      title: `Input for ${request.command}`,
      input: {
        questions: [
          {
            header: STDIN_HEADER,
            question: `${request.command} has been quiet for ${request.quietSeconds}s and may be waiting for input. What should be typed?`,
            options: [],
            multiSelect: false,
            allowOther: true,
            allowEmpty: true,
          },
        ],
      },
    });
  }

  function resolveStdin(session: FspecSession): void {
    const open = session.stdin;
    if (open === null) return;
    session.stdin = null;
    permissionResolved(session, open.permissionId);
  }

  /** Every shown pause is resolved exactly once, however it ends. */
  function resolvePause(session: FspecSession): void {
    session.pausedNow = false;
    const open = session.pause;
    if (open === null) return;
    session.pause = null;
    permissionResolved(session, open.permissionId);
  }

  /** Settles the running turn, then starts the next queued one. */
  function settle(session: FspecSession, state: TurnTerminal, error?: ProviderError): void {
    const turnId = session.activeTurnId;
    if (turnId === null || session.turns.get(turnId) !== "active") return;
    session.turns.set(turnId, "settled");
    session.queue.shift();
    session.activeTurnId = null;
    const steered = session.steers.length > 0;
    session.steers = [];
    emit({
      type: "session.turn",
      sessionId: session.sessionId,
      turnId,
      state,
      ...(error ? { error } : {}),
    });
    // fspec runs the steers a finished turn never reached as a turn of their
    // own, ahead of the queue (continue_with_inbox); an interrupt parks them.
    if (steered && state !== "canceled") session.awaitSteerTurn = true;
    advance(session);
  }

  /** Queues a new turn and starts it once every earlier turn has settled. */
  function enqueueTurn(session: FspecSession, text?: string): QueuedTurn {
    session.turnCounter += 1;
    const queued: QueuedTurn = { turnId: `turn-${session.turnCounter}`, ...(text !== undefined ? { text } : {}) };
    session.queue.push(queued);
    session.turns.set(queued.turnId, "active");
    return queued;
  }

  /**
   * The daemon's UserInput after a steered turn completed names the next
   * daemon turn: the queue head when it is that prompt, otherwise the
   * leftover steers, which run as an extra turn first.
   */
  function startAfterSteers(session: FspecSession, text: string): void {
    session.awaitSteerTurn = false;
    const head = session.queue[0];
    if (head === undefined || head.parked === true || head.text !== text) {
      session.turnCounter += 1;
      const extra: QueuedTurn = { turnId: `turn-${session.turnCounter}`, text };
      session.queue.unshift(extra);
      session.turns.set(extra.turnId, "active");
    }
    advance(session);
  }

  /**
   * An interrupt cancels only the running turn (RIG-016): fspec keeps the
   * queued inputs parked and runs them before the next prompt, so their turns
   * wait unstarted. A prompt the daemon never accepted cannot run: it fails now.
   */
  function park(session: FspecSession, queuedInputs: readonly string[]): void {
    const active = session.activeTurnId;
    for (const queued of session.queue) if (queued.turnId !== active) queued.parked = true;
    session.awaitSteerTurn = false;
    settle(session, "canceled");
    for (const queued of session.queue.filter((entry) => entry.failure !== undefined)) {
      session.queue.splice(session.queue.indexOf(queued), 1);
      session.turns.set(queued.turnId, "settled");
      emit({ type: "session.turn", sessionId: session.sessionId, turnId: queued.turnId, state: "started" });
      emit({ type: "session.turn", sessionId: session.sessionId, turnId: queued.turnId, state: "failed", error: queued.failure! });
    }
    const waiting = session.queue.length;
    if (waiting === 0) return;
    const texts = queuedInputs.length > 0 ? queuedInputs : session.queue.map((queued) => queued.text ?? "");
    const quoted = texts.map((text) => `"${text.length > 80 ? `${text.slice(0, 77)}…` : text}"`).join(", ");
    emit({
      type: "session.notice",
      sessionId: session.sessionId,
      notice: {
        id: `${session.epoch}:parked:${session.turnCounter}`,
        severity: "info",
        title: waiting === 1 ? "1 queued prompt is waiting" : `${waiting} queued prompts are waiting`,
        description: `fspec kept ${waiting === 1 ? "it" : "them"} after the stop: ${quoted}. ${
          waiting === 1 ? "It runs" : "They run"
        }, in order, before the next prompt you send.`,
      },
    });
  }

  /** Denies whatever blocks the running turn so a steer can be read (clearPendingPermissions). */
  async function releaseBlockers(session: FspecSession): Promise<void> {
    resolveStdin(session);
    const open = session.pause;
    if (open === null) return;
    const reply = interactionReply(open.interaction, { behavior: "deny" });
    await request({
      method: "replyInteractionChecked",
      sessionId: session.daemonSessionId,
      interaction: reply.method,
      requestId: open.interaction.requestId,
      arguments: reply.arguments,
    }).catch(() => {});
    if (session.pause?.permissionId === open.permissionId) resolvePause(session);
  }

  /** delivery "steer": join the running turn at fspec's next safe point (submit_input Steer). */
  async function steerPrompt(session: FspecSession, input: Input<"session.prompt">): Promise<void> {
    const reply = (result: Event<"session.prompt_result">["result"]) =>
      emit({ type: "session.prompt_result", sessionId: session.sessionId, clientMessageId: input.prompt.clientMessageId, result });
    const turnId = session.activeTurnId;
    const prompt = input.prompt.input;
    if (turnId === null || prompt.type !== "message") {
      reply({ type: "failed", error: { message: "fspec has no running turn to steer" } });
      return;
    }
    const text = promptText(attachmentKey(session), prompt.content, session.attachments);
    session.transcript.expectEcho(text, input.prompt.clientMessageId);
    session.steers.push(text);
    try {
      const { result } = await request({ method: "submitInput", sessionId: session.daemonSessionId, text, mode: "steer" });
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      session.steers.splice(session.steers.indexOf(text), 1);
      const message = error instanceof Error ? error.message : String(error);
      reply({ type: "failed", error: { message, diagnostic: message } });
      return;
    }
    reply({ type: "steer", turnId });
    if (input.prompt.clearPendingPermissions === true) await releaseBlockers(session);
  }

  /**
   * fspec's destroy_session neither cascades nor keeps the chain of command,
   * so a closing session's sub-agents are collected before it goes. One that
   * another supervisor still needs is kept, along with its own sub-agents.
   * Returns them deepest first; a failed lookup ends the walk early.
   */
  async function subordinateTree(daemonSessionId: string): Promise<string[]> {
    const closing = new Set([daemonSessionId]);
    const order: string[] = [];
    const visit = async (supervisor: string): Promise<void> => {
      const { sessions: subordinates } = await request({ method: "getSubordinates", sessionId: supervisor });
      for (const subordinate of subordinates) {
        if (closing.has(subordinate)) continue;
        const { sessions: supervisors } = await request({ method: "getSupervisors", sessionId: subordinate });
        if (!supervisors.every((id) => closing.has(id))) continue;
        closing.add(subordinate);
        await visit(subordinate);
        order.push(subordinate);
      }
    };
    await visit(daemonSessionId).catch(() => {});
    return order;
  }

  /** Destroys an owned session's sub-agent tree; failures never block the caller. */
  async function destroySubordinates(daemonSessionId: string): Promise<void> {
    for (const subordinate of await subordinateTree(daemonSessionId)) {
      await request({ method: "destroySession", sessionId: subordinate }).catch(() => {});
    }
  }

  /**
   * Sessions whose typed prompts mention `query`, each with its most recent
   * matching prompt. A failed search finds nothing, leaving name matches.
   */
  async function matchingPrompts(query: string): Promise<Map<string, string>> {
    const prompts = new Map<string, string>();
    const { result } = await request({ method: "persistenceSearchHistory", query }).catch(() => ({ result: null }));
    if (!result?.ok) return prompts;
    const newestFirst = [...result.value].sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
    for (const match of newestFirst) {
      if (!prompts.has(match.sessionId)) prompts.set(match.sessionId, promptPreview(match.text, query));
    }
    return prompts;
  }

  /** Starts the queue head once nothing is running, so turns never interleave. */
  function advance(session: FspecSession): void {
    const head = session.queue[0];
    if (session.activeTurnId !== null || head === undefined || head.parked === true || session.awaitSteerTurn) return;
    session.activeTurnId = head.turnId;
    emit({ type: "session.turn", sessionId: session.sessionId, turnId: head.turnId, state: "started" });
    if (head.failure) settle(session, "failed", head.failure);
  }

  /**
   * The legacy create_session answers an empty id when creation fails, which
   * then surfaces as a misleading "Session not found"; the checked variant
   * (idx 121) carries the daemon's reason.
   */
  async function createDaemonSession(workspace: { path: string; start: boolean }, role: string | null): Promise<string> {
    const { result } = workspace.start
      ? await request({ method: "createSessionChecked", role })
      : await request({ method: "createSessionInWorkspace", workspace: workspace.path, role });
    if (!result.ok) {
      const where = workspace.start ? "" : ` in ${workspace.path}`;
      throw new Error(`fspec could not create a session${where}: ${result.error}`);
    }
    // fspec declines with an empty id when it has no default model (PROV-101).
    if (result.value === "") throw new Error(NO_DEFAULT_MODEL);
    return result.value;
  }

  /** The daemon's workspaces, start first; a daemon that cannot list them serves its start workspace. */
  async function workspaces(): Promise<WorkspaceEntry[]> {
    const { result } = await request({ method: "listWorkspaces" });
    if (result.ok && result.value.length > 0) return result.value;
    const { workspace } = await request({ method: "getWorkspaceInfo" });
    return [{ path: workspace.cwd, name: workspace.cwd, start: true }];
  }

  /**
   * The workspace a Paseo directory's session runs in (FSPEC-052): the listed
   * workspace holding it, else the directory itself, which the daemon opens.
   */
  async function workspaceFor(cwd: string): Promise<{ path: string; start: boolean }> {
    return servingWorkspace(await workspaces(), cwd) ?? { path: cwd, start: false };
  }

  const registry = {
    has(sessionId: string): boolean {
      return sessions.has(sessionId);
    },

    async open(input: Input<"session.open">): Promise<void> {
      if (sessions.has(input.sessionId)) {
        throw new Error(`Session already open: ${input.sessionId}`);
      }
      // A session belongs to one workspace: the one holding the Paseo cwd.
      const workspace = await workspaceFor(input.config.cwd);
      const saved = input.persistence ? readPersistence(input.persistence) : undefined;
      const { providers } = await request({ method: "listProviders" });
      const { model: fspecDefault } = await request({ method: "getDefaultModel" });
      const catalog = buildCatalog(providers, fspecDefault);
      const model = input.config.model ?? saved?.model ?? catalog.defaultModel;
      // fspec creates sessions with its default model and declines without
      // one; like the TUI, the model chosen with no default becomes it.
      if (fspecDefault === null && model !== undefined) {
        unwrap((await request({ method: "setDefaultModel", model })).result, "set_default_model");
      }
      // A saved session may have been dropped from daemon memory (close calls
      // destroy_session); resume_session rebuilds it from its manifest.
      const resumeError = saved ? await resume(saved.sessionId) : null;
      const resumed = saved !== undefined && resumeError === null;
      // A bot is a session created with fspec's orchestrator role; a resumed
      // session keeps its own role, which decides its mode.
      const requested = fspecMode(input.config.mode ?? DEFAULT_MODE);
      const daemonSessionId = resumed
        ? saved.sessionId
        : await createDaemonSession(workspace, requested === "bot" ? ORCHESTRATOR_ROLE : null);
      const mode: FspecMode = resumed
        ? isBotRole((await request({ method: "getSessionRole", sessionId: daemonSessionId })).role)
          ? "bot"
          : "agent"
        : requested;
      const epoch = randomUUID().slice(0, 8);
      const session: FspecSession = {
        sessionId: input.sessionId,
        daemonSessionId,
        cwd: input.config.cwd,
        owned: true,
        model: undefined,
        mode,
        thinking: DEFAULT_THINKING_OPTION,
        models: catalog.models,
        defaultModel: catalog.defaultModel,
        turnCounter: 0,
        activeTurnId: null,
        queue: [],
        turns: new Map(),
        epoch,
        transcript: createTranscript(epoch),
        pause: null,
        stdin: null,
        stdinCounter: 0,
        commandCounter: 0,
        attachments: { images: 0 },
        pauseGeneration: 0,
        pausedNow: false,
        steers: [],
        awaitSteerTurn: false,
      };
      try {
        await applyModel(session, model);
        await applyThinking(
          session,
          thinkingLevel(input.config.thinkingOption ?? saved?.thinkingOption ?? DEFAULT_THINKING_OPTION),
        );
      } catch (error) {
        if (!resumed) {
          await request({ method: "destroySession", sessionId: daemonSessionId }).catch(() => {});
        }
        throw error;
      }
      sessions.set(session.sessionId, session);
      byDaemonId.set(daemonSessionId, session);
      markActive(session);
      await rememberCheckpoints().catch(() => {});
      emit({
        type: "session.opened",
        requestId: input.requestId,
        sessionId: input.sessionId,
        capabilities: deps.capabilities,
        restoration: "core",
        ...(input.config.persist ? { persistence: persistence(session) } : {}),
        ...(input.config.title !== undefined ? { title: input.config.title } : {}),
        cwd: input.config.cwd,
      });
      emit({ type: "session.config", sessionId: input.sessionId, config: configState(session) });
      emit({ type: "session.commands", sessionId: input.sessionId, commands: FSPEC_COMMANDS });
      if (resumeError !== null) {
        emit({
          type: "session.notice",
          sessionId: input.sessionId,
          notice: {
            id: `${session.epoch}:resume`,
            severity: "warning",
            title: "Previous fspec session could not be resumed; started a new one",
            description: resumeError,
          },
        });
      }
      if (input.history === "replay" && resumed) {
        try {
          await replay(session);
        } catch (error) {
          // Missing history never blocks the session: warn and carry on.
          const message = error instanceof Error ? error.message : String(error);
          emit({
            type: "session.notice",
            sessionId: input.sessionId,
            notice: {
              id: `${session.epoch}:history`,
              severity: "warning",
              title: "fspec history could not be replayed",
              description: message,
            },
          });
        }
      }
      emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
      void seedFocus(session).catch(() => {});
    },

    /**
     * Paseo may release an idle runtime; say yes only when nothing would be
     * lost. Read-only, and any failure keeps the runtime alive.
     */
    async canStopRuntime(input: Input<"session.can_stop_runtime">): Promise<void> {
      const session = live(input.sessionId);
      const answer = (canStop: boolean) =>
        emit({ type: "session.can_stop_runtime", requestId: input.requestId, sessionId: input.sessionId, canStop });
      const childOpen = [...sessions.values()].some((other) => other.parentSessionId === session.sessionId);
      if (session.queue.length > 0 || session.pause !== null || session.stdin !== null || childOpen) {
        answer(false);
        return;
      }
      try {
        const { status } = await request({ method: "getSessionStatus", sessionId: session.daemonSessionId });
        const { text } = await request({ method: "getPendingInput", sessionId: session.daemonSessionId });
        answer(status === "idle" && (text === null || text === ""));
      } catch {
        answer(false);
      }
    },

    /** Restores the working tree to the checkpoint a revert token names. */
    async revert(input: Input<"session.revert">): Promise<void> {
      live(input.sessionId);
      const token = input.token as Record<string, unknown> | null;
      if (token === null || typeof token !== "object" || typeof token["workUnitId"] !== "string" || typeof token["name"] !== "string") {
        throw new Error("Not an fspec checkpoint");
      }
      const { result } = await request({ method: "restoreCheckpointAll", workUnitId: token["workUnitId"], name: token["name"] });
      if (!result.ok) throw new Error(result.error);
      emit({ type: "request.completed", requestId: input.requestId });
    },

    /** Paseo's import list: the live and persisted sessions of the workspace holding cwd. */
    async list(input: Input<"sessions">): Promise<void> {
      const served = await workspaces();
      const entry = input.cwd === undefined ? served.find((candidate) => candidate.start) : servingWorkspace(served, input.cwd);
      // Never open a workspace just to list it.
      if (entry === undefined || entry === null) {
        emit({ type: "sessions", requestId: input.requestId, sessions: [] });
        return;
      }
      const workspace = { cwd: entry.path };
      const listed = (await request({ method: "listSessions", projectPath: workspace.cwd })).sessions;
      const query = input.query?.trim().toLowerCase() ?? "";
      const prompts = query === "" ? new Map<string, string>() : await matchingPrompts(query);
      const summaries = listed
        .filter((info) => !byDaemonId.has(info.id))
        .filter((info) => query === "" || prompts.has(info.id) || `${info.name} ${info.id}`.toLowerCase().includes(query))
        .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
        .slice(0, input.limit ?? Number.POSITIVE_INFINITY)
        .map((info) => {
          const model = info.providerId && info.modelId ? ` · ${info.providerId}/${info.modelId}` : "";
          return {
            persistence: { version: 1, data: { sessionId: info.id } },
            cwd: workspace.cwd,
            title: info.name,
            // Paseo re-filters on the title and this preview, so a session
            // found by its prompt text shows that prompt.
            description: `${isBotRole(info.role) ? "Bot · " : ""}${prompts.get(info.id) ?? `${info.messageCount} messages${model}`}`,
            ...(info.updatedAtMs !== null ? { updatedAt: new Date(info.updatedAtMs).toISOString() } : {}),
          };
        });
      emit({ type: "sessions", requestId: input.requestId, sessions: summaries });
    },

    async prompt(input: Input<"session.prompt">): Promise<void> {
      const session = live(input.sessionId);
      const prompt = input.prompt.input;
      if (prompt.type === "command") {
        // fspec session commands run as side effects: no turn is started.
        let outcome: { type: "completed" } | { type: "failed"; error: { message: string } };
        try {
          const notice = await runCommand(session, prompt.name, prompt.arguments);
          if (notice !== null) {
            emit({
              type: "session.notice",
              sessionId: session.sessionId,
              notice: { id: `${session.epoch}:command:${++session.commandCounter}`, severity: "info", title: notice },
            });
          }
          outcome = { type: "completed" };
        } catch (error) {
          outcome = { type: "failed", error: { message: error instanceof Error ? error.message : String(error) } };
        }
        emit({
          type: "session.prompt_result",
          sessionId: session.sessionId,
          clientMessageId: input.prompt.clientMessageId,
          result: outcome,
        });
        return;
      }
      if (input.prompt.delivery === "steer") return steerPrompt(session, input);
      // Anything running, waiting or parked: fspec holds and orders the input.
      const busy = session.activeTurnId !== null || session.awaitSteerTurn || session.queue.length > 0;
      const text = promptText(attachmentKey(session), prompt.content, session.attachments);
      const queued = enqueueTurn(session, text);
      const turnId = queued.turnId;
      emit({
        type: "session.prompt_result",
        sessionId: session.sessionId,
        clientMessageId: input.prompt.clientMessageId,
        result: { type: "turn", turnId },
      });
      // A queued submit to an idle session runs fspec's parked inputs first:
      // their turns are due again, ahead of this one.
      for (const waiting of session.queue) delete waiting.parked;
      // Sent now, started only when every earlier turn has settled.
      advance(session);
      session.transcript.expectEcho(text, input.prompt.clientMessageId);
      markActive(session);
      try {
        // The thinking level already reached the daemon via set_thinking_level;
        // it builds the provider-specific reasoning settings itself.
        if (busy) {
          const { result } = await request({ method: "submitInput", sessionId: session.daemonSessionId, text, mode: "queue" });
          unwrap(result, "submit_input");
        } else {
          await request({ method: "sendInput", sessionId: session.daemonSessionId, text });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = { message, diagnostic: message };
        if (session.activeTurnId === turnId) settle(session, "failed", failure);
        else if (session.queue.includes(queued)) queued.failure = failure;
      }
    },

    async interrupt(input: Input<"session.interrupt">): Promise<void> {
      const session = live(input.sessionId);
      // The stop is accepted here; the daemon's Interrupted chunk settles the turn.
      emit({ type: "request.completed", requestId: input.requestId });
      await request({ method: "interrupt", sessionId: session.daemonSessionId }).catch(() => {});
    },

    async configure(input: Input<"session.configure">): Promise<void> {
      const session = live(input.sessionId);
      const { model, mode, thinkingOption } = input.changes;
      if (model !== undefined) await applyModel(session, model ?? session.defaultModel);
      if (mode !== undefined) await applyMode(session, mode === null ? DEFAULT_MODE : fspecMode(mode));
      if (thinkingOption !== undefined) {
        await applyThinking(session, thinkingOption === null ? "off" : thinkingLevel(thinkingOption));
      }
      emit({ type: "session.config", sessionId: session.sessionId, config: configState(session) });
      emit({ type: "request.completed", requestId: input.requestId });
    },

    async permission(input: Input<"session.permission">): Promise<void> {
      // Paseo answers a sub-agent's request on its top-level agent.
      const root = live(input.sessionId);
      const session =
        [...sessions.values()].find(
          (s) =>
            rootOf(s) === root &&
            (s.pause?.permissionId === input.permissionId || s.stdin?.permissionId === input.permissionId),
        ) ?? root;
      const stdin = session.stdin;
      if (stdin !== null && stdin.permissionId === input.permissionId) {
        resolveStdin(session);
        if (input.response.behavior !== "allow") return; // dismissed: type nothing
        const answer = input.response.updatedInput?.["answers"];
        const typed = answer !== null && typeof answer === "object" ? (answer as Record<string, unknown>)[STDIN_HEADER] : undefined;
        // fspec appends the trailing newline.
        const { result } = await request({
          method: "writeExecStdin",
          sessionId: session.daemonSessionId,
          execSessionId: stdin.execSessionId,
          text: typeof typed === "string" ? typed : "",
        });
        unwrap(result, "write_exec_stdin");
        return;
      }
      const open = session.pause;
      if (open === null || open.permissionId !== input.permissionId) return; // already resolved
      const reply = interactionReply(open.interaction, input.response);
      // Request-bound: the daemon applies the answer only to the request shown.
      const { result } = await request({
        method: "replyInteractionChecked",
        sessionId: session.daemonSessionId,
        interaction: reply.method,
        requestId: open.interaction.requestId,
        arguments: reply.arguments,
      });
      if (session.pause?.permissionId !== open.permissionId) return;
      const stillPaused = session.pausedNow;
      resolvePause(session);
      // The daemon moved on to a newer request: show that one instead.
      if (!result.ok && stillPaused) {
        session.pausedNow = true;
        await openPause(session);
      }
    },

    async close(input: Input<"session.close">): Promise<void> {
      const session = sessions.get(input.sessionId);
      if (session) {
        for (const child of [...sessions.values()]) {
          if (child.parentSessionId === session.sessionId) closeChild(child);
        }
        resolvePause(session);
        resolveStdin(session);
        sessions.delete(session.sessionId);
        byDaemonId.delete(session.daemonSessionId);
        removeAttachments(attachmentKey(session));
        if (session.owned) {
          await destroySubordinates(session.daemonSessionId);
          const { result } = await request({
            method: "destroySession",
            sessionId: session.daemonSessionId,
          });
          unwrap(result, "destroy_session");
        }
        emit({ type: "session.closed", sessionId: session.sessionId });
      }
      emit({ type: "request.completed", requestId: input.requestId });
    },

    /**
     * Routes one server-pushed stream chunk: the transcript publishes its rows
     * (terminalizing transient ones), then terminal chunks settle the turn.
     */
    handleChunk(daemonSessionId: string, chunk: StreamChunk): void {
      const session = byDaemonId.get(daemonSessionId);
      if (!session) {
        adoptUnknown(daemonSessionId, chunk);
        return;
      }
      // A sub-agent's runs are driven by its supervisor, not a Paseo prompt:
      // Paseo shows the child running until a turn settles, so each run is one.
      if (!session.owned && session.activeTurnId === null && session.queue.length === 0 && isWork(chunk)) {
        enqueueTurn(session);
        advance(session);
      }
      if (session.awaitSteerTurn && chunk.type === "userInput") startAfterSteers(session, chunk.text);
      if (chunk.type === "sessionStateChange") {
        if (chunk.state === "paused") {
          session.pausedNow = true;
          void openPause(session).catch(() => {});
        } else {
          resolvePause(session);
        }
      }
      if (chunk.type === "execStdinRequest") openStdin(session, chunk.request);
      if (chunk.type === "execStdinRequestCleared") resolveStdin(session);
      if (
        chunk.type === "done" ||
        chunk.type === "error" ||
        chunk.type === "interrupted" ||
        chunk.type === "interruptedWithReason"
      ) {
        resolvePause(session);
        resolveStdin(session);
      }
      publish(session, chunk);
      if (chunk.type === "toolResult" && session.transcript.toolName(chunk.toolResult.toolCallId)?.toLowerCase() === "fspec") {
        void attachCheckpoint(session, chunk.toolResult.toolCallId).catch(() => {});
      }
      switch (chunk.type) {
        case "done":
          settle(session, "completed");
          return;
        case "error":
          settle(session, "failed", { message: chunk.error, diagnostic: chunk.error });
          return;
        case "interrupted":
        case "interruptedWithReason":
          park(session, chunk.queuedInputs);
          return;
        default:
          return;
      }
    },

    /**
     * The daemon connection dropped: every session's runtime is gone. Close
     * transient rows, settle turns silently (runtime_failed is their
     * settlement in Paseo), report the failure, and forget the session so a
     * reopen resumes it.
     */
    fail(reason: string): void {
      const message = `fspec daemon connection was lost: ${reason} — reopen the session`;
      for (const session of [...sessions.values()]) {
        resolvePause(session);
        resolveStdin(session);
        for (const item of session.transcript.terminalize()) {
          emit({ type: "timeline.item", sessionId: session.sessionId, item });
        }
        for (const [turnId, state] of session.turns) {
          if (state === "active") session.turns.set(turnId, "settled");
        }
        session.activeTurnId = null;
        session.queue = [];
        sessions.delete(session.sessionId);
        byDaemonId.delete(session.daemonSessionId);
        emit({
          type: "session.runtime_failed",
          sessionId: session.sessionId,
          error: { message, diagnostic: message },
        });
      }
    },

    /** fspec removed a daemon session: the Paseo session it backs closes with it. */
    handleSessionEvent(event: SessionEvent): void {
      if (event.type === "focusChanged") {
        const focused = byDaemonId.get(event.sessionId);
        if (focused) publishFocus(focused, event.focus);
        return;
      }
      if (event.type !== "removed") return;
      const session = byDaemonId.get(event.sessionId);
      if (!session) return;
      for (const child of [...sessions.values()]) {
        if (child.parentSessionId === session.sessionId) closeChild(child);
      }
      if (!session.owned) {
        closeChild(session);
        return;
      }
      // Closed on the fspec side (e.g. its agent tab): nothing left to destroy.
      resolvePause(session);
      resolveStdin(session);
      sessions.delete(session.sessionId);
      byDaemonId.delete(session.daemonSessionId);
      removeAttachments(attachmentKey(session));
      emit({ type: "session.closed", sessionId: session.sessionId });
    },

    /** Releases every daemon session and its sub-agents; failures are swallowed. */
    async closeAll(): Promise<void> {
      for (const session of sessions.values()) removeAttachments(attachmentKey(session));
      const open = [...sessions.values()].filter((session) => session.owned);
      sessions.clear();
      byDaemonId.clear();
      await Promise.allSettled(
        open.map(async (session) => {
          await destroySubordinates(session.daemonSessionId);
          await request({ method: "destroySession", sessionId: session.daemonSessionId });
        }),
      );
    },
  };
  return registry;
}

export type SessionRegistry = ReturnType<typeof createSessionRegistry>;
