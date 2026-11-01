import { createHash } from "node:crypto";
import {
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderConnection,
  type ProviderError,
  type ProviderEvent,
  type ProviderInput,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import { buildCatalog } from "./catalog.js";
import {
  createFspecDaemonClient,
  type DaemonClientOptions,
  type FspecDaemonClient,
} from "./daemon.js";
import { createSessionRegistry, unknownSession } from "./session.js";
import type { DecodedResponse, FspecServiceRequest } from "./wire.js";

// What the provider implements; negotiated against what Paseo offers.
const capabilities = [
  "prompt.message",
  "prompt.steer",
  "session.configure",
  "session.persistence",
  "permission",
  "session.subsession",
  "session.list",
  "prompt.command",
  "session.revert.files",
  "prompt.image",
  "session.can_stop_runtime",
] as const;

/**
 * Provider registration (FSPEC-001 scaffold, wired to the real daemon client by
 * FSPEC-003/004). Declares the `fspec` provider with no `command`: availability
 * comes from `status()`, a point-in-time probe through the daemon client (no
 * socket, no timer), and `connect()` returns a connection backed by its own
 * daemon client so closing one connection never poisons the next.
 */
export function createFspecProvider(
  daemonOptions: DaemonClientOptions = {},
): ProviderRegistration {
  const probe: FspecDaemonClient = createFspecDaemonClient(daemonOptions);
  return {
    id: "fspec",
    label: "fspec",
    description: "fspec agent sessions driven over the fspec daemon RPC protocol",
    icon: "icon.svg",
    async status() {
      // Lightweight availability probe: resolve + validate, never a socket.
      return probe.status();
    },
    async getCatalogCacheKey(request) {
      // A workspace-scoped lookup is bound to Paseo's cwd (FSPEC-060).
      return catalogCacheKey(request.scope === "workspace" ? { ...daemonOptions, directory: request.cwd } : daemonOptions);
    },
    async connect(request) {
      if (!request.versions.includes(1)) {
        throw new Error("Provider protocol version 1 is required");
      }
      const negotiated = negotiateProviderCapabilities(request.capabilities, capabilities);
      return createConnection(negotiated, createFspecDaemonClient(daemonOptions));
    },
  };
}

/**
 * Paseo reuses a provider catalog while its cache key is unchanged (FSPEC-042).
 * The key hashes the daemon target and its credential state, so a key added or
 * removed anywhere (Paseo or the fspec TUI) makes Paseo re-fetch the models.
 * One short-lived socket per lookup. No key while no single daemon can be
 * reached: Paseo then shares no catalog, and the catalog request itself
 * reports the reason.
 */
async function catalogCacheKey(options: DaemonClientOptions): Promise<string | undefined> {
  const daemon = createFspecDaemonClient(options);
  try {
    const connection = await daemon.connect();
    const response = await connection.request({ method: "listProviderCredentials" });
    if (!response.ok || response.method !== "listProviderCredentials") return undefined;
    const state = response.credentials.map((row) => [
      row.providerId,
      row.configured,
      row.credentialType,
      row.modelCount,
      row.maskedKey,
      row.source,
    ]);
    return createHash("sha256").update(JSON.stringify([connection.target.url, state])).digest("hex");
  } catch {
    return undefined;
  } finally {
    await daemon.close();
  }
}

function providerError(failure: unknown): ProviderError {
  const message = failure instanceof Error ? failure.message : String(failure);
  return { message, diagnostic: message };
}

function createConnection(
  capabilities: readonly string[],
  daemon: FspecDaemonClient,
): ProviderConnection {
  let closed = false;
  const listeners = new Set<(event: ProviderEvent) => void>();
  let streaming = false;

  function emit(event: ProviderEvent): void {
    if (closed) return;
    for (const listener of listeners) listener(event);
  }

  // Prompts and permission answers carry no requestId, so an unknown target is
  // rejected here, synchronously; request inputs get request.failed instead.
  function validateAdmission(input: ProviderInput): void {
    if (
      (input.type === "session.prompt" || input.type === "session.permission") &&
      !sessions.has(input.sessionId)
    ) {
      throw unknownSession(input.sessionId);
    }
  }

  async function request<M extends FspecServiceRequest["method"]>(
    message: Extract<FspecServiceRequest, { method: M }>,
  ): Promise<Extract<DecodedResponse, { ok: true; method: M }>> {
    const connection = await daemon.connect();
    if (!streaming) {
      streaming = true;
      connection.onEnvelope((envelope) => {
        if (envelope.kind === "event") sessions.handleChunk(envelope.sessionId, envelope.chunk);
        if (envelope.kind === "sessionEvent") sessions.handleSessionEvent(envelope.event);
      });
    }
    const response = await connection.request(message);
    if (!response.ok) throw new Error(`fspec daemon ${message.method} failed: ${response.error}`);
    if (response.method !== message.method) {
      throw new Error(
        `fspec daemon answered ${message.method} with ${response.method}`,
      );
    }
    return response as Extract<DecodedResponse, { ok: true; method: M }>;
  }

  const sessions = createSessionRegistry({ capabilities, request, emit });
  daemon.onEvent((event) => {
    if (event.type === "connection-lost") sessions.fail(event.reason);
  });

  async function dispatch(input: ProviderInput): Promise<void> {
    // The first directory this connection serves binds its daemon (FSPEC-054, FSPEC-060).
    const cwd = input.type === "session.open" ? input.config.cwd : "cwd" in input ? input.cwd : undefined;
    if (cwd !== undefined) daemon.bindDirectory(cwd);
    switch (input.type) {
      case "catalog": {
        const { providers } = await request({ method: "listProviders" });
        const { model } = await request({ method: "getDefaultModel" });
        emit({ type: "catalog", requestId: input.requestId, catalog: buildCatalog(providers, model) });
        return;
      }
      case "sessions":
        return sessions.list(input);
      case "session.revert":
        return sessions.revert(input);
      case "session.can_stop_runtime":
        return sessions.canStopRuntime(input);
      case "session.open":
        return sessions.open(input);
      case "session.prompt":
        return sessions.prompt(input);
      case "session.interrupt":
        return sessions.interrupt(input);
      case "session.configure":
        return sessions.configure(input);
      case "session.close":
        return sessions.close(input);
      case "session.permission":
        return sessions.permission(input);
      default:
        if ("requestId" in input) {
          throw new Error(`fspec provider does not support ${input.type}`);
        }
    }
  }

  function failed(input: ProviderInput, failure: unknown): void {
    if (input.type === "session.prompt") {
      emit({
        type: "session.prompt_result",
        sessionId: input.sessionId,
        clientMessageId: input.prompt.clientMessageId,
        result: { type: "failed", error: providerError(failure) },
      });
    } else if ("requestId" in input) {
      emit({ type: "request.failed", requestId: input.requestId, error: providerError(failure) });
    }
  }

  return {
    version: 1,
    capabilities,
    async send(input: ProviderInput) {
      if (closed) {
        throw new Error("fspec provider connection is closed");
      }
      validateAdmission(input);
      requireProviderCapabilities(capabilities, input);
      queueMicrotask(() => {
        if (!closed) void dispatch(input).catch((error: unknown) => failed(input, error));
      });
    },
    onEvent(listener: (event: ProviderEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      // Every daemon session is destroyed before the socket goes away.
      await sessions.closeAll();
      // Releases the daemon connection too: no sockets or listeners leak.
      await daemon.close();
    },
  };
}
