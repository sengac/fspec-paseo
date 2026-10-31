# AST research: steer and queue through submit_input (FSPEC-051)

```
Error: Invalid AST pattern 'async prompt(input: $T): Promise<void> { $$$B }' for typescript.

Pattern error: Multiple AST nodes are detected. Please check the pattern source `async prompt(input: $T): Promise<void> { $$$B }`.

Pattern syntax guide:
- Use $VAR for single AST node (e.g., 'function $NAME()')
- Use $$$VAR for multiple nodes (e.g., 'function $NAME($$$ARGS)')
- Pattern must be valid typescript syntax that parses to a SINGLE AST node
- Multi-node patterns like 'expr1 expr2' or 'call() { block }' are not supported

Try the ast-grep playground: https://ast-grep.github.io/playground.html
server/session.ts:728:3:function advance(session: FspecSession): void {

server/oauth.ts:48:3:function settle(loginId: string, login: Login): void {
server/session.ts:656:3:function settle(session: FspecSession, state: TurnTerminal, error?: ProviderError): void {

server/session.ts:1121:11:settle(session, "canceled")
server/session.ts:1122:66:settle(session, "canceled")

server/provider.ts:21:1:const capabilities = [

/Users/rquast/projects/fspec/rust/sessions/src/background_session/input_modes.rs:19:5:pub fn submit_input(

/Users/rquast/projects/fspec/rust/sessions/src/background_session/input_modes.rs:75:5:pub fn continue_with_inbox(&self) -> Result<bool, String> {

/Users/rquast/projects/fspec/rust/agent-loop/src/agent_loop/finalization.rs:108:1:pub(super) fn start_queued_input(session: &BackgroundSession, state: &LoopState) {

```

- `prompt` enqueues a turn, answers `prompt_result turn`, `advance`s and always calls `send_input`, relying
  on the daemon's implicit queue for a busy session. `delivery` is never read, and `prompt.steer` is not in
  `capabilities`, so Paseo replaces the active turn instead of steering.
- `handleChunk` settles the head plus `queuedInputs.length` more turns as canceled on Interrupted, because
  older daemons dropped queued input. fspec RIG-016 parks them instead (`interrupted.rs` reports
  `queued_texts` without draining; `start_queued_input` leaves the inbox alone after an interrupt), and an
  idle `submit_input(Queue)` runs them first (`resume_queued`).
- `submit_input` while busy: Steer emits `UserInput` at once and is delivered at the next safe boundary with
  no further chunk; when the turn completes first, `continue_with_inbox` starts the undelivered steers
  (joined with blank lines) as a new turn *before* the next queued input. Queue starts in order on completion.
- Idle: Steer/Interrupt behave like `send_input`; Queue pushes then resumes the oldest parked input.
