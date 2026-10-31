/**
 * Feature: spec/features/fspec-wire-codec.feature
 *
 * The fspec wire codec — the single audited module that encodes/decodes the
 * fspec daemon's bincode 1.3.3 + tarpc 0.34.0 frames. Small public surface:
 * Envelope encode/decode, tarpc request/response frames, and the FspecService
 * method payloads the plugin actually calls. Byte-exactness is pinned by the
 * Rust-generated golden vectors in test/golden/golden-vectors.txt.
 *
 * Conventions (docs/fspec-wire-protocol.md §3): little-endian fixed-width
 * integers, u64-LE length prefixes, u32-LE enum variant indices, 1-byte Option
 * tag — provided by the focused reader/writer in server/bincode.ts.
 */
import { BincodeReader, BincodeWriter, WireDecodeError } from "./bincode.js";

export { BincodeReader, BincodeWriter, WireDecodeError };

// ---------------------------------------------------------------------------
// Envelope — variant order IS the wire index (§2)
// ---------------------------------------------------------------------------

export interface RpcEnvelope {
  kind: "rpc";
  frame: Uint8Array;
}
export interface EventEnvelope {
  kind: "event";
  sessionId: string;
  chunk: StreamChunk;
}
export interface LogEventEnvelope {
  kind: "logEvent";
  level: string;
  target: string;
  message: string;
  timestampMs: number;
}
export interface WorkUnitsUpdateEnvelope {
  kind: "workUnitsUpdate";
  workUnits: WorkUnitInfo[];
}
export interface StatusUpdateEnvelope {
  kind: "statusUpdate";
  sessionId: string;
  status: SessionStatus;
}
export interface CmdReqEnvelope {
  kind: "cmdReq";
}
export interface CmdResEnvelope {
  kind: "cmdRes";
}
export interface SessionEventEnvelope {
  kind: "sessionEvent";
  event: SessionEvent;
}
export interface SessionSnapshotEnvelope {
  kind: "sessionSnapshot";
  sessions: SessionInfo[];
}

export type Envelope =
  | RpcEnvelope
  | EventEnvelope
  | LogEventEnvelope
  | WorkUnitsUpdateEnvelope
  | StatusUpdateEnvelope
  | CmdReqEnvelope
  | CmdResEnvelope
  | SessionEventEnvelope
  | SessionSnapshotEnvelope;

// ---------------------------------------------------------------------------
// Shared payload types (§6)
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "idle"
  | "running"
  | "interrupted"
  | "paused"
  | "compacting"
  | "cleared";

export type SessionState =
  | "idle"
  | "running"
  | "paused"
  | "compacting"
  | "interrupted"
  | "cleared";

export type NotificationSeverity = "info" | "warning" | "error";

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export type InterruptionReason = "user" | "loopDetector";

export interface WorkUnitInfo {
  id: string;
  title: string;
  workType: string;
  status: string;
  description: string | null;
  estimate: number | null;
  epic: string | null;
  attachments: string[];
  lastStateChangeAt: string | null;
}

export interface WorkUnitContext {
  id: string;
  title: string;
  status: string;
}
export interface WorkUnitFocus {
  revision: number;
  context: WorkUnitContext | null;
  source: string;
}

export interface SessionInfo {
  id: string;
  name: string;
  status: string;
  project: string;
  messageCount: number;
  providerId: string | null;
  modelId: string | null;
  isIsolated: boolean;
  worktreePath: string | null;
  role: string | null;
  updatedAtMs: number | null;
  workUnitFocus: WorkUnitFocus;
}

/** One prompt from fspec's history that matched a search. */
export interface HistoryMatch {
  sessionId: string;
  text: string;
  timestampIso: string;
}

export type SessionEvent =
  | { type: "created"; session: SessionInfo }
  | { type: "removed"; sessionId: string }
  | { type: "cleared"; sessionId: string }
  | { type: "focusChanged"; sessionId: string; focus: WorkUnitFocus };

export interface ToolCallInfo {
  id: string;
  name: string;
  input: string;
}
export interface ToolResultInfo {
  toolCallId: string;
  content: string;
  isError: boolean;
}
export interface ToolProgressInfo {
  toolCallId: string;
  toolName: string;
  outputChunk: string;
  isStderr: boolean;
}
export interface ContextFillInfo {
  fillPercentage: number;
  effectiveTokens: number;
  threshold: number;
  contextWindow: number;
}
export interface TokenTracker {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  tokensPerSecond: number | null;
  cumulativeBilledInput: number | null;
  cumulativeBilledOutput: number | null;
  reasoningTokens: number | null;
}
export interface CompactionResult {
  originalTokens: number;
  compactedTokens: number;
  compressionRatio: number;
  turnsSummarized: number;
  turnsKept: number;
}
export interface CompactionProgress {
  phase: string;
  current: number;
  total: number;
}

// ---------------------------------------------------------------------------
// StreamChunk (§6.1) — 32 variants, index 0..31.
//
// Variants the plugin renders decode to typed values. Any other known index
// decodes to { type: "unsupported", index } so a frame from a newer daemon
// still parses; an index outside 0..31 is a descriptive error.
// ---------------------------------------------------------------------------

export type StreamChunk =
  | { type: "responseAttemptStarted" }
  | { type: "responseAttemptAborted" }
  | {
      type: "text";
      text: string;
      correlationId: string | null;
      observedCorrelationIds: string[] | null;
    }
  | {
      type: "thinking";
      thinking: string;
      correlationId: string | null;
      observedCorrelationIds: string[] | null;
    }
  | {
      type: "toolCall";
      toolCall: ToolCallInfo;
      correlationId: string | null;
      observedCorrelationIds: string[] | null;
    }
  | {
      type: "toolResult";
      toolResult: ToolResultInfo;
      correlationId: string | null;
      observedCorrelationIds: string[] | null;
    }
  | {
      type: "toolProgress";
      toolProgress: ToolProgressInfo;
      correlationId: string | null;
      observedCorrelationIds: string[] | null;
    }
  | { type: "sessionStateChange"; state: SessionState }
  | { type: "userNotification"; message: string; severity: NotificationSeverity }
  | { type: "interrupted"; queuedInputs: string[] }
  | { type: "tokenUpdate"; tokens: TokenTracker }
  | { type: "contextFillUpdate"; contextFill: ContextFillInfo }
  | { type: "contextSnapshot" }
  | { type: "done" }
  | { type: "error"; error: string }
  | { type: "userInput"; text: string }
  | { type: "compactionComplete"; compactionResult: CompactionResult }
  | { type: "compactionProgressUpdate"; progress: CompactionProgress | null }
  | {
      type: "interruptedWithReason";
      queuedInputs: string[];
      reason: InterruptionReason;
    }
  | { type: "providerWaiting"; message: string | null }
  | { type: "execStdinRequest"; request: ExecStdinRequest }
  | { type: "fspecCommandRequest"; request: FspecCommandRequest }
  | { type: "fspecCommandResult"; result: FspecCommandResult }
  | { type: "execStdinRequestCleared" }
  | { type: "unsupported"; index: number };

/** Display mirror of an fspec tool command (the daemon runs it itself). */
export interface FspecCommandRequest {
  command: string;
  argsJson: string;
  projectRoot: string;
  toolCallId: string;
}
export interface FspecCommandResult {
  success: boolean;
  data: string;
  error: string | null;
  systemReminder: string | null;
  toolCallId: string;
}

/** A running exec command that went quiet and may be waiting for stdin. */
export interface ExecStdinRequest {
  /** The unified_exec session id, not the agent session id. */
  execSessionId: string;
  command: string;
  quietSeconds: number;
  tsMs: number;
}

// ---------------------------------------------------------------------------
// Catalog / model shapes (§6.7) — payloads of list_providers (idx 28)
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  displayName: string;
  contextWindow: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  isCustom: boolean;
}
export interface ProviderInfo {
  key: string;
  displayName: string;
  models: ModelEntry[];
  profileName: string | null;
  isUnreachable: boolean;
}
/** One row of list_provider_credentials (idx 88); the key only ever arrives masked. */
export interface ProviderCredentialInfo {
  providerId: string;
  displayName: string;
  configured: boolean;
  /** "api_key" | "oauth" | "custom" */
  credentialType: string;
  modelCount: number;
  maskedKey: string | null;
  /** "explicit" | "file" | "env" | "dotenv"; null when unconfigured. */
  source: string | null;
}
/** set_provider_credentials (idx 90) payload: a flat struct with a `kind` discriminant. */
export interface ProviderCredentialInput {
  /** "api_key" | "oauth" | "custom" */
  kind: string;
  apiKey: string | null;
  oauthToken: string | null;
  oauthRefreshToken: string | null;
  customEndpoint: string | null;
  customApiKey: string | null;
}
export interface TestConnectionResult {
  success: boolean;
  error: string | null;
  latencyMs: number;
}
export interface OAuthHeadlessStart {
  authorizeUrl: string;
  pkceVerifier: string;
}
export interface OAuthDeviceStart {
  userCode: string;
  verificationUrl: string;
  deviceAuthId: string;
  interval: number;
}
export interface CustomModelDefinition {
  id: string;
  displayName: string | null;
  facade: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  compactionThresholdType: string | null;
  compactionThresholdValue: number | null;
  reasoning: boolean | null;
  hasVision: boolean | null;
}
/** A local-server provider's settings or one of its profiles (rpc-types ProfileDefinition). */
export interface ProfileDefinition {
  baseUrl: string;
  apiKey: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  compactionThresholdType: string | null;
  compactionThresholdValue: number | null;
  streaming: boolean | null;
  autoContinue: number | null;
  preserveThinking: boolean | null;
  maxImages: number | null;
  loopDetectionEnabled: boolean | null;
  loopDetectionWindow: number | null;
  loopDetectionMaxRepeats: number | null;
  loopDetectionMaxRetries: number | null;
}
export interface ProviderProfileConfig {
  name: string;
  definition: ProfileDefinition;
}
export interface ProviderSettingsConfig {
  providerId: string;
  settings: ProfileDefinition;
  profiles: ProviderProfileConfig[];
}
/** An approval gate the daemon is holding a tool call at (get_pause_state, idx 80). */
export type PauseKind = "confirm" | "triple";
export type ApprovalChoice = "approve" | "approveSession" | "deny";
export interface PauseState {
  kind: PauseKind;
  prompt: string;
  toolCallId: string | null;
}

/** Structured questions the agent asks the user (get_hitl_request, idx 81). */
export interface HitlOption {
  label: string;
  description: string;
}
export interface HitlQuestion {
  id: string;
  header: string;
  question: string;
  options: HitlOption[];
}
export interface HitlRequest {
  questions: HitlQuestion[];
}
export interface HitlAnswer {
  id: string;
  selected: string[];
  other: string | null;
}
export interface HitlResponse {
  cancelled: boolean;
  answers: HitlAnswer[];
}

/** A ghost-commit checkpoint in the daemon's workspace (list_checkpoints, idx 11). */
export interface CheckpointInfo {
  workUnitId: string;
  name: string;
  timestamp: string;
  isAutomatic: boolean;
}

/** A session goal and its optional verification command (get/set_goal_state). */
export interface GoalState {
  text: string;
  verify: string | null;
}

/** The directory a daemon serves (get_workspace_info, idx 22). */
export interface WorkspaceInfo {
  cwd: string;
  gitBranch: string | null;
}
export interface ThinkingConfig {
  providerId: string;
  level: ThinkingLevel;
  configJson: string;
}

// ---------------------------------------------------------------------------
// Transcript paging — get_transcript_page (idx 117), rpc-types/src/transcript.rs
// ---------------------------------------------------------------------------

export interface TranscriptCursor {
  generation: string;
  sequence: number;
  byteOffset: number;
}
export interface TranscriptOriginal {
  turnIndex: number;
  messageId: string;
  timestamp: string;
  chunkIndex: number;
}
/** One slice of a serde-JSON StreamChunk entry; slices concatenate in order. */
export interface TranscriptFragment {
  sequence: number;
  byteOffset: number;
  totalBytes: number;
  jsonFragment: string;
  original: TranscriptOriginal | null;
}
export interface TranscriptPage {
  generation: string;
  snapshotEnd: number;
  fragment: TranscriptFragment | null;
  nextCursor: TranscriptCursor;
  complete: boolean;
}
export type TranscriptErrorKind =
  | "sessionUnavailable"
  | "generationMismatch"
  | "invalidCursor"
  | "invalidSnapshot"
  | "invalidByteLimit"
  | "journalUnavailable"
  | "invalidPayload";
