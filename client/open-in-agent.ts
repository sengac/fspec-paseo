import type { BoardUnit } from "../shared/board.js";

/** The parts of a Paseo agent-list entry that identify an fspec session. */
export interface AgentEntry {
  agent: {
    id: string;
    provider: string;
    status: string;
    persistence: { metadata?: Record<string, unknown> | null } | null;
  };
}

export interface OpenInAgentDeps {
  listAgents(): Promise<readonly AgentEntry[]>;
  listModels(): Promise<ReadonlyArray<{ id: string; isDefault?: boolean }>>;
  createAgent(options: { provider: string; title: string; prompt: string }): Promise<{ id: string }>;
  openAgent(agentId: string): void;
}

/**
 * The fspec daemon session behind a Paseo agent: Paseo keeps plugin provider
 * persistence at metadata.pluginProviderPersistence, ours is { version: 1, data: { sessionId } }.
 */
function daemonSessionId(entry: AgentEntry): string | null {
  const stored = entry.agent.persistence?.metadata?.pluginProviderPersistence as
    | { data?: { sessionId?: unknown } }
    | undefined;
  const sessionId = stored?.data?.sessionId;
  return typeof sessionId === "string" ? sessionId : null;
}

/**
 * The models of Paseo's fspec model listing (FSPEC-066): its error, or a
 * listing without models, is an error rather than "no models".
 */
export function fspecModels<M>(result: { models?: M[]; error?: string | null }): M[] {
  if (typeof result.error === "string") throw new Error(result.error);
  if (result.models === undefined) throw new Error("Paseo listed no fspec models");
  return result.models;
}

/** The open Paseo agent whose fspec session is focused on the card, if any. */
export function focusedAgent(entries: readonly AgentEntry[], sessionIds: readonly string[]): string | null {
  const match = entries.find((entry) => {
    if (entry.agent.provider !== "fspec" || entry.agent.status === "closed") return false;
    const sessionId = daemonSessionId(entry);
    return sessionId !== null && sessionIds.includes(sessionId);
  });
  return match?.agent.id ?? null;
}

/**
 * The TUI's "Open in agent" (FSPEC-037): switch to the agent already focused on
 * the card, else create an fspec agent with the default model that focuses
 * the card through the provider's /focus command, and open it.
 */
export async function openInAgent(
  deps: OpenInAgentDeps,
  unit: BoardUnit,
  focus: Readonly<Record<string, readonly string[]>>,
): Promise<{ agentId: string; created: boolean }> {
  const sessionIds = focus[unit.id] ?? [];
  if (sessionIds.length > 0) {
    const existing = focusedAgent(await deps.listAgents(), sessionIds);
    if (existing !== null) {
      deps.openAgent(existing);
      return { agentId: existing, created: false };
    }
  }
  // FSPEC-066: only fspec's default model, which Paseo's catalog marks; never a guess.
  const model = (await deps.listModels()).find((entry) => entry.isDefault);
  if (model === undefined) throw new Error("fspec has no default model — set one under fspec providers");
  const agent = await deps.createAgent({
    provider: `fspec/${model.id}`,
    title: `${unit.id} — ${unit.title}`,
    prompt: `/focus ${unit.id}`,
  });
  deps.openAgent(agent.id);
  return { agentId: agent.id, created: true };
}
