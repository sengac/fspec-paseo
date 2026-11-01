/**
 * Feature: spec/features/fspec-bot-mode.feature
 *
 * fspec's orchestrator "bot" (TUI-114): a session whose role overlay makes it
 * delegate work to sub-agents through the AgentManager tool and report their
 * results instead of doing the work itself. The role text is copied verbatim
 * from fspec's rust/sessions/src/bot.rs ORCHESTRATOR_ROLE; a session is a bot
 * iff its role starts with the marker line, so bots stay recognisable from
 * SessionInfo.role and get_session_role.
 */
import type { ProviderMode } from "@getpaseo/plugin/server/provider";

/** First line of every bot role (fspec BOT_ROLE_MARKER). */
export const BOT_ROLE_MARKER = "# fspec bot: orchestrator";

/** The role overlay fspec's New Bot creates sessions with. */
export const ORCHESTRATOR_ROLE = `# fspec bot: orchestrator

You are an orchestrator bot. Do not do the work yourself: break the user's
request into focused tasks and delegate each one to a sub-agent.

- Use the AgentManager tool to spawn one sub-agent per task (for example one
  per work unit), giving each a clear, self-contained instruction.
- Use AgentManager message to steer or answer a sub-agent, get_status to check
  on one, and await_idle to wait until they finish.
- Check each sub-agent's result against the request before relying on it, and
  send follow-up messages when something is missing or wrong.
- Close sub-agents you no longer need.
- Report back to the user: what each sub-agent did, what is finished, and what
  still needs attention.`;

/** True when `role` is a bot role (fspec is_bot_role). */
export function isBotRole(role: string | null | undefined): boolean {
  return typeof role === "string" && role.startsWith(BOT_ROLE_MARKER);
}

export type FspecMode = "agent" | "bot";

export const DEFAULT_MODE: FspecMode = "agent";

/** Paseo's mode picker for fspec sessions. */
export const FSPEC_MODES: readonly ProviderMode[] = [
  { id: "agent", label: "Agent", description: "An fspec agent that does the work itself" },
  { id: "bot", label: "Bot", description: "An fspec orchestrator that delegates the work to sub-agents and reports back" },
];

export function fspecMode(mode: string): FspecMode {
  if (mode !== "agent" && mode !== "bot") {
    throw new Error(`invalid fspec mode "${mode}" — expected agent or bot`);
  }
  return mode;
}