/** `detail` is present for the String-carrying variants (0, 5, 6). */
export interface TranscriptError {
  kind: TranscriptErrorKind;
  detail?: string;
}

const TRANSCRIPT_ERROR: TranscriptErrorKind[] = [
  "sessionUnavailable",
  "generationMismatch",
  "invalidCursor",
  "invalidSnapshot",
  "invalidByteLimit",
  "journalUnavailable",
  "invalidPayload",
];
const TRANSCRIPT_ERROR_WITH_DETAIL = new Set<TranscriptErrorKind>([
  "sessionUnavailable",
  "journalUnavailable",
  "invalidPayload",
]);

/** The daemon's Display text for a TranscriptError (thiserror messages). */
export function describeTranscriptError(error: TranscriptError): string {
  switch (error.kind) {
    case "sessionUnavailable":
      return `transcript session is unavailable: ${error.detail ?? ""}`;
    case "generationMismatch":
      return "transcript generation changed";
    case "invalidCursor":
      return "invalid transcript cursor";
    case "invalidSnapshot":
      return "invalid transcript snapshot boundary";
    case "invalidByteLimit":
      return "transcript page byte limit must be between 1024 and 65536";
    case "journalUnavailable":
      return `transcript journal unavailable: ${error.detail ?? ""}`;
    case "invalidPayload":
      return `invalid transcript payload: ${error.detail ?? ""}`;
  }
}

// ---------------------------------------------------------------------------
// FspecService method indices (§5) — variant index = position in the trait
// ---------------------------------------------------------------------------

export const FspecMethodIndex = {
  listWorkUnits: 0,
  listSessions: 1,
  persistenceSearchHistory: 26,
  listLiveSessions: 2,
  createSession: 3,
  sendInput: 4,
  interrupt: 5,
  getSessionStatus: 6,
  health: 7,
  getWorkspaceInfo: 22,
  getModelInfo: 20,
  getThinkingLevel: 21,
  listProviders: 28,
  setSessionModel: 29,
  setDefaultModel: 30,
  addCustomModel: 31,
  updateCustomModel: 32,
  deleteCustomModel: 33,
  listProviderSettings: 34,
  saveProviderSettings: 35,
  saveProfile: 36,
  deleteProfile: 37,
  renameProfile: 38,
  listProviderCredentials: 88,
  getProviderCredential: 89,
  setProviderCredentials: 90,
  deleteProviderCredentials: 91,
  testProviderConnection: 92,
  refreshModelsCache: 93,
  oauthClearTokens: 94,
  oauthGetTokens: 95,
  oauthBrowserLogin: 96,
  oauthHeadlessStart: 97,
  oauthHeadlessComplete: 98,
  oauthDeviceStart: 99,
  oauthDevicePoll: 100,
  oauthCopilotDeviceStart: 101,
  setThinkingLevel: 39,
  sendInputWithThinking: 46,
  pauseConfirm: 77,
  pauseTriple: 78,
  sendHitlResponse: 79,
  getPauseState: 80,
  getHitlRequest: 81,
  getInteractionSnapshot: 119,
  replyInteractionChecked: 120,
  getWorkUnitDetails: 123,
  moveWorkUnitUp: 18,
  moveWorkUnitDown: 19,
  createSessionChecked: 121,
  writeExecStdin: 83,
  getSupervisors: 66,
  getSubordinates: 70,
  setActiveSession: 62,
  clearActiveSession: 63,
  getActiveSession: 64,
  setContinueState: 40,
  getContinueState: 41,
  setGoalState: 42,
  getGoalState: 43,
  clearHistory: 51,
  compactSession: 52,
  setWorkUnitFocus: 57,
  listCheckpoints: 11,
  restoreCheckpointAll: 15,
  getWorkUnitFocus: 56,
  getPendingInput: 60,
  resumeSession: 55,
  destroySession: 87,
  getTranscriptPage: 117,
} as const;

export type FspecMethodName = keyof typeof FspecMethodIndex;

/** The method-name <-> index table, built from the single source above. */
const METHOD_NAMES = Object.entries(FspecMethodIndex) as [
  FspecMethodName,
  number,
][];
const INDEX_TO_METHOD = new Map<number, FspecMethodName>(
  METHOD_NAMES.map(([name, index]) => [index, name]),
);

export type FspecServiceRequest =
  | { method: "listWorkUnits" }
  | { method: "listSessions"; projectPath: string }
  | { method: "persistenceSearchHistory"; query: string }
  | { method: "listLiveSessions" }
  | { method: "createSession"; role: string | null }
  | { method: "createSessionChecked"; role: string | null }
  | { method: "sendInput"; sessionId: string; text: string }
  | { method: "interrupt"; sessionId: string }
  | { method: "getSessionStatus"; sessionId: string }
  | { method: "health" }
  | { method: "getWorkspaceInfo" }
  | { method: "getModelInfo"; sessionId: string }
  | { method: "getThinkingLevel"; sessionId: string }
  | { method: "listProviders" }
  | {
      method: "setSessionModel";
      sessionId: string;
      providerId: string;
      modelId: string;
    }
  | { method: "setThinkingLevel"; sessionId: string; level: ThinkingLevel }
  | {
      method: "sendInputWithThinking";
      sessionId: string;
      text: string;
      thinking: ThinkingConfig | null;
    }
  | { method: "destroySession"; sessionId: string }
  | { method: "resumeSession"; sessionId: string }
  | { method: "getPauseState"; sessionId: string }
  | { method: "pauseConfirm"; sessionId: string; accept: boolean }
  | { method: "pauseTriple"; sessionId: string; choice: ApprovalChoice }
  | { method: "getHitlRequest"; sessionId: string }
  | { method: "sendHitlResponse"; sessionId: string; response: HitlResponse }
  | { method: "getInteractionSnapshot"; sessionId: string }
  | { method: "getWorkUnitDetails"; id: string }
  | { method: "moveWorkUnitUp"; id: string }
  | { method: "moveWorkUnitDown"; id: string }
  | { method: "getSupervisors"; sessionId: string }
  | { method: "getSubordinates"; sessionId: string }
  | { method: "setActiveSession"; sessionId: string }
  | { method: "clearActiveSession" }
  | { method: "getActiveSession" }
  | { method: "setContinueState"; sessionId: string; enabled: boolean; budget: number }
  | { method: "getContinueState"; sessionId: string }
  | { method: "setGoalState"; sessionId: string; goal: GoalState | null }
  | { method: "getGoalState"; sessionId: string }
  | { method: "clearHistory"; sessionId: string }
  | { method: "compactSession"; sessionId: string }
  | { method: "setWorkUnitFocus"; sessionId: string; workUnitId: string | null; source: string }
  | { method: "listCheckpoints" }
  | { method: "getWorkUnitFocus"; sessionId: string }
  | { method: "getPendingInput"; sessionId: string }
  | { method: "restoreCheckpointAll"; workUnitId: string; name: string }
  | { method: "writeExecStdin"; sessionId: string; execSessionId: string; text: string }
  | {
      method: "replyInteractionChecked";
      sessionId: string;
      /** The legacy method name the answer stands for, e.g. "pause_triple". */
      interaction: string;
      requestId: string;
      /** JSON arguments for that method. */
      arguments: string;
    }
  | {
      method: "getTranscriptPage";
      sessionId: string;
      cursor: TranscriptCursor | null;
      snapshotEnd: number | null;
      maxBytes: number;
    }
  | { method: "setDefaultModel"; model: string }
  | { method: "addCustomModel"; providerId: string; profileName: string; definition: CustomModelDefinition }
  | {
      method: "updateCustomModel";
      providerId: string;
      profileName: string;
      originalModelId: string;
      definition: CustomModelDefinition;
    }
  | { method: "deleteCustomModel"; providerId: string; profileName: string; modelId: string }
  | { method: "listProviderSettings" }
  | { method: "saveProviderSettings"; providerId: string; definition: ProfileDefinition }
  | { method: "saveProfile"; providerId: string; profileName: string; definition: ProfileDefinition }
  | { method: "deleteProfile"; providerId: string; profileName: string }
  | { method: "renameProfile"; providerId: string; oldName: string; newName: string; definition: ProfileDefinition }
  | { method: "listProviderCredentials" }
  | { method: "getProviderCredential"; providerId: string }
  | { method: "setProviderCredentials"; providerId: string; creds: ProviderCredentialInput }
  | { method: "deleteProviderCredentials"; providerId: string }
  | { method: "testProviderConnection"; providerId: string }
  /** An empty providerId refreshes every provider. */
  | { method: "refreshModelsCache"; providerId: string }
  | { method: "oauthClearTokens"; providerId: string }
  | { method: "oauthGetTokens"; providerId: string }
  | { method: "oauthBrowserLogin"; providerId: string }
  | { method: "oauthHeadlessStart"; providerId: string }
  | { method: "oauthHeadlessComplete"; providerId: string; codeWithState: string; pkceVerifier: string }
  | { method: "oauthDeviceStart"; providerId: string }
  | { method: "oauthDevicePoll"; providerId: string; deviceAuthId: string; interval: number }
  | { method: "oauthCopilotDeviceStart"; enterpriseHost: string | null };

export type FspecServiceResponse =
  | { method: "listWorkUnits"; value: WorkUnitInfo[] }
  | { method: "listSessions"; value: SessionInfo[] }
  | { method: "persistenceSearchHistory"; value: Result<HistoryMatch[]> }
  | { method: "listLiveSessions"; value: string[] }
  | { method: "createSession"; value: string }
  | { method: "createSessionChecked"; value: Result<string> }
  | { method: "sendInput"; value: null }
  | { method: "interrupt"; value: null }
  | { method: "getSessionStatus"; value: SessionStatus }
  | { method: "health"; value: unknown }
  | { method: "getWorkspaceInfo"; value: WorkspaceInfo }
  | { method: "getModelInfo"; value: unknown }
  | { method: "getThinkingLevel"; value: ThinkingLevel }
  | { method: "listProviders"; value: ProviderInfo[] }
  | { method: "setSessionModel"; value: Result<void> }
  | { method: "setThinkingLevel"; value: Result<void> }
  | { method: "sendInputWithThinking"; value: null }
  | { method: "destroySession"; value: Result<void> }
  | { method: "moveWorkUnitUp"; value: Result<void> }
  | { method: "moveWorkUnitDown"; value: Result<void> }
  | { method: "resumeSession"; value: Result<void> }
  | { method: "getPauseState"; value: PauseState | null }
  | { method: "pauseConfirm"; value: Result<void> }
  | { method: "pauseTriple"; value: Result<void> }
  | { method: "getHitlRequest"; value: HitlRequest | null }
  | { method: "sendHitlResponse"; value: Result<void> }
  | { method: "getInteractionSnapshot"; value: Result<string> }
  | { method: "getWorkUnitDetails"; value: Result<string> }
  | { method: "replyInteractionChecked"; value: Result<void> }
  | { method: "writeExecStdin"; value: Result<void> }
  | { method: "getSupervisors"; value: string[] }
  | { method: "getSubordinates"; value: string[] }
  | { method: "setActiveSession"; value: null }
  | { method: "clearActiveSession"; value: null }
  | { method: "getActiveSession"; value: string | null }
  | { method: "setContinueState"; value: Result<void> }
  | { method: "getContinueState"; value: { enabled: boolean; budget: number } }
  | { method: "setGoalState"; value: Result<void> }
  | { method: "getGoalState"; value: GoalState | null }
  | { method: "clearHistory"; value: Result<void> }
  | { method: "compactSession"; value: Result<CompactionResult> }
  | { method: "setWorkUnitFocus"; value: Result<WorkUnitFocus> }
  | { method: "listCheckpoints"; value: CheckpointInfo[] }
  | { method: "getWorkUnitFocus"; value: Result<WorkUnitFocus> }
  | { method: "getPendingInput"; value: string | null }
  | { method: "restoreCheckpointAll"; value: Result<void> }
  | { method: "getTranscriptPage"; value: TranscriptResult }
  | { method: VoidSettingsMethod; value: Result<void> }
  | { method: "listProviderSettings"; value: Result<ProviderSettingsConfig[]> }
  | { method: "listProviderCredentials"; value: ProviderCredentialInfo[] }
  | { method: "getProviderCredential"; value: ProviderCredentialInfo | null }
  | { method: "testProviderConnection"; value: Result<TestConnectionResult> }
  | { method: "refreshModelsCache"; value: Result<ModelEntry[]> }
  | { method: "oauthGetTokens"; value: Result<boolean> }
  | { method: "oauthHeadlessStart"; value: Result<OAuthHeadlessStart> }
  | { method: "oauthDeviceStart" | "oauthCopilotDeviceStart"; value: Result<OAuthDeviceStart> };

