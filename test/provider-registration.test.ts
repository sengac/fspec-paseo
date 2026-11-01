/**
 * Feature: spec/features/fspec-provider-registration.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios in this test map directly to scenarios in the Gherkin feature.
 *
 * The provider is driven as Paseo drives it (real ProviderInput in, events
 * validated with ProviderEventSchema out) against a fake daemon that speaks
 * real wire frames through the FSPEC-003 client.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderEventSchema,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import contribute from "../index.server.js";
import { createFspecProvider } from "../server/provider.js";
import type * as wire from "../server/wire.js";
import { FakeDaemon, daemonOptions, tempHome } from "./support/fake-daemon.js";

const homes: Array<ReturnType<typeof tempHome>> = [];
const connections: ProviderConnection[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  for (const home of homes.splice(0)) home.dispose();
});

function home(): ReturnType<typeof tempHome> {
  const created = tempHome();
  homes.push(created);
  return created;
}

const THINKING_OPTIONS = [
  { id: "off", label: "Off" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

function model(id: string, displayName: string, supportsReasoning: boolean): wire.ModelEntry {
  return {
    id,
    displayName,
    contextWindow: 200000,
    supportsReasoning,
    supportsVision: false,
    isCustom: false,
  };
}

const ANTHROPIC: wire.ProviderInfo = {
  key: "anthropic",
  displayName: "Anthropic",
  models: [
    model("claude-sonnet-4-5", "Claude Sonnet 4.5", true),
    model("claude-haiku-4-5", "Claude Haiku 4.5", false),
  ],
  profileName: null,
  isUnreachable: false,
};

const OPENAI_UNREACHABLE: wire.ProviderInfo = {
  key: "openai",
  displayName: "OpenAI",
  models: [model("gpt-5", "GPT-5", true)],
  profileName: null,
  isUnreachable: true,
};

async function connectTo(provider: ProviderRegistration): Promise<{
  connection: ProviderConnection;
  events: ProviderEvent[];
}> {
  const connection = await provider.connect({ versions: [1], capabilities: [] });
  connections.push(connection);
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(ProviderEventSchema.parse(event)));
  return { connection, events };
}

async function settled(events: ProviderEvent[], requestId: string): Promise<ProviderEvent> {
  await vi.waitFor(() => {
    expect(events.some((event) => "requestId" in event && event.requestId === requestId)).toBe(
      true,
    );
  });
  return events.find((event) => "requestId" in event && event.requestId === requestId)!;
}

describe("Feature: Register the fspec provider and build Paseo's model picker", () => {
  describe("Scenario: The fspec provider registers with status-based availability", () => {
    it("registers id/label fspec with no command and a status() probe", () => {
      // @step Given the fspec-paseo contribution function is loaded by Paseo
      let provider: ProviderRegistration | undefined;
      contribute({ registerProvider: (value: ProviderRegistration) => (provider = value), handle: () => {} });
      // @step When Paseo inspects the registered provider
      expect(provider).toBeDefined();
      // @step Then a provider with id `fspec` and label `fspec` is registered, declares no `command`, and its availability comes from `status()`
      expect(provider!.id).toBe("fspec");
      expect(provider!.label).toBe("fspec");
      expect(provider!.command).toBeUndefined();
      expect(typeof provider!.status).toBe("function");
    });
  });

  describe("Scenario: status() reports unavailable with a diagnostic when the daemon is down", () => {
    it("names the missing daemon.json and the fix", async () => {
      // @step Given no daemon.json exists at the resolved path (no fspec daemon running)
      const h = home();
      const provider = createFspecProvider({ env: {}, homeDir: h.homeDir });
      // @step When Paseo calls the provider's `status()`
      const status = await provider.status!({});
      // @step Then it reports `{ available: false, diagnostic: 'no daemon.json found at /Users/me/.fspec/daemon.json — start fspec daemon first' }` naming the missing file and the fix
      expect(status).toEqual({
        available: false,
        diagnostic: `no daemon.json found at ${h.daemonJsonPath} — start fspec daemon first`,
      });
    });
  });

  describe("Scenario: status() reports available when the daemon is reachable", () => {
    it("reports available for a live daemon.json", async () => {
      // @step Given a live fspec daemon has written a valid daemon.json (port and pid) whose pid is alive
      const h = home();
      h.writeDaemonJson();
      const provider = createFspecProvider(daemonOptions(h, new FakeDaemon()));
      // @step When Paseo calls the provider's `status()`
      const status = await provider.status!({});
      // @step Then it reports `{ available: true }` so Paseo offers fspec sessions
      expect(status).toEqual({ available: true });
    });
  });

  describe("Scenario: The model picker catalog maps the daemon's provider catalog", () => {
    it("maps list_providers into one catalog event", async () => {
      // @step Given the daemon's `list_providers` returns a reachable `anthropic` provider with models `claude-sonnet-4-5` (display_name 'Claude Sonnet 4.5', context_window 200000, supports_reasoning true) and `claude-haiku-4-5` (display_name 'Claude Haiku 4.5', context_window 200000) plus an `openai` provider flagged `is_unreachable`
      const h = home();
      h.writeDaemonJson();
      const daemon = new FakeDaemon();
      daemon.handlers.listProviders = () => [ANTHROPIC, OPENAI_UNREACHABLE];
      const { connection, events } = await connectTo(createFspecProvider(daemonOptions(h, daemon)));
      // @step When Paseo requests the model catalog with a requestId
      await connection.send({ type: "catalog", requestId: "catalog-1" });
      const reply = await settled(events, "catalog-1");
      // @step Then it replies with exactly one catalog event carrying the requested requestId and models `{id:'anthropic/claude-sonnet-4-5', label:'Claude Sonnet 4.5', contextWindowMaxTokens:200000, isDefault:true}` and `{id:'anthropic/claude-haiku-4-5', label:'Claude Haiku 4.5', contextWindowMaxTokens:200000}`
      expect(events.filter((event) => event.type === "catalog")).toHaveLength(1);
      expect(daemon.sent("listProviders")).toHaveLength(1);
      expect(reply.type).toBe("catalog");
      const catalog = (reply as Extract<ProviderEvent, { type: "catalog" }>).catalog;
      expect(catalog.models).toEqual([
        {
          id: "anthropic/claude-sonnet-4-5",
          label: "Claude Sonnet 4.5",
          contextWindowMaxTokens: 200000,
          isDefault: true,
        },
        {
          id: "anthropic/claude-haiku-4-5",
          label: "Claude Haiku 4.5",
          contextWindowMaxTokens: 200000,
        },
      ]);
      // @step And no openai models appear in the catalog because the provider is `is_unreachable`
      expect(catalog.models.some((entry) => entry.id.startsWith("openai/"))).toBe(false);
      // @step And the catalog lists the agent and bot `modes`, `thinkingOptions` = off/low/medium/high, `defaultModel` = 'anthropic/claude-sonnet-4-5', and `defaultThinkingOption` = 'off'
      expect(catalog.modes.map((mode) => mode.id)).toEqual(["agent", "bot"]);
      expect(catalog.thinkingOptions).toEqual(THINKING_OPTIONS);
      expect(catalog.defaultModel).toBe("anthropic/claude-sonnet-4-5");
      expect(catalog.defaultThinkingOption).toBe("off");
    });
  });

  describe("Scenario: A catalog request fails with a diagnostic when no daemon is reachable", () => {
    it("answers request.failed with the daemon.json diagnostic", async () => {
      // @step Given no daemon.json exists at the resolved path (no fspec daemon running)
      const h = home();
      const { connection, events } = await connectTo(
        createFspecProvider({ env: {}, homeDir: h.homeDir }),
      );
      // @step When Paseo requests the model catalog with a requestId
      await connection.send({ type: "catalog", requestId: "catalog-down" });
      const reply = await settled(events, "catalog-down");
      // @step Then the catalog input rejects with `request.failed` for that requestId and an error diagnostic naming the missing piece, e.g. 'no daemon.json found at /Users/me/.fspec/daemon.json — start fspec daemon first'
      const diagnostic = `no daemon.json found at ${h.daemonJsonPath} — start fspec daemon first`;
      expect(reply).toEqual({
        type: "request.failed",
        requestId: "catalog-down",
        error: { message: diagnostic, diagnostic },
      });
      // @step And no catalog event is emitted and no model is invented
      expect(events.filter((event) => event.type === "catalog")).toEqual([]);
    });
  });

  describe("Scenario: An unreachable daemon yields no default model", () => {
    it("emits an empty catalog with no defaultModel", async () => {
      // @step Given a live fspec daemon whose `list_providers` returns only providers flagged `is_unreachable`
      const h = home();
      h.writeDaemonJson();
      const daemon = new FakeDaemon();
      daemon.handlers.listProviders = () => [OPENAI_UNREACHABLE];
      const { connection, events } = await connectTo(createFspecProvider(daemonOptions(h, daemon)));
      // @step When Paseo requests the model catalog with a requestId
      await connection.send({ type: "catalog", requestId: "catalog-2" });
      const reply = (await settled(events, "catalog-2")) as Extract<ProviderEvent, { type: "catalog" }>;
      // @step Then it replies with exactly one catalog event whose `models` list is empty and which carries no `defaultModel`
      expect(events.filter((event) => event.type === "catalog")).toHaveLength(1);
      expect(reply.catalog.models).toEqual([]);
      expect(reply.catalog).not.toHaveProperty("defaultModel");
      // @step And the catalog still lists the agent and bot `modes`, the off/low/medium/high `thinkingOptions`, and `defaultThinkingOption` = 'off'
      expect(reply.catalog.modes.map((mode) => mode.id)).toEqual(["agent", "bot"]);
      expect(reply.catalog.thinkingOptions).toEqual(THINKING_OPTIONS);
      expect(reply.catalog.defaultThinkingOption).toBe("off");
    });
  });

  describe("Scenario: Availability is probe-driven, not polled", () => {
    it("reflects each probe and schedules no timers", async () => {
      // @step Given a live fspec daemon is reachable and a second status() probe later finds no daemon.json (the daemon stopped)
      const h = home();
      h.writeDaemonJson();
      vi.useFakeTimers();
      const provider = createFspecProvider(daemonOptions(h, new FakeDaemon()));
      // @step When Paseo calls the provider's `status()` at each point in time
      const first = await provider.status!({});
      h.dispose();
      const second = await provider.status!({});
      // @step Then each call reflects only the daemon state observed during that probe, reporting `{ available: true }` while reachable and `{ available: false }` with a diagnostic once it is not
      expect(first).toEqual({ available: true });
      expect(second.available).toBe(false);
      expect((second as { diagnostic: string }).diagnostic).toMatch(/no daemon\.json found/);
      // @step And the provider runs no background timer or polling loop between calls
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("Scenario: The catalog is empty but not an error when no provider is reachable", () => {
    it("replies with a valid empty catalog, not request.failed", async () => {
      // @step Given the daemon is reachable but its `list_providers` returns only providers flagged `is_unreachable`
      const h = home();
      h.writeDaemonJson();
      const daemon = new FakeDaemon();
      daemon.handlers.listProviders = () => [OPENAI_UNREACHABLE];
      const { connection, events } = await connectTo(createFspecProvider(daemonOptions(h, daemon)));
      // @step When Paseo requests the model catalog with a requestId
      await connection.send({ type: "catalog", requestId: "catalog-3" });
      const reply = await settled(events, "catalog-3");
      // @step Then it replies with a valid catalog event whose `models` is `[]` and no `defaultModel` — Paseo shows an empty picker, not an error
      expect(reply.type).toBe("catalog");
      expect(events.some((event) => event.type === "request.failed")).toBe(false);
      const catalog = (reply as Extract<ProviderEvent, { type: "catalog" }>).catalog;
      expect(catalog.models).toEqual([]);
      expect(catalog.defaultModel).toBeUndefined();
    });
  });
});
