/**
 * Feature: spec/features/fspec-interaction-api.feature
 *
 * fspec's pending interactions (approval pauses and HITL questions) as read
 * from get_interaction_snapshot, mapped to Paseo permission requests, and
 * Paseo answers mapped back to reply_interaction_checked arguments. Pure.
 */
import type {
  ProviderPermissionAction,
  ProviderPermissionRequest,
  ProviderPermissionResponse,
  ProviderToolCallDetail,
} from "@getpaseo/plugin/server/provider";
import type { HitlAnswer, HitlQuestion } from "./wire.js";

export type PauseKind = "triple" | "confirm" | "continue";

export type Interaction =
  | {
      kind: "pause";
      requestId: string;
      pauseKind: PauseKind;
      toolName: string;
      message: string;
      details: string | null;
    }
  | { kind: "hitl"; requestId: string; questions: HitlQuestion[] };

/** A reply_interaction_checked call: the legacy method name and its JSON arguments. */
export interface InteractionReply {
  method: string;
  arguments: string;
}

const TRIPLE_ACTIONS: ProviderPermissionAction[] = [
  { id: "approve", label: "Approve", behavior: "allow", variant: "primary" },
  { id: "approve_session", label: "Approve for session", behavior: "allow", variant: "secondary" },
  { id: "deny", label: "Deny", behavior: "deny", variant: "danger" },
];
const CONFIRM_ACTIONS: ProviderPermissionAction[] = [
  { id: "accept", label: "Accept", behavior: "allow", variant: "primary" },
  { id: "deny", label: "Deny", behavior: "deny", variant: "danger" },
];
const CONTINUE_ACTIONS: ProviderPermissionAction[] = [
  { id: "continue", label: "Continue", behavior: "allow", variant: "primary" },
];
/** serde names of fspec's ApprovalChoice. */
const TRIPLE_CHOICES: Record<string, string> = {
  approve: "Approve",
  approve_session: "ApproveSession",
  deny: "Deny",
};

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Parses the snapshot JSON { pause: { request_id, state }, hitl: { request_id, state } }.
 * A pause wins over a HITL question; null when nothing is pending.
 */
export function parseInteractionSnapshot(json: string): Interaction | null {
  const snapshot = record(JSON.parse(json)) ?? {};
  const pause = record(snapshot["pause"]);
  const pauseState = record(pause?.["state"]);
  if (pause && pauseState) {
    const kind = text(pauseState["kind"]).toLowerCase();
    return {
      kind: "pause",
      requestId: text(pause["request_id"]),
      pauseKind: kind === "triple" ? "triple" : kind === "continue" ? "continue" : "confirm",
      toolName: text(pauseState["tool_name"]),
      message: text(pauseState["message"]),
      details: typeof pauseState["details"] === "string" ? pauseState["details"] : null,
    };
  }
  const hitl = record(snapshot["hitl"]);
  const hitlState = record(hitl?.["state"]);
  const questions = Array.isArray(hitlState?.["questions"]) ? (hitlState["questions"] as unknown[]) : [];
  if (hitl && questions.length > 0) {
    return {
      kind: "hitl",
      requestId: text(hitl["request_id"]),
      questions: questions.map((raw) => {
        const question = record(raw) ?? {};
        const options = Array.isArray(question["options"]) ? (question["options"] as unknown[]) : [];
        return {
          id: text(question["id"]),
          header: text(question["header"]),
          question: text(question["question"]),
          options: options.map((option) => ({
            label: text(record(option)?.["label"]),
            description: text(record(option)?.["description"]),
          })),
        };
      }),
    };
  }
  return null;
}

export function questionHeader(question: HitlQuestion): string {
  return question.header.trim() !== "" ? question.header : question.id;
}

/**
 * The Paseo permission request for an interaction. `gatedTool` is the tool
 * call the pause holds: named by get_pause_state's tool_call_id when known
 * (then carried as metadata.toolCallId), else the running tool call.
 */
export function permissionRequest(
  interaction: Interaction,
  id: string,
  gatedTool: { name: string; detail: ProviderToolCallDetail; toolCallId?: string } | undefined,
): ProviderPermissionRequest {
  if (interaction.kind === "hitl") {
    return {
      id,
      name: "question",
      kind: "question",
      title: questionHeader(interaction.questions[0]!),
      // fspec accepts free text on every question ("Other..."), single choice.
      input: {
        questions: interaction.questions.map((question) => ({
          header: questionHeader(question),
          question: question.question,
          options: question.options.map((option) => ({ label: option.label, description: option.description })),
          multiSelect: false,
          allowOther: true,
          allowEmpty: false,
        })),
      },
    };
  }
  const name = interaction.toolName || gatedTool?.name || "fspec";
  return {
    id,
    name,
    kind: "tool",
    title: interaction.pauseKind === "continue" ? "fspec paused" : `Allow ${name}?`,
    description: interaction.details ? `${interaction.message}\n\n${interaction.details}` : interaction.message,
    ...(gatedTool ? { detail: gatedTool.detail } : {}),
    ...(gatedTool?.toolCallId !== undefined ? { metadata: { toolCallId: gatedTool.toolCallId } } : {}),
    actions:
      interaction.pauseKind === "triple"
        ? TRIPLE_ACTIONS
        : interaction.pauseKind === "continue"
          ? CONTINUE_ACTIONS
          : CONFIRM_ACTIONS,
  };
}

/**
 * Paseo returns answers keyed by header: option labels joined with ", " or the
 * user's own text. fspec wants selected labels or free text per question.
 */
function hitlAnswers(questions: HitlQuestion[], raw: unknown): HitlAnswer[] {
  const answers = record(raw) ?? {};
  return questions.map((question) => {
    const value = answers[questionHeader(question)];
    const answer = typeof value === "string" ? value.trim() : "";
    if (answer === "") return { id: question.id, selected: [], other: null };
    const labels = new Set(question.options.map((option) => option.label));
    const parts = answer.split(", ");
    return parts.every((part) => labels.has(part))
      ? { id: question.id, selected: parts, other: null }
      : { id: question.id, selected: [], other: answer };
  });
}

/** Maps a Paseo answer to the reply_interaction_checked method and arguments. */
export function interactionReply(interaction: Interaction, response: ProviderPermissionResponse): InteractionReply {
  if (interaction.kind === "hitl") {
    const reply =
      response.behavior === "allow"
        ? { cancelled: false, answers: hitlAnswers(interaction.questions, response.updatedInput?.["answers"]) }
        : { cancelled: true, answers: [] };
    return { method: "send_hitl_response", arguments: JSON.stringify({ response: reply }) };
  }
  if (interaction.pauseKind === "continue") return { method: "pause_resume", arguments: "{}" };
  const { behavior, selectedActionId } = response;
  if (interaction.pauseKind === "triple") {
    const choice =
      (selectedActionId !== undefined ? TRIPLE_CHOICES[selectedActionId] : undefined) ??
      (behavior === "allow" ? "Approve" : "Deny");
    return { method: "pause_triple", arguments: JSON.stringify({ choice }) };
  }
  const accept = selectedActionId !== undefined ? selectedActionId === "accept" : behavior === "allow";
  return { method: "pause_confirm", arguments: JSON.stringify({ accept }) };
}