/** Provider-settings methods (FSPEC-041) whose reply is Result<(), String>. */
export type VoidSettingsMethod =
  | "setDefaultModel"
  | "addCustomModel"
  | "updateCustomModel"
  | "deleteCustomModel"
  | "saveProviderSettings"
  | "saveProfile"
  | "deleteProfile"
  | "renameProfile"
  | "setProviderCredentials"
  | "deleteProviderCredentials"
  | "oauthClearTokens"
  | "oauthBrowserLogin"
  | "oauthHeadlessComplete"
  | "oauthDevicePoll";

export type TranscriptResult =
  | { ok: true; value: TranscriptPage }
  | { ok: false; error: TranscriptError };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Enum tables — declaration order IS the wire order
// ---------------------------------------------------------------------------

const SESSION_STATUS: SessionStatus[] = [
  "idle",
  "running",
  "interrupted",
  "paused",
  "compacting",
  "cleared",
];
const SESSION_STATE: SessionState[] = [
  "idle",
  "running",
  "paused",
  "compacting",
  "interrupted",
  "cleared",
];
const SEVERITY: NotificationSeverity[] = ["info", "warning", "error"];
const THINKING_LEVEL: ThinkingLevel[] = ["off", "low", "medium", "high"];
const INTERRUPTION_REASON: InterruptionReason[] = ["user", "loopDetector"];
const PAUSE_KIND: PauseKind[] = ["confirm", "triple"];
const APPROVAL_CHOICE: ApprovalChoice[] = ["approve", "approveSession", "deny"];

function enumIndex<T>(table: readonly T[], value: T, what: string): number {
  const i = table.indexOf(value);
  if (i < 0) throw new Error(`invalid ${what}: ${String(value)}`);
  return i;
}

function readEnumAt<T>(r: BincodeReader, table: readonly T[], name: string): T {
  const at = r.offset;
  const i = r.enumIndex(name);
  if (i >= table.length) {
    throw new WireDecodeError(
      `unknown ${name} variant index ${i} at offset ${at} (known: 0..${table.length - 1})`,
    );
  }
  return table[i];
}

function readVec<T>(r: BincodeReader, read: (r: BincodeReader) => T): T[] {
  const at = r.offset;
  const n = r.vecLen();
  if (n > r.remaining) {
    throw new WireDecodeError(
      `u64 length prefix ${n} exceeds remaining ${r.remaining} bytes at offset ${at}`,
    );
  }
  const out: T[] = [];
  for (let i = 0; i < n; i += 1) out.push(read(r));
  return out;
}

function writeVec<T>(
  w: BincodeWriter,
  items: readonly T[],
  write: (w: BincodeWriter, v: T) => void,
): void {
  w.vecLen(items.length);
  for (const item of items) write(w, item);
}

function readOptStrings(r: BincodeReader): string[] | null {
  return r.optionTag() ? readVec(r, (x) => x.string("String")) : null;
}
function writeOptStrings(w: BincodeWriter, v: string[] | null): void {
  w.optionTag(v !== null);
  if (v !== null) writeVec(w, v, (x, s) => x.string(s));
}

// ---------------------------------------------------------------------------
// Shared payload readers / writers
// ---------------------------------------------------------------------------

function readWorkUnitInfo(r: BincodeReader): WorkUnitInfo {
  return {
    id: r.string("WorkUnitInfo.id"),
    title: r.string("WorkUnitInfo.title"),
    workType: r.string("WorkUnitInfo.workType"),
    status: r.string("WorkUnitInfo.status"),
    description: r.skipOption((x) => x.string()),
    estimate: r.skipOption((x) => x.i32()),
    epic: r.skipOption((x) => x.string()),
    attachments: readVec(r, (x) => x.string("String")),
    lastStateChangeAt: r.skipOption((x) => x.string()),
  };
}
function writeWorkUnitInfo(w: BincodeWriter, u: WorkUnitInfo): void {
  w.string(u.id)
    .string(u.title)
    .string(u.workType)
    .string(u.status)
    .option(u.description, (x, v) => x.string(v))
    .option(u.estimate, (x, v) => x.i32(v))
    .option(u.epic, (x, v) => x.string(v));
  writeVec(w, u.attachments, (x, v) => x.string(v));
  w.option(u.lastStateChangeAt, (x, v) => x.string(v));
}

function readWorkUnitFocus(r: BincodeReader): WorkUnitFocus {
  return {
    revision: r.u64(),
    context: r.skipOption((x) => ({
      id: x.string(),
      title: x.string(),
      status: x.string(),
    })),
    source: r.string(),
  };
}
function writeWorkUnitFocus(w: BincodeWriter, f: WorkUnitFocus): void {
  w.u64(f.revision).option(f.context, (x, v) =>
    x.string(v.id).string(v.title).string(v.status),
  );
  w.string(f.source);
}

function readSessionInfo(r: BincodeReader): SessionInfo {
  return {
    id: r.string("SessionInfo.id"),
    name: r.string("SessionInfo.name"),
    status: r.string("SessionInfo.status"),
    project: r.string("SessionInfo.project"),
    messageCount: r.u32("SessionInfo.message_count"),
    providerId: r.skipOption((x) => x.string()),
    modelId: r.skipOption((x) => x.string()),
    isIsolated: r.bool(),
    worktreePath: r.skipOption((x) => x.string()),
    role: r.skipOption((x) => x.string()),
    updatedAtMs: r.skipOption((x) => x.i64()),
    workUnitFocus: readWorkUnitFocus(r),
  };
}
function readHistoryMatch(r: BincodeReader): HistoryMatch {
  return { sessionId: r.string("SessionId"), text: r.string("HistoryMatch.text"), timestampIso: r.string("HistoryMatch.timestamp_iso") };
}
function writeHistoryMatch(w: BincodeWriter, m: HistoryMatch): void {
  w.string(m.sessionId).string(m.text).string(m.timestampIso);
}
function writeSessionInfo(w: BincodeWriter, s: SessionInfo): void {
  w.string(s.id)
    .string(s.name)
    .string(s.status)
    .string(s.project)
    .u32(s.messageCount)
    .option(s.providerId, (x, v) => x.string(v))
    .option(s.modelId, (x, v) => x.string(v))
    .bool(s.isIsolated)
    .option(s.worktreePath, (x, v) => x.string(v))
    .option(s.role, (x, v) => x.string(v))
    .option(s.updatedAtMs, (x, v) => x.i64(v));
  writeWorkUnitFocus(w, s.workUnitFocus);
}

function readSessionEvent(r: BincodeReader): SessionEvent {
  const at = r.offset;
  switch (r.enumIndex("SessionEvent")) {
    case 0:
      return { type: "created", session: readSessionInfo(r) };
    case 1:
      return { type: "removed", sessionId: r.string("SessionId") };
    case 2:
      return { type: "cleared", sessionId: r.string("SessionId") };
    case 3: {
      const sessionId = r.string("SessionId");
      return { type: "focusChanged", sessionId, focus: readWorkUnitFocus(r) };
    }
    default:
      throw new WireDecodeError(
        `unknown SessionEvent variant index at offset ${at}`,
      );
  }
}
function writeSessionEvent(w: BincodeWriter, e: SessionEvent): void {
  switch (e.type) {
    case "created":
      w.enumIndex(0);
      writeSessionInfo(w, e.session);
      return;
    case "removed":
      w.enumIndex(1).string(e.sessionId);
      return;
    case "cleared":
      w.enumIndex(2).string(e.sessionId);
      return;
    case "focusChanged":
      w.enumIndex(3).string(e.sessionId);
      writeWorkUnitFocus(w, e.focus);
      return;
  }
}

function readTokenTracker(r: BincodeReader): TokenTracker {
  return {
    inputTokens: r.u32(),
    outputTokens: r.u32(),
    cacheReadInputTokens: r.skipOption((x) => x.u32()),
    cacheCreationInputTokens: r.skipOption((x) => x.u32()),
    tokensPerSecond: r.skipOption((x) => x.f64()),
    cumulativeBilledInput: r.skipOption((x) => x.u32()),
    cumulativeBilledOutput: r.skipOption((x) => x.u32()),
    reasoningTokens: r.skipOption((x) => x.u32()),
  };
}
function writeTokenTracker(w: BincodeWriter, t: TokenTracker): void {
  w.u32(t.inputTokens)
    .u32(t.outputTokens)
    .option(t.cacheReadInputTokens, (x, v) => x.u32(v))
    .option(t.cacheCreationInputTokens, (x, v) => x.u32(v))
    .option(t.tokensPerSecond, (x, v) => x.f64(v))
    .option(t.cumulativeBilledInput, (x, v) => x.u32(v))
    .option(t.cumulativeBilledOutput, (x, v) => x.u32(v))
    .option(t.reasoningTokens, (x, v) => x.u32(v));
}

function readContextFill(r: BincodeReader): ContextFillInfo {
  return {
    fillPercentage: r.u32(),
    effectiveTokens: r.f64(),
    threshold: r.f64(),
    contextWindow: r.f64(),
  };
}
function writeContextFill(w: BincodeWriter, c: ContextFillInfo): void {
  w.u32(c.fillPercentage).f64(c.effectiveTokens).f64(c.threshold).f64(c.contextWindow);
}

function readCompactionResult(r: BincodeReader): CompactionResult {
  return {
    originalTokens: r.u32(),
    compactedTokens: r.u32(),
    compressionRatio: r.f64(),
    turnsSummarized: r.u32(),
    turnsKept: r.u32(),
  };
}
function writeCompactionResult(w: BincodeWriter, c: CompactionResult): void {
  w.u32(c.originalTokens)
    .u32(c.compactedTokens)
    .f64(c.compressionRatio)
    .u32(c.turnsSummarized)
    .u32(c.turnsKept);
}

function readCompactionProgress(r: BincodeReader): CompactionProgress {
  return { phase: r.string(), current: r.u32(), total: r.u32() };
}
function writeCompactionProgress(w: BincodeWriter, p: CompactionProgress): void {
  w.string(p.phase).u32(p.current).u32(p.total);
}

// ---------------------------------------------------------------------------
// StreamChunk — 32 variants, index 0..31 (§6.1)
// ---------------------------------------------------------------------------

const STREAM_CHUNK_MAX = 31;

