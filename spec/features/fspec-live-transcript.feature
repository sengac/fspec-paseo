@done
@core
@provider
@FSPEC-006
Feature: Stream the live fspec transcript into Paseo's timeline

  """
  server/transcript.ts is a per-session fold from StreamChunk to timeline snapshots and usage, called by the FSPEC-005 registry for live Envelope::Event chunks and for replayed transcript entries. Terminal chunks first terminalize transient rows through the fold, then FSPEC-005 settles the turn. Replay adds get_transcript_page (idx 117) to server/wire.ts (TranscriptCursor/Page/Fragment/Error bincode shapes from rpc-types/src/transcript.rs) and parses the assembled JSON StreamChunks (serde externally tagged) in server/transcript-json.ts.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Generic + shell: a tool whose parsed input has a string 'command' field renders as Paseo 'shell' detail (command, accumulated progress output); every other tool renders as 'unknown' detail { input: parsed JSON input (raw string if not JSON), output: accumulated progress / result content }
  #   2. New segment item: each contiguous run of Text (or Thinking) chunks is its own assistant_message (or reasoning) item; any other rendered item, a UserInput, or a turn terminal closes the open segment
  #   3. Render everything for the mapped daemon session, with or without a Paseo-started turn; UserInput becomes a user_message, carrying clientMessageId only when it echoes a pending Paseo prompt with the same text; no session.turn events are invented for outside work
  #   4. In scope: on session.open with history 'replay' for a resumed daemon session, page the daemon transcript via get_transcript_page (idx 117) and publish the replayed timeline items before session.ready
  #   5. Every timeline.item is a complete snapshot: Text/Thinking deltas are accumulated by the provider and re-published under the same item id as a prefix-monotonic extension; nothing is polled from the daemon
  #   6. Tool calls: ToolCall opens a tool_call item (id/callId from the daemon tool call id, status running, error null); ToolProgress appends output_chunk to the item's output and re-publishes it; ToolResult sets the output to the result content and status completed, or status failed with error = content when is_error
  #   7. UserNotification maps to a notification item (Info/Warning/Error -> info/warning/error); Error maps to an error item with the daemon message (the turn's failed terminal stays with FSPEC-005)
  #   8. Compaction: a CompactionProgressUpdate with progress opens (or keeps) one compaction item in status loading; CompactionComplete publishes that item as completed with preTokens = original_tokens
  #   9. Usage: TokenUpdate publishes session.usage { inputTokens, outputTokens, cachedInputTokens = cache_read_input_tokens } and ContextFillUpdate publishes session.usage { contextWindowUsedTokens = effective_tokens, contextWindowMaxTokens = context_window }, carrying turnId while a Paseo turn is active
  #   10. Transient rows are terminalized before the terminal turn event: on Done/Error/Interrupted/InterruptedWithReason every still-running tool_call is re-published as canceled and a loading compaction as completed, then FSPEC-005 emits the terminal session.turn
  #   11. History replay decodes each assembled transcript entry as a serde-JSON StreamChunk (externally tagged, e.g. {"Text":{"text":..}} / "Done") and folds it through the same mapper as the live stream; replay publishes timeline items only (no usage, no session.turn) with timestamp = original.timestamp when present
  #   12. Replay pages with get_transcript_page(session_id, cursor, snapshot_end, max_bytes 65536): first call cursor None + snapshot_end None, then the returned snapshot_end and next_cursor until complete; a TranscriptError does not fail the open — it publishes a warning session.notice and the session still becomes ready
  #   13. Item ids never collide with rows Paseo already stored: tool items use 'tool:<daemon tool call id>'; every other item is '<epoch>:<n>:<kind>' where epoch is unique per session.open (so a reopened session never reuses an earlier open's ids) and n is a per-open counter of rendered items; snapshots of one item always reuse its id
  #
  # EXAMPLES:
  #   1. ToolProgress {toolCallId:'call-1', outputChunk:'a.txt\n'} re-publishes tool:call-1 with detail.output 'a.txt\n'; ToolResult {toolCallId:'call-1', content:'a.txt\nb.txt\n', isError:false} re-publishes it completed with output 'a.txt\nb.txt\n'; a ToolCall named 'Read' with input '{"path":"x"}' renders detail {type:'unknown', input:{path:'x'}, output:null}
  #   2. A ToolResult with isError true and content 'permission denied' publishes the tool_call as status 'failed' with error 'permission denied'
  #   3. Interrupted while tool call-2 is still running: the provider re-publishes tool:call-2 as canceled BEFORE emitting session.turn canceled
  #   4. UserNotification {message:'Rate limited', severity:Warning} publishes notification {level:'warning', message:'Rate limited'}; Error {error:'provider exploded'} publishes error {message:'provider exploded'} before the failed session.turn
  #   5. TokenUpdate {input_tokens:1200, output_tokens:300, cache_read_input_tokens:800} during turn-1 publishes session.usage {turnId:'turn-1', usage:{inputTokens:1200, outputTokens:300, cachedInputTokens:800}}; ContextFillUpdate {effective_tokens:50000, context_window:200000} publishes usage {contextWindowUsedTokens:50000, contextWindowMaxTokens:200000}
  #   6. Another client drives daemon session fspec-sess-42 with no Paseo turn active: UserInput 'hi from tui' publishes user_message {text:'hi from tui'} with no clientMessageId and the following Text is rendered, but no session.turn is emitted; a Paseo prompt 'fix it' (clientMessageId client-1) followed by UserInput 'fix it' publishes user_message with clientMessageId 'client-1'
  #   7. Reopening with persistence {sessionId:'fspec-sess-42'} and history 'replay': the provider pages get_transcript_page and the JSON entries [{"UserInput":{"text":"hi"}}, {"Text":{"text":"hello",...}}, "Done"] publish user_message 'hi' and assistant_message 'hello' between session.config and session.ready, then live chunks continue with the next ids
  #   8. Reopening with history 'replay' when get_transcript_page returns SessionUnavailable: the provider publishes a warning session.notice naming the transcript error and still emits session.ready
  #   9. Live: Text 'Hel' then Text 'lo' in turn-1 publish assistant_message {id:'<epoch>:1:assistant', text:'Hel'} then the same id with text 'Hello'; a ToolCall {id:'call-1', name:'Bash', input:'{"command":"ls"}'} publishes tool_call {id:'tool:call-1', callId:'call-1', name:'Bash', status:'running', detail:{type:'shell', command:'ls'}, error:null}; Text 'Done' afterwards opens a NEW item '<epoch>:3:assistant'
  #
  # QUESTIONS (ANSWERED):
  #   Q: How should fspec tool calls render — rich Paseo detail per known tool name, or a generic detail for every tool?
  #   A: Generic + shell: a tool whose parsed input has a string 'command' field renders as Paseo 'shell' detail (command, accumulated progress output); every other tool renders as 'unknown' detail { input: parsed JSON input (raw string if not JSON), output: accumulated progress / result content }
  #
  #   Q: Within one turn, does assistant text that resumes after a tool call continue the same assistant_message item or start a new segment item?
  #   A: New segment item: each contiguous run of Text (or Thinking) chunks is its own assistant_message (or reasoning) item; any other rendered item, a UserInput, or a turn terminal closes the open segment
  #
  #   Q: Should stream chunks that arrive with no Paseo-started turn (another client driving the same daemon session, UserInput echoes) be rendered?
  #   A: Render everything for the mapped daemon session, with or without a Paseo-started turn; UserInput becomes a user_message, carrying clientMessageId only when it echoes a pending Paseo prompt with the same text; no session.turn events are invented for outside work
  #
  #   Q: Is history replay on session.open (history: 'replay') in scope for FSPEC-006?
  #   A: In scope: on session.open with history 'replay' for a resumed daemon session, page the daemon transcript via get_transcript_page (idx 117) and publish the replayed timeline items before session.ready
  #
  # ASSUMPTIONS:
  #   1. The daemon pushes Envelope::Event stream chunks for every session to each connected client (no per-session subscription RPC), as the FSPEC-003 client already assumes
  #   2. Chunks the timeline does not render (SessionStateChange, ProviderWaiting, ResponseAttempt*, ContextSnapshot, work-unit/footer/debug/isolation updates, unsupported indices) are ignored and do not close an open text segment
  #
  # ========================================

  Background: User Story
    As a Paseo user running an fspec session
    I want to see the agent's live transcript (text, reasoning, tool calls, notifications, errors, compaction, usage) in Paseo's timeline as it streams
    So that I can follow and trust what the daemon-backed agent is doing without leaving Paseo

  Scenario: Streaming text accumulates into one assistant item per contiguous segment
    Given an open fspec session with an active Paseo turn
    When the daemon streams Text "Hel", Text "lo", a ToolCall "call-1" for Bash with input {"command":"ls"}, then Text "Done"
    Then the provider published assistant_message snapshots "Hel" then "Hello" under one item id
    And it published tool_call "tool:call-1" with callId "call-1", status running, error null and shell detail command "ls"
    And the text "Done" was published under a new assistant_message id


  Scenario: Reasoning streams as its own reasoning item
    Given an open fspec session with an active Paseo turn
    When the daemon streams Thinking "plan", Thinking "ning", then Text "ok"
    Then the provider published reasoning snapshots "plan" then "planning" under one item id
    And the text "ok" was published as a separate assistant_message item


  Scenario: Tool progress and results update the same tool call item
    Given an open fspec session with a running Bash tool call "call-1"
    When the daemon streams ToolProgress "a.txt\n" and then ToolResult "a.txt\nb.txt\n" for "call-1"
    Then the provider re-published "tool:call-1" running with shell output "a.txt\n" and then completed with output "a.txt\nb.txt\n"
    And a ToolCall named "Read" with input {"path":"x"} is published with unknown detail input {"path":"x"} and output null


  Scenario: A failing tool result marks the tool call failed
    Given an open fspec session with a running tool call "call-1"
    When the daemon streams a ToolResult for "call-1" with isError true and content "permission denied"
    Then the provider published "tool:call-1" with status failed and error "permission denied"


  Scenario: Running tool calls are terminalized before the terminal turn event
    Given an open fspec session whose active turn has a running tool call "call-2"
    When the daemon streams Interrupted for the session
    Then the provider re-published "tool:call-2" with status canceled
    And that tool_call event came before the session.turn canceled event


  Scenario: Notifications and errors render as timeline rows
    Given an open fspec session with an active Paseo turn
    When the daemon streams UserNotification "Rate limited" with severity Warning and then Error "provider exploded"
    Then the provider published a notification item with level warning and message "Rate limited"
    And it published an error item with message "provider exploded" before the session.turn failed event


  Scenario: Compaction renders as one row that goes from loading to completed
    Given an open fspec session with an active Paseo turn
    When the daemon streams CompactionProgressUpdate with progress and then CompactionComplete with original_tokens 90000
    Then the provider published one compaction item with status loading and then the same id with status completed and preTokens 90000


  Scenario: Token and context usage publish session.usage
    Given an open fspec session whose active turn is "turn-1"
    When the daemon streams TokenUpdate input 1200, output 300, cache_read 800 and ContextFillUpdate effective_tokens 50000 of context_window 200000
    Then the provider published session.usage with turnId "turn-1" and usage inputTokens 1200, outputTokens 300, cachedInputTokens 800
    And it published session.usage with contextWindowUsedTokens 50000 and contextWindowMaxTokens 200000


  Scenario: Activity from another client renders without inventing turns
    Given an open fspec session with no active Paseo turn
    When the daemon streams UserInput "hi from tui" and Text "hello" driven by another client
    Then the provider published user_message "hi from tui" with no clientMessageId and assistant_message "hello"
    And it emitted no session.turn event
    And a Paseo prompt "fix it" with clientMessageId "client-1" followed by UserInput "fix it" publishes a user_message carrying clientMessageId "client-1"


  Scenario: Reopening with history replay publishes the daemon transcript before ready
    Given a persisted fspec session "fspec-sess-42" whose daemon transcript holds UserInput "hi", Text "hello" and Done across several pages
    When Paseo reopens it with that persistence and history "replay"
    Then the provider paged get_transcript_page from no cursor to completion following snapshot_end and next_cursor
    And it published user_message "hi" and assistant_message "hello" between session.config and session.ready with no session.turn or session.usage
    And live chunks after ready are published under new ids that do not collide with the replayed ones


  Scenario: A transcript error does not fail a replaying open
    Given a persisted fspec session whose get_transcript_page fails with SessionUnavailable
    When Paseo reopens it with history "replay"
    Then the provider published a warning session.notice naming the transcript error
    And the open still completed with session.ready

