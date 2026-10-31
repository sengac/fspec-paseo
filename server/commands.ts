/**
 * Feature: spec/features/fspec-session-commands.feature
 *
 * fspec's session commands as Paseo composer commands. Argument handling
 * mirrors the fspec TUI (rust/fspec-tui/src/app/continue_parser.rs and
 * goal_parser.rs) so a command means the same thing in both clients. Pure.
 */
import type { ProviderCommand } from "@getpaseo/plugin/server/provider";

export const FSPEC_COMMANDS: ProviderCommand[] = [
  { name: "compact", description: "Compact the conversation history to free context" },
  { name: "clear", description: "Clear the conversation history" },
  { name: "continue", description: "Auto-continue: toggle, turn on or off, or set a turn budget", argumentHint: "[on|off|N]" },
  { name: "goal", description: "Show, set, verify or clear the session goal", argumentHint: "[text|clear|verify <cmd>]" },
  { name: "focus", description: "Set the work unit the agent is working on", argumentHint: "<work-unit-id|none>" },
];

/** fspec's DEFAULT_CONTINUE_BUDGET. */
export const DEFAULT_CONTINUE_BUDGET = 10;

export type ContinueCommand =
  | { kind: "toggle" }
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "budget"; budget: number }
  | { kind: "invalid"; message: string };

export type GoalCommand =
  | { kind: "show" }
  | { kind: "clear" }
  | { kind: "verify"; command: string }
  | { kind: "set"; text: string };

export function parseContinue(args: string): ContinueCommand {
  const body = args.trim();
  if (body === "") return { kind: "toggle" };
  if (body.toLowerCase() === "on") return { kind: "on" };
  if (body.toLowerCase() === "off") return { kind: "off" };
  if (/^\d+$/.test(body)) {
    const budget = Number(body);
    return budget === 0
      ? { kind: "invalid", message: "auto-continue: budget must be at least 1" }
      : { kind: "budget", budget };
  }
  return { kind: "invalid", message: `auto-continue: expected on, off or a turn budget, not "${body}"` };
}

/** The new continue state, or the reason the command is refused. */
export function applyContinue(
  current: { enabled: boolean; budget: number },
  goalActive: boolean,
  command: ContinueCommand,
): { enabled: boolean; budget: number; message: string } | { error: string } {
  if (command.kind === "invalid") return { error: command.message };
  if (goalActive && command.kind === "off") {
    return { error: "auto-continue: a goal is active — clear the goal first (/goal clear)" };
  }
  const on = (budget: number) => ({ enabled: true, budget, message: `auto-continue: on (budget ${budget})` });
  const off = { enabled: false, budget: current.budget, message: "auto-continue: off" };
  switch (command.kind) {
    case "toggle":
      return current.enabled ? off : on(DEFAULT_CONTINUE_BUDGET);
    case "on":
      return on(DEFAULT_CONTINUE_BUDGET);
    case "off":
      return off;
    case "budget":
      return on(command.budget);
  }
}

export function parseGoal(args: string): GoalCommand {
  const body = args.trim();
  if (body === "") return { kind: "show" };
  if (body.toLowerCase() === "clear") return { kind: "clear" };
  const verify = /^verify\s+(.+)$/s.exec(body);
  if (verify) return { kind: "verify", command: verify[1]!.trim() };
  return { kind: "set", text: body };
}

/** A focus target: a work-unit id, null to clear, or undefined when missing. */
export function parseFocus(args: string): string | null | undefined {
  const body = args.trim();
  if (body === "") return undefined;
  return body.toLowerCase() === "none" ? null : body;
}