function readStreamChunk(r: BincodeReader): StreamChunk {
  const at = r.offset;
  const index = r.enumIndex("StreamChunk");
  if (index > STREAM_CHUNK_MAX) {
    throw new WireDecodeError(
      `unknown StreamChunk variant index ${index} at offset ${at} (known: 0..${STREAM_CHUNK_MAX})`,
    );
  }
  switch (index) {
    case 0:
      return { type: "responseAttemptStarted" };
    case 1:
      return { type: "responseAttemptAborted" };
    case 2:
      return {
        type: "text",
        text: r.string("Text.text"),
        correlationId: r.skipOption((x) => x.string()),
        observedCorrelationIds: readOptStrings(r),
      };
    case 3:
      return {
        type: "thinking",
        thinking: r.string("Thinking.thinking"),
        correlationId: r.skipOption((x) => x.string()),
        observedCorrelationIds: readOptStrings(r),
      };
    case 4:
      return {
        type: "toolCall",
        toolCall: { id: r.string(), name: r.string(), input: r.string() },
        correlationId: r.skipOption((x) => x.string()),
        observedCorrelationIds: readOptStrings(r),
      };
    case 5:
      return {
        type: "toolResult",
        toolResult: {
          toolCallId: r.string(),
          content: r.string(),
          isError: r.bool(),
        },
        correlationId: r.skipOption((x) => x.string()),
        observedCorrelationIds: readOptStrings(r),
      };
    case 6:
      return {
        type: "toolProgress",
        toolProgress: {
          toolCallId: r.string(),
          toolName: r.string(),
          outputChunk: r.string(),
          isStderr: r.bool(),
        },
        correlationId: r.skipOption((x) => x.string()),
        observedCorrelationIds: readOptStrings(r),
      };
    case 7:
      return { type: "sessionStateChange", state: readEnumAt(r, SESSION_STATE, "SessionState") };
    case 8:
      return {
        type: "userNotification",
        message: r.string(),
        severity: readEnumAt(r, SEVERITY, "NotificationSeverity"),
      };
    case 9:
      return { type: "interrupted", queuedInputs: readVec(r, (x) => x.string("String")) };
    case 10:
      return { type: "tokenUpdate", tokens: readTokenTracker(r) };
    case 11:
      return { type: "contextFillUpdate", contextFill: readContextFill(r) };
    case 12:
      // ContextSnapshot carries a RequestContextSnapshot the plugin does not
      // render; consume it so the frame still parses.
      skipContextSnapshot(r);
      return { type: "contextSnapshot" };
    case 13:
      return { type: "done" };
    case 14:
      return { type: "error", error: r.string("Error.error") };
    case 15:
      return { type: "userInput", text: r.string() };
    case 16:
      // IncomingMessage: text + Option<Vec<IncomingMessageImage>>.
      r.string();
      r.skipOption((x) => readVec(x, (y) => y.string()));
      return { type: "unsupported", index: 16 };
    case 17:
      r.bool();
      r.string();
      return { type: "unsupported", index: 17 };
    case 18:
      return { type: "compactionComplete", compactionResult: readCompactionResult(r) };
    case 19:
      skipCommittedContextSnapshot(r);
      return { type: "unsupported", index: 19 };
    case 20:
      return {
        type: "fspecCommandRequest",
        request: {
          command: r.string("FspecRequest.command"),
          argsJson: r.string("FspecRequest.args_json"),
          projectRoot: r.string("FspecRequest.project_root"),
          toolCallId: r.string("FspecRequest.tool_call_id"),
        },
      };
    case 21:
      return {
        type: "fspecCommandResult",
        result: {
          success: r.bool("FspecResult.success"),
          data: r.string("FspecResult.data"),
          error: r.skipOption((x) => x.string()),
          systemReminder: r.skipOption((x) => x.string()),
          toolCallId: r.string("FspecResult.tool_call_id"),
        },
      };
    case 22:
      readVec(r, readWorkUnitInfo);
      return { type: "unsupported", index: 22 };
    case 23:
      r.bool();
      r.skipOption((x) => x.string());
      r.skipOption((x) => x.string());
      return { type: "unsupported", index: 23 };
    case 24:
      r.string();
      r.string();
      r.bool();
      r.skipOption((x) => x.string());
      return { type: "unsupported", index: 24 };
    case 25:
      r.bool();
      return { type: "unsupported", index: 25 };
    case 26:
      skipContinueState(r);
      return { type: "unsupported", index: 26 };
    case 27:
      return {
        type: "execStdinRequest",
        request: {
          execSessionId: r.string("ExecStdinRequest.exec_session_id"),
          command: r.string("ExecStdinRequest.command"),
          quietSeconds: r.i64("ExecStdinRequest.quiet_seconds"),
          tsMs: r.i64("ExecStdinRequest.ts_ms"),
        },
      };
    case 28:
      return { type: "execStdinRequestCleared" };
    case 29:
      return {
        type: "compactionProgressUpdate",
        progress: r.skipOption(readCompactionProgress),
      };
    case 30:
      return {
        type: "interruptedWithReason",
        queuedInputs: readVec(r, (x) => x.string("String")),
        reason: readEnumAt(r, INTERRUPTION_REASON, "InterruptionReason"),
      };
    default:
      return {
        type: "providerWaiting",
        message: r.skipOption((x) => x.string()),
      };
  }
}

function skipContextSnapshot(r: BincodeReader): void {
  r.string(); // model
  r.i64(); // generation
  r.u64(); // request
  r.skipOption((x) => x.string()); // physical_request
  r.skipOption((x) => x.u64()); // input_tokens
  r.skipOption((x) => x.u64()); // output_tokens
  r.skipOption((x) => x.u64()); // capacity
  r.skipOption((x) => x.u64()); // threshold
  readEnumAt(r, ["measured", "estimated", "unknown"] as const, "ContextProvenance");
}

function skipCommittedContextSnapshot(r: BincodeReader): void {
  r.i64(); // generation
  readTokenTracker(r); // tokens
  readContextFill(r); // context_fill
  r.u32(); // original_tokens
  r.skipOption((x) => x.u32()); // covered_turns
  r.skipOption((x) => x.u32()); // retained_turns
  r.bool(); // estimated
  r.bool(); // reconciled
}

function skipContinueState(r: BincodeReader): void {
  r.bool(); // enabled
  r.u32(); // budget
  r.u32(); // nudges_used
  r.bool(); // goal_active
  r.u32(); // effective_budget
  r.bool(); // goal_cleared
  r.u32(); // done_rejections
}

function writeCorrelation(w: BincodeWriter, c: string | null, ids: string[] | null): void {
  w.option(c, (x, v) => x.string(v));
  writeOptStrings(w, ids);
}

function writeStreamChunk(w: BincodeWriter, c: StreamChunk): void {
  switch (c.type) {
    case "responseAttemptStarted":
      w.enumIndex(0);
      return;
    case "responseAttemptAborted":
      w.enumIndex(1);
      return;
    case "text":
      w.enumIndex(2).string(c.text);
      writeCorrelation(w, c.correlationId, c.observedCorrelationIds);
      return;
    case "thinking":
      w.enumIndex(3).string(c.thinking);
      writeCorrelation(w, c.correlationId, c.observedCorrelationIds);
      return;
    case "toolCall":
      w.enumIndex(4).string(c.toolCall.id).string(c.toolCall.name).string(c.toolCall.input);
      writeCorrelation(w, c.correlationId, c.observedCorrelationIds);
      return;
    case "toolResult":
      w.enumIndex(5).string(c.toolResult.toolCallId).string(c.toolResult.content).bool(c.toolResult.isError);
      writeCorrelation(w, c.correlationId, c.observedCorrelationIds);
      return;
    case "toolProgress":
      w.enumIndex(6)
        .string(c.toolProgress.toolCallId)
        .string(c.toolProgress.toolName)
        .string(c.toolProgress.outputChunk)
        .bool(c.toolProgress.isStderr);
      writeCorrelation(w, c.correlationId, c.observedCorrelationIds);
      return;
    case "sessionStateChange":
      w.enumIndex(7).enumIndex(enumIndex(SESSION_STATE, c.state, "SessionState"));
      return;
    case "userNotification":
      w.enumIndex(8).string(c.message).enumIndex(enumIndex(SEVERITY, c.severity, "NotificationSeverity"));
      return;
    case "interrupted":
      w.enumIndex(9);
      writeVec(w, c.queuedInputs, (x, v) => x.string(v));
      return;
    case "tokenUpdate":
      w.enumIndex(10);
      writeTokenTracker(w, c.tokens);
      return;
    case "contextFillUpdate":
      w.enumIndex(11);
      writeContextFill(w, c.contextFill);
      return;
    case "done":
      w.enumIndex(13);
      return;
    case "error":
      w.enumIndex(14).string(c.error);
      return;
    case "userInput":
      w.enumIndex(15).string(c.text);
      return;
    case "compactionComplete":
      w.enumIndex(18);
      writeCompactionResult(w, c.compactionResult);
      return;
    case "compactionProgressUpdate":
      w.enumIndex(29).option(c.progress, (x, v) => writeCompactionProgress(x, v));
      return;
    case "interruptedWithReason":
      w.enumIndex(30);
      writeVec(w, c.queuedInputs, (x, v) => x.string(v));
      w.enumIndex(enumIndex(INTERRUPTION_REASON, c.reason, "InterruptionReason"));
      return;
    case "providerWaiting":
      w.enumIndex(31).option(c.message, (x, v) => x.string(v));
      return;
    case "fspecCommandRequest":
      w.enumIndex(20)
        .string(c.request.command)
        .string(c.request.argsJson)
        .string(c.request.projectRoot)
        .string(c.request.toolCallId);
      return;
    case "fspecCommandResult":
      w.enumIndex(21).bool(c.result.success).string(c.result.data);
      w.option(c.result.error, (x, v) => x.string(v));
      w.option(c.result.systemReminder, (x, v) => x.string(v));
      w.string(c.result.toolCallId);
      return;
    case "execStdinRequest":
      w.enumIndex(27)
        .string(c.request.execSessionId)
        .string(c.request.command)
        .i64(c.request.quietSeconds)
        .i64(c.request.tsMs);
      return;
    case "execStdinRequestCleared":
      w.enumIndex(28);
      return;
    case "contextSnapshot":
      throw new Error("StreamChunk contextSnapshot is decode-only (the plugin never sends it)");
    case "unsupported":
      throw new Error(`StreamChunk variant index ${c.index} is decode-only (unknown to this codec)`);
  }
}

// ---------------------------------------------------------------------------
// Catalog payloads (§6.7) — list_providers (idx 28)
// ---------------------------------------------------------------------------

function readModelEntry(r: BincodeReader): ModelEntry {
  return {
    id: r.string("ModelEntry.id"),
    displayName: r.string("ModelEntry.display_name"),
    contextWindow: r.u32("ModelEntry.context_window"),
    supportsReasoning: r.bool(),
    supportsVision: r.bool(),
    isCustom: r.bool(),
  };
}

function writeModelEntry(w: BincodeWriter, m: ModelEntry): void {
  w.string(m.id)
    .string(m.displayName)
    .u32(m.contextWindow)
    .bool(m.supportsReasoning)
    .bool(m.supportsVision)
    .bool(m.isCustom);
}

function writeProviderInfo(w: BincodeWriter, p: ProviderInfo): void {
  w.string(p.key).string(p.displayName);
  writeVec(w, p.models, writeModelEntry);
  w.option(p.profileName, (x, v) => x.string(v)).bool(p.isUnreachable);
}

function readProviderInfo(r: BincodeReader): ProviderInfo {
  return {
    key: r.string("ProviderInfo.key"),
    displayName: r.string("ProviderInfo.display_name"),
    models: readVec(r, readModelEntry),
    profileName: r.skipOption((x) => x.string()),
    isUnreachable: r.bool(),
  };
}

// Provider settings payloads (FSPEC-041). Every read is labelled with its
// field so a decode error names the field, never the (possibly secret) bytes.

function optString(r: BincodeReader, what: string): string | null {
  return r.optionTag(what) ? r.string(what) : null;
}
function optU32(r: BincodeReader, what: string): number | null {
  return r.optionTag(what) ? r.u32(what) : null;
}
function optBool(r: BincodeReader, what: string): boolean | null {
  return r.optionTag(what) ? r.bool(what) : null;
}

function readProviderCredentialInfo(r: BincodeReader): ProviderCredentialInfo {
  return {
    providerId: r.string("ProviderCredentialInfo.provider_id"),
    displayName: r.string("ProviderCredentialInfo.display_name"),
    configured: r.bool("ProviderCredentialInfo.configured"),
    credentialType: r.string("ProviderCredentialInfo.credential_type"),
    modelCount: r.u32("ProviderCredentialInfo.model_count"),
    maskedKey: optString(r, "ProviderCredentialInfo.masked_key"),
    source: optString(r, "ProviderCredentialInfo.source"),
  };
}

function writeProviderCredentialInfo(w: BincodeWriter, c: ProviderCredentialInfo): void {
  w.string(c.providerId).string(c.displayName).bool(c.configured).string(c.credentialType).u32(c.modelCount);
  w.option(c.maskedKey, (x, v) => x.string(v)).option(c.source, (x, v) => x.string(v));
}

function readProviderCredentialInput(r: BincodeReader): ProviderCredentialInput {
  return {
    kind: r.string("ProviderCredentialInput.kind"),
    apiKey: optString(r, "ProviderCredentialInput.api_key"),
    oauthToken: optString(r, "ProviderCredentialInput.oauth_token"),
    oauthRefreshToken: optString(r, "ProviderCredentialInput.oauth_refresh_token"),
    customEndpoint: optString(r, "ProviderCredentialInput.custom_endpoint"),
    customApiKey: optString(r, "ProviderCredentialInput.custom_api_key"),
  };
}

function writeProviderCredentialInput(w: BincodeWriter, c: ProviderCredentialInput): void {
  const str = (x: BincodeWriter, v: string) => x.string(v);
  w.string(c.kind)
    .option(c.apiKey, str)
    .option(c.oauthToken, str)
    .option(c.oauthRefreshToken, str)
    .option(c.customEndpoint, str)
    .option(c.customApiKey, str);
}

function readTestConnectionResult(r: BincodeReader): TestConnectionResult {
  return {
    success: r.bool("TestConnectionResult.success"),
    error: optString(r, "TestConnectionResult.error"),
    latencyMs: r.u32("TestConnectionResult.latency_ms"),
  };
}

