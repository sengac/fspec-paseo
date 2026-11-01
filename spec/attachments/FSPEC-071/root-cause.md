# FSPEC-071 root cause: coverage line references drifted from the code

## Problem

`spec/features/*.feature.coverage` holds absolute line numbers. Code and tests
edited since a mapping was linked shift those numbers, and `fspec link-coverage`
on an existing test file adds a second mapping instead of moving the first one.
At audit start, 88 of 329 test mappings no longer matched their
`describe("Scenario: …")` block, e.g. fspec-provider-settings-screen
"An expanded OpenAI shows Settings…" 167-187 while the block is 171-191. Ten
impl mappings pointed past the end of their file. 368 of 529 impl mappings
date from the initial import (098a2af) and some were already stale at that
point, e.g. fspec-approval-pauses "A permission answer for an unknown session
is rejected" -> server/provider.ts 83-90, which is the catalog cache-key hash
(`row.modelCount, …`), not permission handling.

## Fix

1. Test ranges: each one set to its scenario's describe block (opening line to the
   closing `});` at the same indent), picking the block nearest the old start.
2. Impl ranges: each run carried from the impl file at the commit that first
   recorded that exact mapping to HEAD with a line diff (difflib). Lines deleted
   since drop out, and lines inserted inside a run stay in it. A mapping that
   covered the whole file when it was linked now covers the whole current file.
3. Semantic review: every impl mapping that is not whole-file was read against its
   scenario and test, and its runs set to the whole functions/blocks that
   implement it, or dropped when the file has none.

Edits were made to the JSON directly. The CLI cannot move an existing range: it
appends a duplicate. Scenario names, files and fspec's `stats` block are unchanged.

## Alternatives rejected

- `fspec generate-coverage`: forbidden; it regenerates mappings by guessing.
- unlink + link per mapping: loses the impl mappings attached to a test mapping
  and still requires the same line analysis.
