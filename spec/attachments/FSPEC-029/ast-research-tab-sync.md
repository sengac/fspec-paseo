# AST research: tab sync
```
server/session.ts:783:7:if (session && !session.owned) closeChild(session);

```
- handleSessionEvent only closes sub-agent children; an fspec-side close of an owned session leaves a dead Paseo tab. No set_active_session call exists anywhere in server/.