function readOAuthHeadlessStart(r: BincodeReader): OAuthHeadlessStart {
  return {
    authorizeUrl: r.string("OAuthHeadlessStart.authorize_url"),
    pkceVerifier: r.string("OAuthHeadlessStart.pkce_verifier"),
  };
}

function readOAuthDeviceStart(r: BincodeReader): OAuthDeviceStart {
  return {
    userCode: r.string("OAuthDeviceStart.user_code"),
    verificationUrl: r.string("OAuthDeviceStart.verification_url"),
    deviceAuthId: r.string("OAuthDeviceStart.device_auth_id"),
    interval: r.u64("OAuthDeviceStart.interval"),
  };
}

function readCustomModelDefinition(r: BincodeReader): CustomModelDefinition {
  return {
    id: r.string("CustomModelDefinition.id"),
    displayName: optString(r, "CustomModelDefinition.display_name"),
    facade: optString(r, "CustomModelDefinition.facade"),
    contextWindow: optU32(r, "CustomModelDefinition.context_window"),
    maxOutputTokens: optU32(r, "CustomModelDefinition.max_output_tokens"),
    compactionThresholdType: optString(r, "CustomModelDefinition.compaction_threshold_type"),
    compactionThresholdValue: optU32(r, "CustomModelDefinition.compaction_threshold_value"),
    reasoning: optBool(r, "CustomModelDefinition.reasoning"),
    hasVision: optBool(r, "CustomModelDefinition.has_vision"),
  };
}

function writeCustomModelDefinition(w: BincodeWriter, m: CustomModelDefinition): void {
  const str = (x: BincodeWriter, v: string) => x.string(v);
  const u32 = (x: BincodeWriter, v: number) => x.u32(v);
  const bool = (x: BincodeWriter, v: boolean) => x.bool(v);
  w.string(m.id)
    .option(m.displayName, str)
    .option(m.facade, str)
    .option(m.contextWindow, u32)
    .option(m.maxOutputTokens, u32)
    .option(m.compactionThresholdType, str)
    .option(m.compactionThresholdValue, u32)
    .option(m.reasoning, bool)
    .option(m.hasVision, bool);
}

function readProfileDefinition(r: BincodeReader): ProfileDefinition {
  return {
    baseUrl: r.string("ProfileDefinition.base_url"),
    apiKey: r.string("ProfileDefinition.api_key"),
    contextWindow: optU32(r, "ProfileDefinition.context_window"),
    maxOutputTokens: optU32(r, "ProfileDefinition.max_output_tokens"),
    compactionThresholdType: optString(r, "ProfileDefinition.compaction_threshold_type"),
    compactionThresholdValue: optU32(r, "ProfileDefinition.compaction_threshold_value"),
    streaming: optBool(r, "ProfileDefinition.streaming"),
    autoContinue: optU32(r, "ProfileDefinition.auto_continue"),
    preserveThinking: optBool(r, "ProfileDefinition.preserve_thinking"),
    maxImages: optU32(r, "ProfileDefinition.max_images"),
    loopDetectionEnabled: optBool(r, "ProfileDefinition.loop_detection_enabled"),
    loopDetectionWindow: optU32(r, "ProfileDefinition.loop_detection_window"),
    loopDetectionMaxRepeats: optU32(r, "ProfileDefinition.loop_detection_max_repeats"),
    loopDetectionMaxRetries: optU32(r, "ProfileDefinition.loop_detection_max_retries"),
  };
}

function writeProfileDefinition(w: BincodeWriter, p: ProfileDefinition): void {
  const str = (x: BincodeWriter, v: string) => x.string(v);
  const u32 = (x: BincodeWriter, v: number) => x.u32(v);
  const bool = (x: BincodeWriter, v: boolean) => x.bool(v);
  w.string(p.baseUrl)
    .string(p.apiKey)
    .option(p.contextWindow, u32)
    .option(p.maxOutputTokens, u32)
    .option(p.compactionThresholdType, str)
    .option(p.compactionThresholdValue, u32)
    .option(p.streaming, bool)
    .option(p.autoContinue, u32)
    .option(p.preserveThinking, bool)
    .option(p.maxImages, u32)
    .option(p.loopDetectionEnabled, bool)
    .option(p.loopDetectionWindow, u32)
    .option(p.loopDetectionMaxRepeats, u32)
    .option(p.loopDetectionMaxRetries, u32);
}

function readProviderSettingsConfig(r: BincodeReader): ProviderSettingsConfig {
  return {
    providerId: r.string("ProviderSettingsConfig.provider_id"),
    settings: readProfileDefinition(r),
    profiles: readVec(r, (x) => ({ name: x.string("ProviderProfileConfig.name"), definition: readProfileDefinition(x) })),
  };
}

function writeProviderSettingsConfig(w: BincodeWriter, c: ProviderSettingsConfig): void {
  w.string(c.providerId);
  writeProfileDefinition(w, c.settings);
  writeVec(w, c.profiles, (x, p) => {
    x.string(p.name);
    writeProfileDefinition(x, p.definition);
  });
}

function writeResult<T>(w: BincodeWriter, result: Result<T>, write: (w: BincodeWriter, v: T) => void): void {
  if (result.ok) {
    w.enumIndex(RESULT_OK);
    write(w, result.value);
  } else w.enumIndex(RESULT_ERR).string(result.error);
}

// ---------------------------------------------------------------------------
// Envelope encode / decode (§2)
// ---------------------------------------------------------------------------

const ENVELOPE_NAMES = [
  "Rpc",
  "Event",
  "LogEvent",
  "WorkUnitsUpdate",
  "StatusUpdate",
  "CmdReq",
  "CmdRes",
  "SessionEvent",
  "SessionSnapshot",
] as const;

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  const w = new BincodeWriter();
  switch (envelope.kind) {
    case "rpc":
      w.enumIndex(0).lengthPrefixedBytes(envelope.frame);
      break;
    case "event":
      w.enumIndex(1).string(envelope.sessionId);
      writeStreamChunk(w, envelope.chunk);
      break;
    case "logEvent":
      w.enumIndex(2)
        .string(envelope.level)
        .string(envelope.target)
        .string(envelope.message)
        .i64(envelope.timestampMs);
      break;
    case "workUnitsUpdate":
      w.enumIndex(3);
      writeVec(w, envelope.workUnits, writeWorkUnitInfo);
      break;
    case "statusUpdate":
      w.enumIndex(4)
        .string(envelope.sessionId)
        .enumIndex(enumIndex(SESSION_STATUS, envelope.status, "SessionStatus"));
      break;
    case "cmdReq":
      w.enumIndex(5);
      break;
    case "cmdRes":
      w.enumIndex(6);
      break;
    case "sessionEvent":
      w.enumIndex(7);
      writeSessionEvent(w, envelope.event);
      break;
    case "sessionSnapshot":
      w.enumIndex(8);
      writeVec(w, envelope.sessions, writeSessionInfo);
      break;
  }
  return w.finish();
}

export function decodeEnvelope(bytes: Uint8Array): Envelope {
  const r = new BincodeReader(bytes);
  const at = r.offset;
  const index = r.enumIndex("Envelope");
  if (index > 8) {
    throw new WireDecodeError(
      `unknown Envelope variant index ${index} at offset ${at} (known: 0..8)`,
    );
  }
  switch (index) {
    case 0:
      return { kind: "rpc", frame: r.lengthPrefixedBytes("Envelope::Rpc") };
    case 1: {
      const sessionId = r.string("SessionId");
      return { kind: "event", sessionId, chunk: readStreamChunk(r) };
    }
    case 2:
      return {
        kind: "logEvent",
        level: r.string("LogRecord.level"),
        target: r.string("LogRecord.target"),
        message: r.string("LogRecord.message"),
        timestampMs: r.i64("LogRecord.timestamp_ms"),
      };
    case 3:
      return { kind: "workUnitsUpdate", workUnits: readVec(r, readWorkUnitInfo) };
    case 4:
      return {
        kind: "statusUpdate",
        sessionId: r.string("SessionId"),
        status: readEnumAt(r, SESSION_STATUS, "SessionStatus"),
      };
    case 5:
      return { kind: "cmdReq" };
    case 6:
      return { kind: "cmdRes" };
    case 7:
      return { kind: "sessionEvent", event: readSessionEvent(r) };
    default:
      return { kind: "sessionSnapshot", sessions: readVec(r, readSessionInfo) };
  }
}

/** The Envelope variant index a decoded value would occupy on the wire. */
export function envelopeVariantIndex(envelope: Envelope): number {
  const kinds = [
    "rpc",
    "event",
    "logEvent",
    "workUnitsUpdate",
    "statusUpdate",
    "cmdReq",
    "cmdRes",
    "sessionEvent",
    "sessionSnapshot",
  ] as const;
  const i = kinds.indexOf(envelope.kind);
  if (i < 0) throw new Error(`unknown Envelope kind ${String(envelope.kind)}`);
  return i;
}

// ---------------------------------------------------------------------------
// tarpc 0.34.0 framing inside Envelope::Rpc (§4)
//
// ClientMessage::Request = u32 0 | context(40B) | id(u64) | FspecServiceRequest
// Response               = request_id(u64) | Result variant u32 (0 Ok / 1 Err) | payload
// ---------------------------------------------------------------------------

export interface RequestContext {
  /** Serialized by tarpc as a relative Duration: secs(u64) + nanos(u32). */
  deadlineMs: number;
  traceId?: Uint8Array; // 16 raw LE bytes
  spanId?: number;
  /** 0 = Sampled, 1 = Unsampled (tarpc::trace::SamplingDecision). */
  samplingDecision?: 0 | 1;
}

function writeContext(w: BincodeWriter, ctx: RequestContext): void {
  const ms = Math.max(0, Math.trunc(ctx.deadlineMs));
  w.u64(Math.floor(ms / 1000)).u32((ms % 1000) * 1_000_000);
  const traceId = ctx.traceId ?? new Uint8Array(16);
  if (traceId.length !== 16) throw new Error("traceId must be 16 raw LE bytes");
  w.bytes(traceId);
  w.u64(ctx.spanId ?? 0);
  w.u32(ctx.samplingDecision ?? 1);
}

function readContext(r: BincodeReader): { deadlineMs: number } {
  const secs = r.u64("context.deadline secs");
  const nanos = r.u32("context.deadline nanos");
  r.u128("context.trace_id");
  r.u64("context.span_id");
  r.u32("context.sampling_decision");
  return { deadlineMs: secs * 1000 + nanos / 1_000_000 };
}

