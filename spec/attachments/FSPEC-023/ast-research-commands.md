# AST research: session commands
```
server/session.ts:160:1:function promptText(input: Input<"session.prompt">): string {
```
- promptText() turns a command prompt into '/name args' text and sends it as a normal prompt; no session.commands are published and prompt.command is not advertised.
- fspec TUI semantics: continue_parser.rs (DEFAULT_CONTINUE_BUDGET = 10, off refused while a goal is active), goal_parser.rs (show/clear/verify/set).
