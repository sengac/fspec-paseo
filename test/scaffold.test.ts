/**
 * Feature: spec/features/scaffold-the-fspec-paseo-provider-plugin-project.feature
 *
 * This test file validates the acceptance criteria defined in the feature file.
 * Scenarios map directly to Gherkin scenarios.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ProviderEventSchema,
  type ProviderConnection,
  type ProviderInput,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import contribute from "../index.server.js";
import { createFspecProvider } from "../server/provider.js";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../paseo-plugin.json", import.meta.url)), "utf8"),
) as {
  id: string;
  name?: string;
  description?: string;
  requirements?: { paseo?: string };
};

function registration(): ProviderRegistration {
  let provider: ProviderRegistration | undefined;
  contribute({ registerProvider: (value: ProviderRegistration) => (provider = value), handle: () => {} });
  if (!provider) throw new Error("Provider was not registered");
  return provider;
}

function unknownSessionPrompt(sessionId: string): ProviderInput {
  return {
    type: "session.prompt",
    sessionId,
    prompt: {
      clientMessageId: "client-1",
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text: "hello" }] },
    },
  };
}

describe("Feature: Scaffold the fspec Paseo provider plugin project", () => {
  describe("Scenario: Plugin installs and registers the fspec provider", () => {
    it("ships a valid manifest and registers provider id `fspec` without a `command`", () => {
      // @step Given the project ships paseo-plugin.json, index.server.ts, and a provider registration
      expect(manifest.id).toBe("fspec-paseo-provider");
      expect(manifest.requirements?.paseo).toBe(">=0.13.0");
      const provider = registration();
      // @step When the developer installs the plugin into a Paseo daemon with `paseo plugin install <path>`
      // @step Then the plugin appears in the plugin list and registers a provider with id `fspec` and label `fspec`
      expect(provider.id).toBe("fspec");
      expect(provider.label).toBe("fspec");
      // @step And the provider declares no `command`
      expect(provider.command).toBeUndefined();
      expect(provider.status).toBeDefined();
    });
  });

  describe("Scenario: Scaffold reports unavailable with a diagnostic", () => {
    it("reports unavailable with a user-actionable diagnostic", async () => {
      // @step Given no fspec daemon is reachable (the provider is pointed at an empty daemon.json location)
      const emptyHome = mkdtempSync(join(tmpdir(), "fspec-no-daemon-"));
      const provider = createFspecProvider({ env: {}, homeDir: emptyHome });
      // @step When Paseo calls the provider's `status()`
      const status = await provider.status!({});
      // @step Then the provider reports `{ available: false }` with a user-actionable diagnostic naming the missing piece (e.g. 'no fspec daemon reachable' or 'no daemon.json found ... start fspec daemon first')
      expect(status.available).toBe(false);
      const diagnostic = (status as { diagnostic?: string }).diagnostic ?? "";
      expect(diagnostic.length).toBeGreaterThan(0);
      expect(
        /no fspec daemon reachable|no daemon\.json found/i.test(diagnostic),
        diagnostic,
      ).toBe(true);
      rmSync(emptyHome, { recursive: true, force: true });
    });
  });

  describe("Scenario: Scaffold registers a provider and closes a connected session cleanly", () => {
    it("connects, rejects unknown session sends, and closes cleanly", async () => {
      // @step Given the scaffold's test harness loads the contribution function
      const provider = registration();
      // @step When the harness connects to the provider and closes the resulting session
      const connection: ProviderConnection = await provider.connect({
        versions: [1],
        capabilities: [],
      });
      const events: unknown[] = [];
      connection.onEvent((event) => {
        events.push(ProviderEventSchema.parse(event));
      });
      await expect(connection.send(unknownSessionPrompt("missing-session"))).rejects.toThrow(
        /unknown session/i,
      );
      await connection.close();
      await connection.close();
      // @step Then the provider was registered by the contribution function
      expect(connection.version).toBe(1);
      expect(connection.capabilities).toEqual([]);
      // @step And the connection close resolves without error
      expect(events).toEqual([]);
    });
  });
});