function writeServiceRequest(w: BincodeWriter, message: FspecServiceRequest): void {
  const index = FspecMethodIndex[message.method];
  w.enumIndex(index);
  switch (message.method) {
    case "listWorkUnits":
    case "listLiveSessions":
    case "health":
    case "getWorkspaceInfo":
    case "listProviders":
      return;
    case "persistenceSearchHistory":
      w.string(message.query);
      return;
    case "listSessions":
      w.string(message.projectPath);
      return;
    case "createSession":
    case "createSessionChecked":
      w.option(message.role, (x, v) => x.string(v));
      return;
    case "sendInput":
      w.string(message.sessionId).string(message.text);
      return;
    case "interrupt":
    case "getSessionStatus":
    case "getModelInfo":
    case "getThinkingLevel":
    case "destroySession":
    case "resumeSession":
    case "getPauseState":
    case "getHitlRequest":
    case "getInteractionSnapshot":
    case "getSubordinates":
    case "getSupervisors":
    case "setActiveSession":
    case "getContinueState":
    case "getGoalState":
    case "clearHistory":
    case "compactSession":
    case "getWorkUnitFocus":
    case "getPendingInput":
      w.string(message.sessionId);
      return;
    case "setContinueState":
      w.string(message.sessionId).bool(message.enabled).u32(message.budget);
      return;
    case "setGoalState":
      w.string(message.sessionId).option(message.goal, (x, goal) => {
        x.string(goal.text).option(goal.verify, (y, verify) => y.string(verify));
      });
      return;
    case "setWorkUnitFocus":
      w.string(message.sessionId).option(message.workUnitId, (x, id) => x.string(id)).string(message.source);
      return;
    case "getWorkUnitDetails":
    case "moveWorkUnitUp":
    case "moveWorkUnitDown":
      w.string(message.id);
      return;
    case "clearActiveSession":
    case "getActiveSession":
    case "listCheckpoints":
      return;
    case "restoreCheckpointAll":
      w.string(message.workUnitId).string(message.name);
      return;
    case "replyInteractionChecked":
      w.string(message.sessionId).string(message.interaction).string(message.requestId).string(message.arguments);
      return;
    case "writeExecStdin":
      w.string(message.sessionId).string(message.execSessionId).string(message.text);
      return;
    case "sendHitlResponse":
      w.string(message.sessionId).bool(message.response.cancelled);
      writeVec(w, message.response.answers, (x, answer) => {
        x.string(answer.id);
        writeVec(x, answer.selected, (y, label) => y.string(label));
        x.option(answer.other, (y, text) => y.string(text));
      });
      return;
    case "pauseConfirm":
      w.string(message.sessionId).bool(message.accept);
      return;
    case "pauseTriple":
      w.string(message.sessionId).enumIndex(enumIndex(APPROVAL_CHOICE, message.choice, "ApprovalChoice"));
      return;
    case "setSessionModel":
      w.string(message.sessionId).string(message.providerId).string(message.modelId);
      return;
    case "setThinkingLevel":
      w.string(message.sessionId).enumIndex(enumIndex(THINKING_LEVEL, message.level, "ThinkingLevel"));
      return;
    case "sendInputWithThinking":
      w.string(message.sessionId).string(message.text);
      w.option(message.thinking, (x, v) =>
        x
          .string(v.providerId)
          .enumIndex(enumIndex(THINKING_LEVEL, v.level, "ThinkingLevel"))
          .string(v.configJson),
      );
      return;
    case "getTranscriptPage":
      w.string(message.sessionId);
      w.option(message.cursor, writeTranscriptCursor);
      w.option(message.snapshotEnd, (x, v) => x.u64(v));
      w.u32(message.maxBytes);
      return;
    case "setDefaultModel":
      w.string(message.model);
      return;
    case "addCustomModel":
      w.string(message.providerId).string(message.profileName);
      writeCustomModelDefinition(w, message.definition);
      return;
    case "updateCustomModel":
      w.string(message.providerId).string(message.profileName).string(message.originalModelId);
      writeCustomModelDefinition(w, message.definition);
      return;
    case "deleteCustomModel":
      w.string(message.providerId).string(message.profileName).string(message.modelId);
      return;
    case "listProviderSettings":
    case "listProviderCredentials":
      return;
    case "saveProviderSettings":
      w.string(message.providerId);
      writeProfileDefinition(w, message.definition);
      return;
    case "saveProfile":
      w.string(message.providerId).string(message.profileName);
      writeProfileDefinition(w, message.definition);
      return;
    case "deleteProfile":
      w.string(message.providerId).string(message.profileName);
      return;
    case "renameProfile":
      w.string(message.providerId).string(message.oldName).string(message.newName);
      writeProfileDefinition(w, message.definition);
      return;
    case "setProviderCredentials":
      w.string(message.providerId);
      writeProviderCredentialInput(w, message.creds);
      return;
    case "getProviderCredential":
    case "deleteProviderCredentials":
    case "testProviderConnection":
    case "refreshModelsCache":
    case "oauthClearTokens":
    case "oauthGetTokens":
    case "oauthBrowserLogin":
    case "oauthHeadlessStart":
    case "oauthDeviceStart":
      w.string(message.providerId);
      return;
    case "oauthHeadlessComplete":
      w.string(message.providerId).string(message.codeWithState).string(message.pkceVerifier);
      return;
    case "oauthDevicePoll":
      w.string(message.providerId).string(message.deviceAuthId).u64(message.interval);
      return;
    case "oauthCopilotDeviceStart":
      w.option(message.enterpriseHost, (x, v) => x.string(v));
      return;
  }
}

function readServiceRequest(r: BincodeReader): FspecServiceRequest {
  const at = r.offset;
  const index = r.enumIndex("FspecServiceRequest");
  const method = INDEX_TO_METHOD.get(index);
  if (method === undefined) {
    throw new WireDecodeError(
      `unknown FspecServiceRequest variant index ${index} at offset ${at}`,
    );
  }
  switch (method) {
    case "listWorkUnits":
      return { method };
    case "persistenceSearchHistory":
      return { method, query: r.string() };
    case "listSessions":
      return { method, projectPath: r.string() };
    case "listLiveSessions":
      return { method };
    case "createSession":
    case "createSessionChecked":
      return { method, role: r.skipOption((x) => x.string()) };
    case "sendInput": {
      const sessionId = r.string("SessionId");
      return { method, sessionId, text: r.string() };
    }
    case "interrupt":
    case "getSessionStatus":
    case "getModelInfo":
    case "getThinkingLevel":
    case "destroySession":
    case "resumeSession":
    case "getPauseState":
    case "getHitlRequest":
    case "getInteractionSnapshot":
    case "getSubordinates":
    case "getSupervisors":
    case "setActiveSession":
    case "getContinueState":
    case "getGoalState":
    case "clearHistory":
    case "compactSession":
    case "getWorkUnitFocus":
    case "getPendingInput":
      return { method, sessionId: r.string("SessionId") };
    case "getWorkUnitDetails":
    case "moveWorkUnitUp":
    case "moveWorkUnitDown":
      return { method, id: r.string("id") };
    case "setContinueState": {
      const sessionId = r.string("SessionId");
      const enabled = r.bool("enabled");
      return { method, sessionId, enabled, budget: r.u32("budget") };
    }
    case "setGoalState": {
      const sessionId = r.string("SessionId");
      const goal = r.skipOption((x) => ({ text: x.string("goal"), verify: x.skipOption((y) => y.string("verify")) }));
      return { method, sessionId, goal };
    }
    case "setWorkUnitFocus": {
      const sessionId = r.string("SessionId");
      const workUnitId = r.skipOption((x) => x.string("work_unit_id"));
      return { method, sessionId, workUnitId, source: r.string("source") };
    }
    case "clearActiveSession":
    case "getActiveSession":
    case "listCheckpoints":
      return { method };
    case "restoreCheckpointAll": {
      const workUnitId = r.string("work_unit_id");
      return { method, workUnitId, name: r.string("name") };
    }
    case "writeExecStdin": {
      const sessionId = r.string("SessionId");
      const execSessionId = r.string("exec_session_id");
      return { method, sessionId, execSessionId, text: r.string("text") };
    }
    case "replyInteractionChecked": {
      const sessionId = r.string("SessionId");
      const interaction = r.string("method");
      const requestId = r.string("request_id");
      return { method, sessionId, interaction, requestId, arguments: r.string("arguments") };
    }
    case "sendHitlResponse": {
      const sessionId = r.string("SessionId");
      const cancelled = r.bool("HitlResponse.cancelled");
      const answers = readVec(r, (x) => ({
        id: x.string("HitlAnswer.id"),
        selected: readVec(x, (y) => y.string("HitlAnswer.selected")),
        other: x.skipOption((y) => y.string("HitlAnswer.other")),
      }));
      return { method, sessionId, response: { cancelled, answers } };
    }
    case "pauseConfirm": {
      const sessionId = r.string("SessionId");
      return { method, sessionId, accept: r.bool("accept") };
    }
    case "pauseTriple": {
      const sessionId = r.string("SessionId");
      return { method, sessionId, choice: readEnumAt(r, APPROVAL_CHOICE, "ApprovalChoice") };
    }
    case "health":
    case "getWorkspaceInfo":
    case "listProviders":
      return { method };
    case "setSessionModel": {
      const sessionId = r.string("SessionId");
      return {
        method,
        sessionId,
        providerId: r.string(),
        modelId: r.string(),
      };
    }
    case "setThinkingLevel":
      return {
        method,
        sessionId: r.string("SessionId"),
        level: readEnumAt(r, THINKING_LEVEL, "ThinkingLevel"),
      };
    case "sendInputWithThinking": {
      const sessionId = r.string("SessionId");
      const text = r.string();
      const thinking = r.skipOption((x) => ({
        providerId: x.string(),
        level: readEnumAt(x, THINKING_LEVEL, "ThinkingLevel"),
        configJson: x.string(),
      }));
      return { method, sessionId, text, thinking };
    }
    case "getTranscriptPage": {
      const sessionId = r.string("SessionId");
      const cursor = r.skipOption(readTranscriptCursor);
      const snapshotEnd = r.skipOption((x) => x.u64("snapshot_end"));
      return { method, sessionId, cursor, snapshotEnd, maxBytes: r.u32("max_bytes") };
    }
    case "setDefaultModel":
      return { method, model: r.string("model") };
    case "addCustomModel": {
      const providerId = r.string("provider_id");
      const profileName = r.string("profile_name");
      return { method, providerId, profileName, definition: readCustomModelDefinition(r) };
    }
    case "updateCustomModel": {
      const providerId = r.string("provider_id");
      const profileName = r.string("profile_name");
      const originalModelId = r.string("original_model_id");
      return { method, providerId, profileName, originalModelId, definition: readCustomModelDefinition(r) };
    }
    case "deleteCustomModel": {
      const providerId = r.string("provider_id");
      const profileName = r.string("profile_name");
      return { method, providerId, profileName, modelId: r.string("model_id") };
    }
    case "listProviderSettings":
    case "listProviderCredentials":
      return { method };
    case "saveProviderSettings": {
      const providerId = r.string("provider_id");
      return { method, providerId, definition: readProfileDefinition(r) };
    }
    case "saveProfile": {
      const providerId = r.string("provider_id");
      const profileName = r.string("profile_name");
      return { method, providerId, profileName, definition: readProfileDefinition(r) };
    }
    case "deleteProfile": {
      const providerId = r.string("provider_id");
      return { method, providerId, profileName: r.string("profile_name") };
    }
    case "renameProfile": {
      const providerId = r.string("provider_id");
      const oldName = r.string("old_name");
      const newName = r.string("new_name");
      return { method, providerId, oldName, newName, definition: readProfileDefinition(r) };
    }
    case "setProviderCredentials": {
      const providerId = r.string("provider_id");
      return { method, providerId, creds: readProviderCredentialInput(r) };
    }
    case "getProviderCredential":
    case "deleteProviderCredentials":
    case "testProviderConnection":
    case "refreshModelsCache":
    case "oauthClearTokens":
    case "oauthGetTokens":
    case "oauthBrowserLogin":
    case "oauthHeadlessStart":
    case "oauthDeviceStart":
      return { method, providerId: r.string("provider_id") };
    case "oauthHeadlessComplete": {
      const providerId = r.string("provider_id");
      const codeWithState = r.string("code_with_state");
      return { method, providerId, codeWithState, pkceVerifier: r.string("pkce_verifier") };
    }
    case "oauthDevicePoll": {
      const providerId = r.string("provider_id");
      const deviceAuthId = r.string("device_auth_id");
      return { method, providerId, deviceAuthId, interval: r.u64("interval") };
    }
    case "oauthCopilotDeviceStart":
      return { method, enterpriseHost: optString(r, "enterprise_host") };
    default:
      throw new WireDecodeError(
        `FspecServiceRequest variant ${method} at index ${index} is not part of this codec's request surface`,
      );
  }
}

/**
 * serde's Result is a bincode enum: a u32 LE variant index, Ok=0 then Err=1
 * (verified against Rust bincode 1.3.3 + tarpc 0.34 golden vectors).
 */
const RESULT_OK = 0;
const RESULT_ERR = 1;

export interface TarpcRequestFrame {
  context: { deadlineMs: number };
  id: number;
  message: FspecServiceRequest;
}

/**
 * A decoded tarpc Response. `ok: false` carries the tarpc ServerError detail
 * (transport-level abort); a service-level `Err(String)` arrives inside the
 * `Ok` arm as a `Result` payload on the method's own value.
 */
