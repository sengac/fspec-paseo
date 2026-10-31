# Research: provider settings wire codec (FSPEC-041)

## Scope

Add 23 `FspecService` methods to `server/wire.ts`: indices 30–38 and 88–101. See
`provider-settings-overview.md` (attached to this card) for the full table. Codec only. This card
changes no provider behaviour, so it can ship on its own.

## How a method is added today

`server/wire.ts` handles each method in five places. `listProviders` (idx 28) and
`getWorkUnitDetails` (idx 123) are the templates:

| place | `listProviders` line | what to add |
|---|---|---|
| method → index map | 456 | `setDefaultModel: 30`, … `oauthCopilotDeviceStart: 101` |
| `FspecServiceRequest` union | 519 | `{ method: "setProviderCredentials"; providerId: string; creds: ProviderCredentialInput }`, … |
| response value union | 592 | `{ method: "testProviderConnection"; value: Result<TestConnectionResult> }`, … |
| request encoder `switch` | 1407 | write args in declaration order |
| response decoder `switch` | 1611 / 1808 / 1933 | read the return type |
| `DecodedResponse` union | 1684 | flattened result shape |

The bincode conventions are already implemented in `server/bincode.ts`: fixed-width LE ints,
u64 length prefixes, a 1-byte `Option` tag, and a u32 variant index for `Result`.

## Payload types to add (field order = wire order)

From `rust/rpc-types/src/lib.rs` and `provider_settings.rs`:

```rust
pub struct ProviderCredentialInfo {      // lib.rs:760
    provider_id: String, display_name: String, configured: bool,
    credential_type: String,              // "api_key" | "oauth" | "custom"
    model_count: u32,
    masked_key: Option<String>,           // e.g. "sk-ant-••••mnop"; None for OAuth/unconfigured
    source: Option<String>,               // "explicit" | "file" | "env" | "dotenv"
}
pub struct ProviderCredentialInput {     // lib.rs:813 — flat struct, `kind` discriminant
    kind: String, api_key: Option<String>, oauth_token: Option<String>,
    oauth_refresh_token: Option<String>, custom_endpoint: Option<String>,
    custom_api_key: Option<String>,
}
pub struct TestConnectionResult { success: bool, error: Option<String>, latency_ms: u32 }  // lib.rs:861
pub struct OAuthHeadlessStart { authorize_url: String, pkce_verifier: String }            // lib.rs:784
pub struct OAuthDeviceStart { user_code: String, verification_url: String,
                              device_auth_id: String, interval: u64 }                     // lib.rs:793
pub struct CustomModelDefinition {       // lib.rs:544
    id: String, display_name: Option<String>, facade: Option<String>,
    context_window: Option<u32>, max_output_tokens: Option<u32>,
    compaction_threshold_type: Option<String>, compaction_threshold_value: Option<u32>,
    reasoning: Option<bool>, has_vision: Option<bool>,
}
pub struct ProfileDefinition {           // lib.rs:573 — CHECK the full field list; only the first 7 were read
    base_url: String, api_key: String, context_window: Option<u32>,
    max_output_tokens: Option<u32>, compaction_threshold_type: Option<String>,
    compaction_threshold_value: Option<u32>, streaming: Option<bool>, /* … */
}
pub struct ProviderSettingsConfig { provider_id: String, settings: ProfileDefinition,
                                    profiles: Vec<ProviderProfileConfig> }   // provider_settings.rs:7
pub struct ProviderProfileConfig { name: String, definition: ProfileDefinition }
pub struct ModelEntry { id: String, display_name: String, context_window: u32,
                        supports_reasoning: bool, supports_vision: bool, is_custom: bool }  // already decoded
```

Re-read every struct in full before encoding. A missed trailing field silently shifts every later
byte. `ProfileDefinition` is the riskiest because it has grown over time (PROV-108, PROV-139).

## Golden vectors

`test/golden/golden-vectors.txt` is produced by a small Rust program like the one attached to
FSPEC-007 (`spec/attachments/FSPEC-007/main.rs`), using `bincode = "1"` with serde structs that copy
the real ones. Extend it with one request and one response per new method, including:

- `ProviderCredentialInput` with every `Option` both `None` and `Some`
- `Result<TestConnectionResult, String>` both `Ok` and `Err`
- `Option<ProviderCredentialInfo>` both `None` and `Some` (`get_provider_credential`)
- `ProviderSettingsConfig` with 0 and 2 profiles
- `oauth_copilot_device_start(None)` and `(Some("ghe.example.com"))`

Prefer `codelet_rpc_types` directly over hand-copied structs, if the generator can depend on the
fspec crate path. Then the vectors break when fspec changes a type.

## Suggested rules for Example Mapping

- Each new method round-trips its request and response bytes exactly as the Rust vectors do.
- A `Result::Err(String)` from the daemon decodes as `{ ok: false }` data, not a thrown error.
- `refresh_models_cache("")` encodes an empty provider id (meaning all providers).
- Secrets (`api_key`, `custom_api_key`, `oauth_token`) never appear in any thrown error or
  debug string the codec produces.
