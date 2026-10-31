# AST research: overlapping prompts
```
server/session.ts:364:7:session.activeTurnId = turnId

server/session.ts:259:5:session.activeTurnId = null
server/session.ts:468:9:session.activeTurnId = null

```
- prompt() overwrites activeTurnId unconditionally; settle() clears it, so a second prompt orphans the first turn.