export type DecodedResponse =
  | { requestId: number; ok: false; error: string }
  | { requestId: number; ok: true; method: "listWorkUnits"; workUnits: WorkUnitInfo[] }
  | { requestId: number; ok: true; method: "listSessions"; sessions: SessionInfo[] }
  | { requestId: number; ok: true; method: "persistenceSearchHistory"; result: Result<HistoryMatch[]> }
  | { requestId: number; ok: true; method: "listLiveSessions"; sessionIds: string[] }
  | { requestId: number; ok: true; method: "createSession"; sessionId: string }
  | { requestId: number; ok: true; method: "createSessionChecked"; result: Result<string> }
  | { requestId: number; ok: true; method: "sendInput" }
  | { requestId: number; ok: true; method: "interrupt" }
  | { requestId: number; ok: true; method: "getSessionStatus"; status: SessionStatus }
  | { requestId: number; ok: true; method: "health"; value: unknown }
  | { requestId: number; ok: true; method: "getWorkspaceInfo"; workspace: WorkspaceInfo }
  | { requestId: number; ok: true; method: "getModelInfo"; value: unknown }
  | { requestId: number; ok: true; method: "getThinkingLevel"; level: ThinkingLevel }
  | { requestId: number; ok: true; method: "listProviders"; providers: ProviderInfo[] }
  | { requestId: number; ok: true; method: "setSessionModel"; result: Result<void> }
  | { requestId: number; ok: true; method: "setThinkingLevel"; result: Result<void> }
  | { requestId: number; ok: true; method: "sendInputWithThinking" }
  | { requestId: number; ok: true; method: "destroySession"; result: Result<void> }
  | { requestId: number; ok: true; method: "moveWorkUnitUp"; result: Result<void> }
  | { requestId: number; ok: true; method: "moveWorkUnitDown"; result: Result<void> }
  | { requestId: number; ok: true; method: "resumeSession"; result: Result<void> }
  | { requestId: number; ok: true; method: "getPauseState"; pause: PauseState | null }
  | { requestId: number; ok: true; method: "pauseConfirm"; result: Result<void> }
  | { requestId: number; ok: true; method: "pauseTriple"; result: Result<void> }
  | { requestId: number; ok: true; method: "getHitlRequest"; request: HitlRequest | null }
  | { requestId: number; ok: true; method: "sendHitlResponse"; result: Result<void> }
  | { requestId: number; ok: true; method: "getInteractionSnapshot"; result: Result<string> }
  | { requestId: number; ok: true; method: "getWorkUnitDetails"; result: Result<string> }
  | { requestId: number; ok: true; method: "replyInteractionChecked"; result: Result<void> }
  | { requestId: number; ok: true; method: "writeExecStdin"; result: Result<void> }
  | { requestId: number; ok: true; method: "getSupervisors"; sessions: string[] }
  | { requestId: number; ok: true; method: "getSubordinates"; sessions: string[] }
  | { requestId: number; ok: true; method: "setActiveSession" }
  | { requestId: number; ok: true; method: "clearActiveSession" }
  | { requestId: number; ok: true; method: "getActiveSession"; sessionId: string | null }
  | { requestId: number; ok: true; method: "setContinueState"; result: Result<void> }
  | { requestId: number; ok: true; method: "getContinueState"; state: { enabled: boolean; budget: number } }
  | { requestId: number; ok: true; method: "setGoalState"; result: Result<void> }
  | { requestId: number; ok: true; method: "getGoalState"; goal: GoalState | null }
  | { requestId: number; ok: true; method: "clearHistory"; result: Result<void> }
  | { requestId: number; ok: true; method: "compactSession"; result: Result<CompactionResult> }
  | { requestId: number; ok: true; method: "setWorkUnitFocus"; result: Result<WorkUnitFocus> }
  | { requestId: number; ok: true; method: "listCheckpoints"; checkpoints: CheckpointInfo[] }
  | { requestId: number; ok: true; method: "getWorkUnitFocus"; result: Result<WorkUnitFocus> }
  | { requestId: number; ok: true; method: "getPendingInput"; text: string | null }
  | { requestId: number; ok: true; method: "restoreCheckpointAll"; result: Result<void> }
  | { requestId: number; ok: true; method: "getTranscriptPage"; result: TranscriptResult }
  // One member per method (not `method: VoidSettingsMethod`), so Extract narrows by method.
  | { [M in VoidSettingsMethod]: { requestId: number; ok: true; method: M; result: Result<void> } }[VoidSettingsMethod]
  | { requestId: number; ok: true; method: "listProviderSettings"; result: Result<ProviderSettingsConfig[]> }
  | { requestId: number; ok: true; method: "listProviderCredentials"; credentials: ProviderCredentialInfo[] }
  | { requestId: number; ok: true; method: "getProviderCredential"; credential: ProviderCredentialInfo | null }
  | { requestId: number; ok: true; method: "testProviderConnection"; result: Result<TestConnectionResult> }
  | { requestId: number; ok: true; method: "refreshModelsCache"; result: Result<ModelEntry[]> }
  | { requestId: number; ok: true; method: "oauthGetTokens"; result: Result<boolean> }
  | { requestId: number; ok: true; method: "oauthHeadlessStart"; result: Result<OAuthHeadlessStart> }
  | { requestId: number; ok: true; method: "oauthDeviceStart"; result: Result<OAuthDeviceStart> }
  | { requestId: number; ok: true; method: "oauthCopilotDeviceStart"; result: Result<OAuthDeviceStart> };

/** Encodes the tarpc ClientMessage bytes carried by Envelope::Rpc. */
export function encodeRequestFrame(input: {
  context?: RequestContext;
  deadlineMs?: number;
  id: number;
  message: FspecServiceRequest;
}): Uint8Array {
  const w = new BincodeWriter();
  w.enumIndex(0); // ClientMessage::Request
  writeContext(w, input.context ?? { deadlineMs: input.deadlineMs ?? 10_000 });
  w.u64(input.id);
  writeServiceRequest(w, input.message);
  return w.finish();
}

export function decodeRequestFrame(bytes: Uint8Array): TarpcRequestFrame {
  const r = new BincodeReader(bytes);
  const at = r.offset;
  const index = r.enumIndex("ClientMessage");
  if (index !== 0) {
    throw new WireDecodeError(
      `unexpected ClientMessage variant index ${index} at offset ${at} (only Request=0 is decodable here)`,
    );
  }
  const context = readContext(r);
  const id = r.u64("Request.id");
  return { context, id, message: readServiceRequest(r) };
}

/** Encodes a tarpc Response frame (the server→client direction). */
export function encodeResponseFrame(input: {
  requestId: number;
  message: FspecServiceRequest["method"];
  value?: unknown;
  error?: string;
}): Uint8Array {
  const w = new BincodeWriter();
  w.u64(input.requestId);
  if (input.error !== undefined) {
    w.enumIndex(RESULT_ERR).u32(0).string(input.error); // ServerError { kind: u32, detail: String }
    return w.finish();
  }
  w.enumIndex(RESULT_OK);
  w.enumIndex(FspecMethodIndex[input.message]);
  switch (input.message) {
    case "createSession":
      w.string(String(input.value));
      break;
    case "setSessionModel":
    case "setThinkingLevel":
    case "moveWorkUnitUp":
    case "moveWorkUnitDown":
    case "destroySession":
    case "resumeSession":
    case "pauseConfirm":
    case "pauseTriple":
    case "sendHitlResponse":
    case "replyInteractionChecked":
    case "writeExecStdin":
    case "setContinueState":
    case "setGoalState":
    case "clearHistory":
    case "restoreCheckpointAll":
    case "setDefaultModel":
    case "addCustomModel":
    case "updateCustomModel":
    case "deleteCustomModel":
    case "saveProviderSettings":
    case "saveProfile":
    case "deleteProfile":
    case "renameProfile":
    case "setProviderCredentials":
    case "deleteProviderCredentials":
    case "oauthClearTokens":
    case "oauthBrowserLogin":
    case "oauthHeadlessComplete":
    case "oauthDevicePoll": {
      const result = input.value as Result<void>;
      if (result.ok) w.enumIndex(RESULT_OK);
      else w.enumIndex(RESULT_ERR).string(result.error);
      break;
    }
    case "listProviderSettings":
      writeResult(w, input.value as Result<ProviderSettingsConfig[]>, (x, v) =>
        writeVec(x, v, writeProviderSettingsConfig),
      );
      break;
    case "listProviderCredentials":
      writeVec(w, (input.value ?? []) as ProviderCredentialInfo[], writeProviderCredentialInfo);
      break;
    case "getProviderCredential":
      w.option((input.value ?? null) as ProviderCredentialInfo | null, writeProviderCredentialInfo);
      break;
    case "testProviderConnection":
      writeResult(w, input.value as Result<TestConnectionResult>, (x, t) => {
        x.bool(t.success).option(t.error, (y, e) => y.string(e)).u32(t.latencyMs);
      });
      break;
    case "refreshModelsCache":
      writeResult(w, input.value as Result<ModelEntry[]>, (x, v) => writeVec(x, v, writeModelEntry));
      break;
    case "oauthGetTokens":
      writeResult(w, input.value as Result<boolean>, (x, v) => x.bool(v));
      break;
    case "oauthHeadlessStart":
      writeResult(w, input.value as Result<OAuthHeadlessStart>, (x, v) => {
        x.string(v.authorizeUrl).string(v.pkceVerifier);
      });
      break;
    case "oauthDeviceStart":
    case "oauthCopilotDeviceStart":
      writeResult(w, input.value as Result<OAuthDeviceStart>, (x, v) => {
        x.string(v.userCode).string(v.verificationUrl).string(v.deviceAuthId).u64(v.interval);
      });
      break;
    case "getThinkingLevel":
      w.enumIndex(enumIndex(THINKING_LEVEL, input.value as ThinkingLevel, "ThinkingLevel"));
      break;
    case "listWorkUnits":
      writeVec(w, (input.value ?? []) as WorkUnitInfo[], writeWorkUnitInfo);
      break;
    case "persistenceSearchHistory": {
      const result = input.value as Result<HistoryMatch[]>;
      if (result.ok) {
        w.enumIndex(RESULT_OK);
        writeVec(w, result.value, writeHistoryMatch);
      } else w.enumIndex(RESULT_ERR).string(result.error);
      break;
    }
    case "listSessions":
      writeVec(w, (input.value ?? []) as SessionInfo[], writeSessionInfo);
      break;
    case "listLiveSessions":
      // Vec<SessionId>: the daemon answers bare ids, not SessionInfo.
      writeVec(w, (input.value ?? []) as string[], (x, id) => x.string(id));
      break;
    case "listProviders":
      writeVec(w, (input.value ?? []) as ProviderInfo[], writeProviderInfo);
      break;
    case "getSubordinates":
    case "getSupervisors":
      writeVec(w, (input.value ?? []) as string[], (x, id) => x.string(id));
      break;
    case "getActiveSession":
    case "getPendingInput":
      w.option((input.value ?? null) as string | null, (x, id) => x.string(id));
      break;
    case "getSessionStatus":
      w.enumIndex(enumIndex(SESSION_STATUS, input.value as SessionStatus, "SessionStatus"));
      break;
    case "listCheckpoints":
      writeVec(w, (input.value ?? []) as CheckpointInfo[], (x, c) => {
        x.string(c.workUnitId).string(c.name).string(c.timestamp).bool(c.isAutomatic);
      });
      break;
    case "getContinueState": {
      const state = input.value as { enabled: boolean; budget: number };
      w.bool(state.enabled).u32(state.budget);
      break;
    }
    case "getGoalState":
      w.option((input.value ?? null) as GoalState | null, (x, goal) => {
        x.string(goal.text).option(goal.verify, (y, verify) => y.string(verify));
      });
      break;
    case "compactSession": {
      const result = input.value as Result<CompactionResult>;
      if (result.ok) {
        w.enumIndex(RESULT_OK);
        writeCompactionResult(w, result.value);
      } else w.enumIndex(RESULT_ERR).string(result.error);
      break;
    }
    case "setWorkUnitFocus":
    case "getWorkUnitFocus": {
      const result = input.value as Result<WorkUnitFocus>;
      if (result.ok) {
        w.enumIndex(RESULT_OK);
        writeWorkUnitFocus(w, result.value);
      } else w.enumIndex(RESULT_ERR).string(result.error);
      break;
    }
    case "getInteractionSnapshot":
    case "getWorkUnitDetails":
    case "createSessionChecked": {
      const result = input.value as Result<string>;
      if (result.ok) w.enumIndex(RESULT_OK).string(result.value);
      else w.enumIndex(RESULT_ERR).string(result.error);
      break;
    }
    case "getHitlRequest":
      w.option(input.value as HitlRequest | null, (x, request) => {
        writeVec(x, request.questions, (y, question) => {
          y.string(question.id).string(question.header).string(question.question);
          writeVec(y, question.options, (z, option) => z.string(option.label).string(option.description));
        });
      });
      break;
    case "getPauseState":
      w.option(input.value as PauseState | null, (x, pause) => {
        x.enumIndex(enumIndex(PAUSE_KIND, pause.kind, "PauseKind")).string(pause.prompt);
        x.option(pause.toolCallId, (y, id) => y.string(id));
      });
      break;
    case "getWorkspaceInfo": {
      const info = input.value as WorkspaceInfo;
      w.string(info.cwd).option(info.gitBranch, (x, v) => x.string(v));
      break;
    }
    case "getTranscriptPage":
      writeTranscriptResult(w, input.value as TranscriptResult);
      break;
    default:
      break; // unit-returning methods carry no payload
  }
  return w.finish();
}

