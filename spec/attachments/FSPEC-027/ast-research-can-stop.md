# AST research: idle runtime veto
```
server/provider.ts:20:1:const capabilities = [

```
- session.can_stop_runtime is neither advertised nor handled, so Paseo cannot release idle fspec runtimes safely.
