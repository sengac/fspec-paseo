/**
 * The Paseo-side test seam for session tests: connects the real provider to a
 * FakeDaemon with every capability offered, validates every event with
 * ProviderEventSchema, and offers open/prompt/send/wait helpers.
 */
import { expect, vi } from "vitest";
import {
  PROVIDER_CAPABILITIES,
  ProviderEventSchema,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderPersistence,
  type ProviderSessionConfig,
  type ProviderTimelineItem,
} from "@getpaseo/plugin/server/provider";
import { createFspecProvider } from "../../server/provider.js";
import type * as wire from "../../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./fake-daemon.js";

export type Event<T extends ProviderEvent["type"]> = Extract<ProviderEvent, { type: T }>;
export type Item<T extends ProviderTimelineItem["type"]> = Extract<ProviderTimelineItem, { type: T }>;

const cleanups: Array<() => Promise<void> | void> = [];

/** Closes every harness connection and removes its temp home (call in afterEach). */
export async function disposeHarnesses(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
}

export const CATALOG: wire.ProviderInfo[] = [
  {
    key: "anthropic",
    displayName: "Anthropic",
    models: [
      {
        id: "claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        contextWindow: 200000,
        supportsReasoning: true,
        supportsVision: false,
        isCustom: false,
      },
    ],
    profileName: null,
    isUnreachable: false,
    providerId: "anthropic",
  },
  {
    key: "openai",
    displayName: "OpenAI",
    models: [
      {
        id: "gpt-5",
        displayName: "GPT-5",
        contextWindow: 400000,
        supportsReasoning: true,
        supportsVision: false,
        isCustom: false,
      },
    ],
    profileName: null,
    isUnreachable: false,
    providerId: "openai",
  },
];

export async function harness() {
  const home = tempHome();
  home.writeDaemonEntry();
  const daemon = new FakeDaemon();
  daemon.handlers.listProviders = () => CATALOG;
  // fspec's default model: the catalog's first model, like a configured fspec.
  daemon.handlers.getDefaultModel = () => "anthropic/claude-sonnet-4";
  const provider = createFspecProvider(daemonOptions(home, daemon));
  const connection: ProviderConnection = await provider.connect({
    versions: [1],
    capabilities: PROVIDER_CAPABILITIES,
  });
  cleanups.push(async () => {
    await connection.close();
    home.dispose();
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(ProviderEventSchema.parse(event)));
  let request = 0;

  function config(overrides: Partial<ProviderSessionConfig> = {}): ProviderSessionConfig {
    return { cwd: "/work", env: {}, mcpServers: {}, settings: {}, persist: true, ...overrides };
  }

  function settlement(requestId: string): ProviderEvent | undefined {
    return events.find(
      (event) =>
        "requestId" in event && event.requestId === requestId && event.type !== "session.opened",
    );
  }

  async function settle(requestId: string): Promise<ProviderEvent> {
    await vi.waitFor(() => expect(settlement(requestId)).toBeDefined());
    return settlement(requestId)!;
  }

  async function open(
    sessionId: string,
    overrides: Partial<ProviderSessionConfig> = {},
    persistence?: ProviderPersistence,
    history: "replay" | "skip" = "skip",
  ): Promise<ProviderEvent[]> {
    const requestId = `open-${++request}`;
    const from = events.length;
    await connection.send({
      type: "session.open",
      requestId,
      sessionId,
      config: config(overrides),
      history,
      ...(persistence ? { persistence } : {}),
    });
    const settled = await settle(requestId);
    expect(settled.type).toBe("session.ready");
    return events.slice(from);
  }

  function prompt(
    sessionId: string,
    text: string,
    clientMessageId = `client-${++request}`,
  ): ProviderInput {
    return {
      type: "session.prompt",
      sessionId,
      prompt: {
        clientMessageId,
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text }] },
      },
    };
  }

  async function send(input: ProviderInput): Promise<ProviderEvent | undefined> {
    await connection.send(input);
    if ("requestId" in input) return settle(input.requestId);
    return undefined;
  }

  function ofType<T extends ProviderEvent["type"]>(type: T, list = events): Event<T>[] {
    return list.filter((event): event is Event<T> => event.type === type);
  }

  /** Timeline item snapshots of one item type, in publish order. */
  function items<T extends ProviderTimelineItem["type"]>(type: T, list = events): Item<T>[] {
    return ofType("timeline.item", list)
      .map((event) => event.item)
      .filter((item): item is Item<T> => item.type === type);
  }

  async function waitFor<T extends ProviderEvent["type"]>(
    type: T,
    predicate: (event: Event<T>) => boolean = () => true,
  ): Promise<Event<T>> {
    await vi.waitFor(() => expect(ofType(type).some(predicate)).toBe(true));
    return ofType(type).find(predicate)!;
  }

  /** Pushes chunks for a daemon session and waits until the provider consumed them. */
  async function stream(daemonSessionId: string, ...chunks: wire.StreamChunk[]): Promise<void> {
    for (const chunk of chunks) daemon.push(daemonSessionId, chunk);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    daemon,
    connection,
    events,
    open,
    prompt,
    send,
    ofType,
    items,
    waitFor,
    stream,
    next: () => `req-${++request}`,
  };
}

export const text = (value: string): wire.StreamChunk => ({
  type: "text",
  text: value,
  correlationId: null,
  observedCorrelationIds: null,
});

export const thinking = (value: string): wire.StreamChunk => ({
  type: "thinking",
  thinking: value,
  correlationId: null,
  observedCorrelationIds: null,
});

export const toolCall = (id: string, name: string, input: unknown): wire.StreamChunk => ({
  type: "toolCall",
  toolCall: { id, name, input: typeof input === "string" ? input : JSON.stringify(input) },
  correlationId: null,
  observedCorrelationIds: null,
});

export const toolProgress = (toolCallId: string, outputChunk: string): wire.StreamChunk => ({
  type: "toolProgress",
  toolProgress: { toolCallId, toolName: "Bash", outputChunk, isStderr: false },
  correlationId: null,
  observedCorrelationIds: null,
});

export const toolResult = (toolCallId: string, content: string, isError = false): wire.StreamChunk => ({
  type: "toolResult",
  toolResult: { toolCallId, content, isError },
  correlationId: null,
  observedCorrelationIds: null,
});