export function decodeResponseFrame(bytes: Uint8Array): DecodedResponse {
  const r = new BincodeReader(bytes);
  const requestId = r.u64("Response.request_id");
  const at = r.offset;
  const tag = r.enumIndex("Result");
  if (tag === RESULT_ERR) {
    r.u32("ServerError.kind"); // io::ErrorKind discriminant
    const error = r.string("ServerError.detail");
    return { requestId, ok: false, error };
  }
  if (tag !== RESULT_OK) {
    throw new WireDecodeError(`invalid Result variant index ${tag} at offset ${at}`);
  }
  const methodAt = r.offset;
  const index = r.enumIndex("FspecServiceResponse");
  const method = INDEX_TO_METHOD.get(index);
  if (method === undefined) {
    throw new WireDecodeError(
      `unknown FspecServiceResponse variant index ${index} at offset ${methodAt}`,
    );
  }
  switch (method) {
    case "listWorkUnits":
      return { requestId, ok: true, method, workUnits: readVec(r, readWorkUnitInfo) };
    case "persistenceSearchHistory":
      return { requestId, ok: true, method, result: readResultWith(r, (x) => readVec(x, readHistoryMatch)) };
    case "listSessions":
      return { requestId, ok: true, method, sessions: readVec(r, readSessionInfo) };
    case "listLiveSessions":
      return { requestId, ok: true, method, sessionIds: readVec(r, (x) => x.string("SessionId")) };
    case "createSession":
      return { requestId, ok: true, method, sessionId: r.string("SessionId") };
    case "sendInput":
    case "interrupt":
    case "sendInputWithThinking":
      return { requestId, ok: true, method };
    case "getSessionStatus":
      return { requestId, ok: true, method, status: readEnumAt(r, SESSION_STATUS, "SessionStatus") };
    case "health":
    case "getModelInfo":
      return { requestId, ok: true, method, value: readOpaqueRemaining(r) };
    case "getThinkingLevel":
      return { requestId, ok: true, method, level: readEnumAt(r, THINKING_LEVEL, "ThinkingLevel") };
    case "listProviders":
      return { requestId, ok: true, method, providers: readVec(r, readProviderInfo) };
    case "getWorkspaceInfo":
      return {
        requestId,
        ok: true,
        method,
        workspace: {
          cwd: r.string("WorkspaceInfo.cwd"),
          gitBranch: r.skipOption((x) => x.string("WorkspaceInfo.git_branch")),
        },
      };
    case "setSessionModel":
    case "setThinkingLevel":
    case "moveWorkUnitUp":
    case "moveWorkUnitDown":
    case "destroySession":
    case "resumeSession":
    case "pauseConfirm":
    case "pauseTriple":
    case "sendHitlResponse":
    case "replyInteractionChecked":
    case "writeExecStdin":
    case "setContinueState":
    case "setGoalState":
    case "clearHistory":
    case "restoreCheckpointAll":
      return { requestId, ok: true, method, result: readResultVoid(r) };
    case "listCheckpoints":
      return {
        requestId,
        ok: true,
        method,
        checkpoints: readVec(r, (x) => ({
          workUnitId: x.string("CheckpointInfo.work_unit_id"),
          name: x.string("CheckpointInfo.name"),
          timestamp: x.string("CheckpointInfo.timestamp"),
          isAutomatic: x.bool("CheckpointInfo.is_automatic"),
        })),
      };
    case "getContinueState": {
      const enabled = r.bool("continue.enabled");
      return { requestId, ok: true, method, state: { enabled, budget: r.u32("continue.budget") } };
    }
    case "getGoalState":
      return {
        requestId,
        ok: true,
        method,
        goal: r.skipOption((x) => ({ text: x.string("goal"), verify: x.skipOption((y) => y.string("verify")) })),
      };
    case "compactSession":
      return { requestId, ok: true, method, result: readResultWith(r, readCompactionResult) };
    case "setWorkUnitFocus":
    case "getWorkUnitFocus":
      return { requestId, ok: true, method, result: readResultWith(r, readWorkUnitFocus) };
    case "getInteractionSnapshot":
    case "getWorkUnitDetails":
    case "createSessionChecked":
      return { requestId, ok: true, method, result: readResultString(r) };
    case "getSubordinates":
    case "getSupervisors":
      return { requestId, ok: true, method, sessions: readVec(r, (x) => x.string("SessionId")) };
    case "setActiveSession":
    case "clearActiveSession":
      return { requestId, ok: true, method };
    case "getActiveSession":
      return { requestId, ok: true, method, sessionId: r.skipOption((x) => x.string("SessionId")) };
    case "getPendingInput":
      return { requestId, ok: true, method, text: r.skipOption((x) => x.string("pending input")) };
    case "getHitlRequest":
      return {
        requestId,
        ok: true,
        method,
        request: r.skipOption((x) => ({
          questions: readVec(x, (y) => ({
            id: y.string("HitlQuestion.id"),
            header: y.string("HitlQuestion.header"),
            question: y.string("HitlQuestion.question"),
            options: readVec(y, (z) => ({
              label: z.string("HitlOption.label"),
              description: z.string("HitlOption.description"),
            })),
          })),
        })),
      };
    case "getPauseState":
      return {
        requestId,
        ok: true,
        method,
        pause: r.skipOption((x) => ({
          kind: readEnumAt(x, PAUSE_KIND, "PauseKind"),
          prompt: x.string("PauseState.prompt"),
          toolCallId: x.skipOption((y) => y.string("PauseState.tool_call_id")),
        })),
      };
    case "getTranscriptPage":
      return { requestId, ok: true, method, result: readTranscriptResult(r) };
    case "setDefaultModel":
    case "addCustomModel":
    case "updateCustomModel":
    case "deleteCustomModel":
    case "saveProviderSettings":
    case "saveProfile":
    case "deleteProfile":
    case "renameProfile":
    case "setProviderCredentials":
    case "deleteProviderCredentials":
    case "oauthClearTokens":
    case "oauthBrowserLogin":
    case "oauthHeadlessComplete":
    case "oauthDevicePoll":
      return { requestId, ok: true, method, result: readResultVoid(r) };
    case "listProviderSettings":
      return { requestId, ok: true, method, result: readResultWith(r, (x) => readVec(x, readProviderSettingsConfig)) };
    case "listProviderCredentials":
      return { requestId, ok: true, method, credentials: readVec(r, readProviderCredentialInfo) };
    case "getProviderCredential":
      return { requestId, ok: true, method, credential: r.skipOption(readProviderCredentialInfo) };
    case "testProviderConnection":
      return { requestId, ok: true, method, result: readResultWith(r, readTestConnectionResult) };
    case "refreshModelsCache":
      return { requestId, ok: true, method, result: readResultWith(r, (x) => readVec(x, readModelEntry)) };
    case "oauthGetTokens":
      return { requestId, ok: true, method, result: readResultWith(r, (x) => x.bool("oauth_get_tokens")) };
    case "oauthHeadlessStart":
      return { requestId, ok: true, method, result: readResultWith(r, readOAuthHeadlessStart) };
    case "oauthDeviceStart":
    case "oauthCopilotDeviceStart":
      return { requestId, ok: true, method, result: readResultWith(r, readOAuthDeviceStart) };
    default:
      throw new WireDecodeError(
        `FspecServiceResponse variant ${method} at index ${index} is not part of this codec's response surface`,
      );
  }
}

function writeTranscriptCursor(w: BincodeWriter, c: TranscriptCursor): void {
  w.string(c.generation).u64(c.sequence).u64(c.byteOffset);
}

function readTranscriptCursor(r: BincodeReader): TranscriptCursor {
  return {
    generation: r.string("TranscriptCursor.generation"),
    sequence: r.u64("TranscriptCursor.sequence"),
    byteOffset: r.u64("TranscriptCursor.byte_offset"),
  };
}

function writeTranscriptResult(w: BincodeWriter, result: TranscriptResult): void {
  if (!result.ok) {
    w.enumIndex(RESULT_ERR).enumIndex(enumIndex(TRANSCRIPT_ERROR, result.error.kind, "TranscriptError"));
    if (TRANSCRIPT_ERROR_WITH_DETAIL.has(result.error.kind)) w.string(result.error.detail ?? "");
    return;
  }
  const page = result.value;
  w.enumIndex(RESULT_OK).string(page.generation).u64(page.snapshotEnd);
  w.option(page.fragment, (x, f) => {
    x.u64(f.sequence).u64(f.byteOffset).u64(f.totalBytes).string(f.jsonFragment);
    x.option(f.original, (y, o) => {
      y.u64(o.turnIndex).string(o.messageId).string(o.timestamp).u64(o.chunkIndex);
    });
  });
  writeTranscriptCursor(w, page.nextCursor);
  w.bool(page.complete);
}

function readTranscriptResult(r: BincodeReader): TranscriptResult {
  const at = r.offset;
  const tag = r.enumIndex("Result");
  if (tag === RESULT_ERR) {
    const kind = readEnumAt(r, TRANSCRIPT_ERROR, "TranscriptError");
    return TRANSCRIPT_ERROR_WITH_DETAIL.has(kind)
      ? { ok: false, error: { kind, detail: r.string("TranscriptError detail") } }
      : { ok: false, error: { kind } };
  }
  if (tag !== RESULT_OK) {
    throw new WireDecodeError(`invalid Result variant index ${tag} at offset ${at}`);
  }
  const generation = r.string("TranscriptPage.generation");
  const snapshotEnd = r.u64("TranscriptPage.snapshot_end");
  const fragment = r.skipOption((x) => ({
    sequence: x.u64("TranscriptFragment.sequence"),
    byteOffset: x.u64("TranscriptFragment.byte_offset"),
    totalBytes: x.u64("TranscriptFragment.total_bytes"),
    jsonFragment: x.string("TranscriptFragment.json_fragment"),
    original: x.skipOption((y) => ({
      turnIndex: y.u64("TranscriptOriginal.turn_index"),
      messageId: y.string("TranscriptOriginal.message_id"),
      timestamp: y.string("TranscriptOriginal.timestamp"),
      chunkIndex: y.u64("TranscriptOriginal.chunk_index"),
    })),
  }));
  return {
    ok: true,
    value: {
      generation,
      snapshotEnd,
      fragment,
      nextCursor: readTranscriptCursor(r),
      complete: r.bool("TranscriptPage.complete"),
    },
  };
}

function readResultWith<T>(r: BincodeReader, read: (r: BincodeReader) => T): Result<T> {
  const at = r.offset;
  const tag = r.enumIndex("Result");
  if (tag === RESULT_OK) return { ok: true, value: read(r) };
  if (tag === RESULT_ERR) return { ok: false, error: r.string("Result error") };
  throw new WireDecodeError(`invalid Result variant index ${tag} at offset ${at}`);
}

function readResultString(r: BincodeReader): Result<string> {
  const at = r.offset;
  const tag = r.enumIndex("Result");
  if (tag === RESULT_OK) return { ok: true, value: r.string("Result value") };
  if (tag === RESULT_ERR) return { ok: false, error: r.string("Result error") };
  throw new WireDecodeError(`invalid Result variant index ${tag} at offset ${at}`);
}

function readResultVoid(r: BincodeReader): Result<void> {
  const at = r.offset;
  const tag = r.enumIndex("Result");
  if (tag === RESULT_OK) return { ok: true, value: undefined };
  if (tag === RESULT_ERR) return { ok: false, error: r.string("Result error") };
  throw new WireDecodeError(`invalid Result variant index ${tag} at offset ${at}`);
}

/**
 * Payloads the plugin does not consume (HealthInfo, ModelInfo) are validated
 * structurally by consuming nothing: they are only ever read through dedicated
 * accessors when a later story needs them.
 */
function readOpaqueRemaining(r: BincodeReader): unknown {
  return { remaining: r.remaining };
}

/** Convenience: wrap a tarpc request frame in the only client→server Envelope. */
export function encodeRpcEnvelope(frame: Uint8Array): Uint8Array {
  return encodeEnvelope({ kind: "rpc", frame });
}

export const ENVELOPE_VARIANTS = ENVELOPE_NAMES;
