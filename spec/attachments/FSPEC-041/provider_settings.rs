//! FSPEC-041 golden vectors: provider settings, credential, model-cache and
//! OAuth RPCs (FspecService variant indices 30-38, 88-101).
//!
//! Serializes the REAL codelet-rpc-types values with bincode 1.3.3 at the
//! argument / payload level (like the FSPEC-016/023 vectors): `<name>_args` is
//! the bytes after the u32 request variant index; `<name>_reply` is the
//! FspecServiceResponse payload after its u32 variant index. A tuple of args
//! serializes as the concatenation of its fields, exactly like the tarpc
//! generated request struct variant.

use codelet_rpc_types::{
    CustomModelDefinition, ModelEntry, OAuthDeviceStart, OAuthHeadlessStart, ProfileDefinition,
    ProviderCredentialInfo, ProviderCredentialInput, ProviderProfileConfig, ProviderSettingsConfig,
    TestConnectionResult,
};
use serde::Serialize;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}
fn emit<T: Serialize>(name: &str, value: &T) {
    println!("{} {}", name, hex(&bincode::serialize(value).unwrap()));
}
fn s(v: &str) -> String {
    v.to_string()
}

fn full_profile() -> ProfileDefinition {
    ProfileDefinition {
        base_url: s("http://127.0.0.1:1234/v1"),
        api_key: s("lm-key"),
        context_window: Some(32768),
        max_output_tokens: Some(4096),
        compaction_threshold_type: Some(s("percent")),
        compaction_threshold_value: Some(80),
        streaming: Some(false),
        auto_continue: Some(3),
        preserve_thinking: Some(true),
        max_images: Some(4),
        loop_detection_enabled: Some(true),
        loop_detection_window: Some(20),
        loop_detection_max_repeats: Some(5),
        loop_detection_max_retries: Some(2),
    }
}
fn bare_profile() -> ProfileDefinition {
    ProfileDefinition { base_url: s("http://localhost:11434/v1"), api_key: s(""), ..Default::default() }
}
fn custom_model() -> CustomModelDefinition {
    CustomModelDefinition {
        id: s("qwen3-coder"),
        display_name: Some(s("Qwen3 Coder")),
        facade: None,
        context_window: Some(65536),
        max_output_tokens: None,
        compaction_threshold_type: None,
        compaction_threshold_value: None,
        reasoning: Some(true),
        has_vision: Some(false),
    }
}
fn configured_row() -> ProviderCredentialInfo {
    ProviderCredentialInfo {
        provider_id: s("anthropic"),
        display_name: s("Anthropic"),
        configured: true,
        credential_type: s("api_key"),
        model_count: 12,
        masked_key: Some(s("sk-ant-••••mnop")),
        source: Some(s("file")),
    }
}

