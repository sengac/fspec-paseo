# AST research: board actions
```
No matches found
Error: Invalid AST pattern 'case "focus": { $$$B }' for typescript.

Pattern error: Multiple AST nodes are detected. Please check the pattern source `case "focus": { $$$B }`.

Pattern syntax guide:
- Use $VAR for single AST node (e.g., 'function $NAME()')
- Use $$$VAR for multiple nodes (e.g., 'function $NAME($$$ARGS)')
- Pattern must be valid typescript syntax that parses to a SINGLE AST node
- Multi-node patterns like 'expr1 expr2' or 'call() { block }' are not supported

Try the ast-grep playground: https://ast-grep.github.io/playground.html
No matches found
```
- Paseo stores plugin provider persistence at agent.persistence.metadata.pluginProviderPersistence (plugin-provider.ts:1810-1818); ours is { version: 1, data: { sessionId } }.
- Paseo maps a '/name args' prompt to a provider command when the provider lists it (plugin-provider.ts:1729-1744), so '/focus <id>' focuses a new agent without a model turn.
