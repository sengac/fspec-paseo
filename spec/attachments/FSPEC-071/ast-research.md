# AST research: scenario blocks the coverage test ranges must match (FSPEC-071)

```
$ fspec astgrep --lang typescript --path test --pattern 'describe($NAME, $FN)'  (Scenario blocks, first 20 of 215)
test/board-details.test.ts:17:3:describe("Scenario: Full details come from get_work_unit_details", () => {
test/workspace-work-units-push.test.ts:50:3:describe("Scenario: The WorkspaceWorkUnitsUpdate envelope matches the daemon's encoding", () => {
test/workspace-work-units-push.test.ts:67:3:describe("Scenario: The daemon client delivers a workspace push to its listeners", () => {
test/workspace-work-units-push.test.ts:84:3:describe("Scenario: A push for another workspace leaves the start workspace's board alone", () => {
test/wire.test.ts:27:3:describe("Scenario: Golden vectors validate every Envelope variant byte-exactly", () => {
test/wire.test.ts:54:3:describe("Scenario: Golden vectors validate the RPC request and response framing", () => {
test/wire.test.ts:76:3:describe("Scenario: A later story encodes and decodes through the small public surface", () => {
test/wire.test.ts:98:3:describe("Scenario: Unknown Envelope variant index produces a descriptive error", () => {
test/wire.test.ts:115:3:describe("Scenario: Malformed length prefix produces a descriptive error", () => {
test/steer-and-queue.test.ts:53:3:describe("Scenario: submit_input matches the daemon's encoding", () => {
test/steer-and-queue.test.ts:73:3:describe("Scenario: The provider advertises steering", () => {
test/steer-and-queue.test.ts:85:3:describe("Scenario: A steered prompt joins the running turn", () => {
test/steer-and-queue.test.ts:107:3:describe("Scenario: A steer with no running turn fails", () => {
test/steer-and-queue.test.ts:121:3:describe("Scenario: A steer the daemon rejects fails its prompt", () => {
test/steer-and-queue.test.ts:137:3:describe("Scenario: A steer with clearPendingPermissions denies the pause blocking it", () => {
test/steer-and-queue.test.ts:160:3:describe("Scenario: A steer the running turn never reached runs as its own turn", () => {
test/bot-mode.test.ts:61:3:describe("Scenario: The catalog offers agent and bot modes", () => {
test/bot-mode.test.ts:77:3:describe("Scenario: A bot is created with fspec's orchestrator role", () => {
test/bot-mode.test.ts:92:3:describe("Scenario: A bot in another workspace is created there with the orchestrator role", () => {
test/bot-mode.test.ts:105:3:describe("Scenario: An agent opened without a mode has no role", () => {
```

Every test mapping in spec/features/*.feature.coverage names one of these blocks by its
scenario; its range must run from the describe line to its closing `});`.
The scenario block is located by the same rule in the audit script (an exact
`describe("Scenario: <name>", ...)` line and the first `});` at its indentation).
