# AST research: thinking delivery
```
server/session.ts:404:11:await request({
```
- session.ts prompt() picks sendInputWithThinking for non-off levels with configJson '{}'.
- fspec resolve_turn_thinking: a non-None thinking_config string is parsed as the provider config for non-adaptive models; None makes the daemon call get_thinking_config(model, base level).
