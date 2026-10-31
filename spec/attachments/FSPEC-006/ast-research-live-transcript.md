# AST research: live transcript (FSPEC-006)

## StreamChunk variants consumed (server/wire.ts)
```
server/wire.ts:196:1:export type StreamChunk =

```

## Session registry entry points (server/session.ts)
```
server/session.ts:299:7:switch (chunk.type) {
server/session.ts:160:3:function settle(session: FspecSession, state: TurnTerminal, error?: ProviderError): void {

```

## Envelope routing (server/provider.ts)
```
server/provider.ts:84:7:connection.onEnvelope((envelope) => {

```

## Findings
- Live chunks reach the registry via provider.ts onEnvelope -> sessions.handleChunk(daemonSessionId, chunk); FSPEC-006 extends handleChunk to fold every chunk into timeline items before terminal settlement.
- settle() is the single terminal-turn emitter; transient rows must be terminalized before it runs.
- fspec source (81ee9f15): rust/rpc-types/src/transcript.rs (TranscriptCursor/Page/Fragment/Original/Error), transcript_assembler.rs (fragments concatenate into one serde-JSON StreamChunk per entry), service_declaration/supervision_credentials.rs (get_transcript_page(session_id, cursor: Option<TranscriptCursor>, snapshot_end: Option<u64>, max_bytes: u32) -> Result<TranscriptPage, TranscriptError>), trait index 117 recounted at HEAD.
- StreamChunk serde JSON is externally tagged; struct fields snake_case except the renamed correlationId/observedCorrelationIds/toolCall/toolResult/toolProgress/queuedInputs/contextFill/compactionResult; NotificationSeverity/InterruptionReason serialize as variant names.
