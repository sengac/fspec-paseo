# AST research: board panel
```
/Users/rquast/projects/paseo/plugin-examples/translations/index.client.tsx:25:3:client.addWorkspacePanel({
/Users/rquast/projects/paseo/plugin-examples/local-plugin/index.client.tsx:6:3:client.addWorkspacePanel({

/Users/rquast/projects/paseo/plugin-examples/translations/index.client.tsx:48:3:client.addSlashCommand({

/Users/rquast/projects/paseo/plugin-examples/markdown-panel/client/rich-markdown.tsx:191:29:useTabState(props.tab, viewSchema, defaultView)

shared/board.ts:41:1:export const watchBoardRpc = defineRpc({

```
- Pattern: index.client.tsx registers panel + Command Center item (local-plugin); panel component uses useRpc/useWorkspace and theme.colors only.
- No client entry exists in fspec-paseo yet; watchBoardRpc (FSPEC-034) is the only board contract.