fn main() {
    // 30 set_default_model(model) -> Result<(), String>
    emit("set_default_model_args", &(s("anthropic/claude-sonnet-5-5"),));
    emit("void_ok_reply", &Ok::<(), String>(()));

    // 31-33 custom models
    emit("add_custom_model_args", &(s("lmstudio"), s("default"), custom_model()));
    emit("update_custom_model_args", &(s("lmstudio"), s("default"), s("qwen3"), custom_model()));
    emit("delete_custom_model_args", &(s("lmstudio"), s("default"), s("qwen3-coder")));

    // 34 list_provider_settings -> Result<Vec<ProviderSettingsConfig>, String>
    let settings: Result<Vec<ProviderSettingsConfig>, String> = Ok(vec![
        ProviderSettingsConfig { provider_id: s("ollama"), settings: bare_profile(), profiles: vec![] },
        ProviderSettingsConfig {
            provider_id: s("lmstudio"),
            settings: full_profile(),
            profiles: vec![
                ProviderProfileConfig { name: s("fast"), definition: bare_profile() },
                ProviderProfileConfig { name: s("big"), definition: full_profile() },
            ],
        },
    ]);
    emit("list_provider_settings_reply", &settings);

    // 35-38 profiles
    emit("save_provider_settings_args", &(s("lmstudio"), full_profile()));
    emit("save_profile_args", &(s("lmstudio"), s("big"), full_profile()));
    emit("delete_profile_args", &(s("lmstudio"), s("fast")));
    emit("rename_profile_args", &(s("lmstudio"), s("big"), s("huge"), full_profile()));

    // 88 list_provider_credentials -> Vec<ProviderCredentialInfo>
    let unconfigured = ProviderCredentialInfo {
        provider_id: s("openai"),
        display_name: s("OpenAI"),
        configured: false,
        credential_type: s("api_key"),
        model_count: 0,
        masked_key: None,
        source: None,
    };
    emit("list_provider_credentials_reply", &vec![configured_row(), unconfigured]);

    // 89 get_provider_credential(provider_id) -> Option<ProviderCredentialInfo>
    emit("get_provider_credential_args", &(s("anthropic"),));
    emit("get_provider_credential_none_reply", &None::<ProviderCredentialInfo>);
    emit("get_provider_credential_some_reply", &Some(configured_row()));

    // 90 set_provider_credentials(provider_id, creds) -> Result<(), String>
    emit(
        "set_provider_credentials_args",
        &(s("anthropic"), ProviderCredentialInput::api_key("sk-ant-test")),
    );
    // A custom endpoint exercises the other Option slots.
    emit(
        "set_provider_credentials_custom_args",
        &(s("lmstudio"), ProviderCredentialInput::custom("http://127.0.0.1:1234/v1", Some(s("lm-key")))),
    );

    // 91 delete_provider_credentials(provider_id) -> Result<(), String>
    emit("delete_provider_credentials_args", &(s("anthropic"),));

    // 92 test_provider_connection(provider_id) -> Result<TestConnectionResult, String>
    emit("test_provider_connection_args", &(s("anthropic"),));
    emit(
        "test_provider_connection_ok_reply",
        &Ok::<TestConnectionResult, String>(TestConnectionResult {
            success: false,
            error: Some(s("401 Unauthorized")),
            latency_ms: 812,
        }),
    );
    emit("test_provider_connection_err_reply", &Err::<TestConnectionResult, String>(s("unknown provider")));

    // 93 refresh_models_cache(provider_id) -> Result<Vec<ModelEntry>, String>
    emit("refresh_models_cache_all_args", &(s(""),));
    emit(
        "refresh_models_cache_reply",
        &Ok::<Vec<ModelEntry>, String>(vec![
            ModelEntry {
                id: s("claude-sonnet-5-5"),
                display_name: s("Claude Sonnet 5.5"),
                context_window: 200000,
                supports_reasoning: true,
                supports_vision: true,
                is_custom: false,
            },
            ModelEntry {
                id: s("qwen3-coder"),
                display_name: s("Qwen3 Coder"),
                context_window: 65536,
                supports_reasoning: true,
                supports_vision: false,
                is_custom: true,
            },
        ]),
    );

    // 94-101 OAuth
    emit("oauth_clear_tokens_args", &(s("anthropic"),));
    emit("oauth_get_tokens_args", &(s("anthropic"),));
    emit("oauth_get_tokens_reply", &Ok::<bool, String>(true));
    emit("oauth_browser_login_args", &(s("anthropic"),));
    emit("oauth_headless_start_args", &(s("anthropic"),));
    emit(
        "oauth_headless_start_reply",
        &Ok::<OAuthHeadlessStart, String>(OAuthHeadlessStart {
            authorize_url: s("https://claude.ai/oauth/authorize?state=x"),
            pkce_verifier: s("verifier-123"),
        }),
    );
    emit("oauth_headless_complete_args", &(s("anthropic"), s("code#state"), s("verifier-123")));
    let device = OAuthDeviceStart {
        user_code: s("ABCD-1234"),
        verification_url: s("https://github.com/login/device"),
        device_auth_id: s("dev-1"),
        interval: 5,
    };
    emit("oauth_device_start_args", &(s("codex"),));
    emit("oauth_device_start_reply", &Ok::<OAuthDeviceStart, String>(device.clone()));
    emit("oauth_device_poll_args", &(s("codex"), s("dev-1"), 5u64));
    emit("oauth_copilot_device_start_none_args", &(None::<String>,));
    emit("oauth_copilot_device_start_ghe_args", &(Some(s("ghe.example.com")),));
}
