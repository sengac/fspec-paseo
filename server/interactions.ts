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
import { asObject, type Json, list, nullableList, nullableObject, nullableString, object, string } from "./json-fields.js";
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

/** fspec PauseKind as the snapshot writes it (format!("{:?}")). */
const PAUSE_KINDS = ["Continue", "Confirm", "Triple"] as const;
const SNAPSHOT = "interaction snapshot";

/**
 * Parses the snapshot JSON { pause: { request_id, state }, hitl: { request_id, state } }
 * exactly as fspec writes it (rust/sessions/src/background_session/interactions.rs,
 * FSPEC-068): any other shape is an error naming the field. A pause wins over
 * a HITL question; null when nothing is pending.
 */
export function parseInteractionSnapshot(json: string): Interaction | null {
  const snapshot = asObject(JSON.parse(json), SNAPSHOT);
  const pause = object(snapshot, "pause", SNAPSHOT);
  const pauseRequestId = string(pause, "request_id", `${SNAPSHOT} pause`);
  const pauseState = nullableObject(pause, "state", `${SNAPSHOT} pause`);
  const hitl = object(snapshot, "hitl", SNAPSHOT);
  const hitlRequestId = string(hitl, "request_id", `${SNAPSHOT} hitl`);
  const hitlState = nullableObject(hitl, "state", `${SNAPSHOT} hitl`);
  const questions = hitlState === null ? null : hitlQuestions(hitlState);
  if (pauseState !== null) {
    const at = `${SNAPSHOT} pause.state`;
    const kind = string(pauseState, "kind", at);
    if (!(PAUSE_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown fspec pause kind ${kind}`);
    return {
      kind: "pause",
      requestId: pauseRequestId,
      pauseKind: kind.toLowerCase() as PauseKind,
      toolName: string(pauseState, "tool_name", at),
      message: string(pauseState, "message", at),
      details: nullableString(pauseState, "details", at),
    };
  }
  return questions === null ? null : { kind: "hitl", requestId: hitlRequestId, questions };
}

/** fspec's HitlRequest { questions: [{ id, header, question, options: [{ label, description }] | null }] }. */
function hitlQuestions(state: Json): HitlQuestion[] {
  const at = `${SNAPSHOT} hitl.state`;
  const raw = list(state, "questions", at);
  if (raw.length === 0) throw new Error(`${at}.questions is empty`);
  return raw.map((entry, index) => {
    const where = `${at}.questions[${index}]`;
    const question = asObject(entry, where);
    const options = nullableList(question, "options", where) ?? [];
    return {
      id: string(question, "id", where),
      header: string(question, "header", where),
      question: string(question, "question", where),
      options: options.map((option, n) => {
        const optionAt = `${where}.options[${n}]`;
        const fields = asObject(option, optionAt);
        return { label: string(fields, "label", optionAt), description: string(fields, "description", optionAt) };
      }),
    };
  });
}

export function questionHeader(question: HitlQuestion): string {
  return question.header.trim() !== "" ? question.header : question.id;
}

/**
 * The Paseo permission request for an interaction. `gatedTool` is the tool
 * call get_pause_state's tool_call_id names (carried as metadata.toolCallId);
 * undefined when it names none the transcript knows, and the request then
 * carries no detail (FSPEC-059).
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
  // FSPEC-068: an allowed answer without answers is not "no answer".
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("the answer to the fspec question carries no answers");
  }
  const answers = raw as Record<string, unknown>;
  return questions.map((question) => {
    const value = answers[questionHeader(question)];
    if (typeof value !== "string") throw new Error(`the answer to the fspec question carries no answer for ${questionHeader(question)}`);
    const answer = value.trim();
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
    // An action id is one of the request's actions (FSPEC-068); without one the behavior answers.
    const choice = selectedActionId === undefined ? (behavior === "allow" ? "Approve" : "Deny") : TRIPLE_CHOICES[selectedActionId];
    if (choice === undefined) throw new Error(`unknown fspec approval action ${selectedActionId}`);
    return { method: "pause_triple", arguments: JSON.stringify({ choice }) };
  }
  if (selectedActionId !== undefined && selectedActionId !== "accept" && selectedActionId !== "deny") {
    throw new Error(`unknown fspec approval action ${selectedActionId}`);
  }
  const accept = selectedActionId !== undefined ? selectedActionId === "accept" : behavior === "allow";
  return { method: "pause_confirm", arguments: JSON.stringify({ accept }) };
}
