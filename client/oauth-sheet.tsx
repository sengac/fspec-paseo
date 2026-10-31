import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText, ExternalLink, SettingsCard, SettingsInput, SettingsRow } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { OAuthStartInput, OAuthStartOutput, OAuthStatusOutput, OAuthStep, WriteOutput } from "../shared/settings.js";
import { StripButton } from "./board-details.js";
import { logoutPrompt, type OAuthMethod, oauthIntro, oauthLabel } from "./settings-model.js";

type Theme = PluginSurfaceProps["theme"];

export interface OAuthRpcs {
  start(input: OAuthStartInput): Promise<OAuthStartOutput>;
  complete(input: { loginId: string; code: string }): Promise<WriteOutput>;
  status(input: { loginId: string }): Promise<OAuthStatusOutput>;
  cancel(input: { loginId: string }): Promise<unknown>;
  logout(input: { providerId: string }): Promise<WriteOutput>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(output: WriteOutput | OAuthStartOutput): string | null {
  if ("state" in output) return output.reason;
  return output.ok ? null : output.error;
}

/** "✓ Logged in [Claude]": the sign-in state and Log out (FSPEC-044). */
export function OAuthStatusSheet(props: {
  providerId: string;
  theme: Theme;
  rpcs: OAuthRpcs;
  onChanged(text: string): Promise<void>;
  onDone(): void;
}) {
  const c = props.theme.colors;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = oauthLabel(props.providerId);

  async function logout() {
    const problem = failure(await props.rpcs.logout({ providerId: props.providerId }).catch((e: unknown) => ({ ok: false as const, error: message(e) })));
    if (problem !== null) return setError(problem);
    await props.onChanged(`Logged out of ${label}`);
    props.onDone();
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.statusSuccess }}>{`✓ Signed in with ${label}`}</Text>
      {error !== null ? <Text style={{ color: c.statusDanger }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
        {confirming ? (
          <>
            <Text style={{ color: c.foreground, alignSelf: "center" }}>{logoutPrompt(props.providerId)}</Text>
            <StripButton theme={props.theme} label="Log out" onPress={() => void logout()} />
            <StripButton theme={props.theme} label="Cancel" onPress={() => setConfirming(false)} />
          </>
        ) : (
          <>
            <StripButton theme={props.theme} label="Close" onPress={props.onDone} />
            <StripButton theme={props.theme} label="Log out" onPress={() => setConfirming(true)} />
          </>
        )}
      </View>
    </View>
  );
}

type Phase =
  | { kind: "host" }
  | { kind: "starting" }
  | { kind: "waiting"; loginId: string; step: OAuthStep }
  | { kind: "succeeded" }
  | { kind: "failed"; error: string };

/**
 * One sign-in method, run like the fspec TUI: browser and device code wait for
 * the user while the sheet long-polls the server; code sign-in takes a pasted
 * code. Closing the sheet cancels a sign-in still in progress.
 */
export function OAuthLoginSheet(props: {
  providerId: string;
  method: OAuthMethod;
  theme: Theme;
  rpcs: OAuthRpcs;
  onChanged(text: string): Promise<void>;
  onDone(): void;
}) {
  const c = props.theme.colors;
  const label = oauthLabel(props.providerId);
  const copilot = props.providerId === "github-copilot";
  const [phase, setPhase] = useState<Phase>(copilot ? { kind: "host" } : { kind: "starting" });
  const host = useRef("");
  const code = useRef("");
  const live = useRef(true);
  const loginId = useRef<string | null>(null);
  const rpcs = useRef(props.rpcs);
  rpcs.current = props.rpcs;

  async function start() {
    setPhase({ kind: "starting" });
    let output: OAuthStartOutput;
    try {
      output = await rpcs.current.start({
        providerId: props.providerId,
        method: props.method,
        enterpriseHost: host.current.trim() === "" ? null : host.current.trim(),
      });
    } catch (error) {
      output = { ok: false, error: message(error) };
    }
    if (!live.current) return;
    if (!("ok" in output) || !output.ok) return setPhase({ kind: "failed", error: failure(output) ?? "Sign-in failed" });
    loginId.current = output.loginId;
    setPhase({ kind: "waiting", loginId: output.loginId, step: output.step });
    if (output.step.kind !== "code") void watch(output.loginId);
  }

  async function succeeded() {
    loginId.current = null;
    setPhase({ kind: "succeeded" });
    await props.onChanged(`Signed in to ${label}`);
  }

  /** Long-polls the sign-in until it ends or the sheet closes. */
  async function watch(id: string) {
    while (live.current && loginId.current === id) {
      let status: OAuthStatusOutput;
      try {
        status = await rpcs.current.status({ loginId: id });
      } catch {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 2000));
        continue;
      }
      if (!live.current || loginId.current !== id) return;
      if (status.state === "pending") continue;
      if (status.state === "succeeded") return void succeeded();
      loginId.current = null;
      return setPhase({ kind: "failed", error: status.state === "failed" ? status.error : "The sign-in was abandoned" });
    }
  }

  async function submitCode(id: string) {
    if (code.current.trim() === "") return;
    const problem = failure(await rpcs.current.complete({ loginId: id, code: code.current }).catch((e: unknown) => ({ ok: false as const, error: message(e) })));
    if (!live.current) return;
    if (problem === null) await succeeded();
    else {
      loginId.current = null;
      setPhase({ kind: "failed", error: problem });
    }
  }

  useEffect(() => {
    live.current = true;
    if (!copilot) void start();
    return () => {
      live.current = false;
      // Closing the sheet abandons a sign-in still in progress.
      if (loginId.current !== null) void rpcs.current.cancel({ loginId: loginId.current }).catch(() => {});
    };
    // Start once per sheet; the screen re-keys the sheet for another method.
  }, []);

  const buttons = (children: ReactNode) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>{children}</View>
  );

  switch (phase.kind) {
    case "host":
      return (
        <View style={{ gap: 12 }}>
          <SettingsCard>
            <SettingsInput
              label="GitHub Enterprise host"
              hint="Leave empty for github.com"
              placeholder="ghe.example.com"
              onChangeText={(text) => (host.current = text)}
            />
          </SettingsCard>
          {buttons(
            <>
              <StripButton theme={props.theme} label="Cancel" onPress={props.onDone} />
              <StripButton theme={props.theme} label="Start sign-in" onPress={() => void start()} />
            </>,
          )}
        </View>
      );
    case "starting":
      return <Text style={{ color: c.foregroundMuted }}>Starting sign-in…</Text>;
    case "succeeded":
      return (
        <View style={{ gap: 12 }}>
          <Text style={{ color: c.statusSuccess }}>{`✓ Signed in to ${label}`}</Text>
          {buttons(<StripButton theme={props.theme} label="Done" onPress={props.onDone} />)}
        </View>
      );
    case "failed":
      return (
        <View style={{ gap: 12 }}>
          <Text style={{ color: c.statusDanger }}>{phase.error}</Text>
          {buttons(
            <>
              <StripButton theme={props.theme} label="Close" onPress={props.onDone} />
              <StripButton theme={props.theme} label="Try again" onPress={() => (copilot ? setPhase({ kind: "host" }) : void start())} />
            </>,
          )}
        </View>
      );
    case "waiting": {
      const { step } = phase;
      return (
        <View style={{ gap: 12 }}>
          <Text style={{ color: c.foreground }}>{oauthIntro(step)}</Text>
          {step.kind === "device" ? (
            <View style={{ gap: 8, alignItems: "flex-start" }}>
              <Text style={{ color: c.foreground, fontSize: 28, fontWeight: "700", letterSpacing: 3 }} selectable>
                {step.userCode}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <StripButton theme={props.theme} label="Copy code" onPress={() => void copyText(step.userCode).catch(() => {})} />
              </View>
              <ExternalLink href={step.verificationUrl}>{step.verificationUrl}</ExternalLink>
            </View>
          ) : null}
          {step.kind === "code" ? (
            <SettingsCard>
              <SettingsRow label="Sign-in page">
                <ExternalLink href={step.authorizeUrl}>Open the sign-in page</ExternalLink>
              </SettingsRow>
              <SettingsInput label="Code" placeholder="Paste the code" onChangeText={(text) => (code.current = text)} />
            </SettingsCard>
          ) : (
            <Text style={{ color: c.foregroundMuted }}>Waiting for you to finish signing in…</Text>
          )}
          {buttons(
            <>
              <StripButton theme={props.theme} label="Cancel" onPress={props.onDone} />
              {step.kind === "code" ? (
                <StripButton theme={props.theme} label="Submit" onPress={() => void submitCode(phase.loginId)} />
              ) : null}
            </>,
          )}
        </View>
      );
    }
  }
}
