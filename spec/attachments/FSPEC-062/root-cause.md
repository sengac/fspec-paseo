# FSPEC-062 root cause: a missing directory under a symlinked workspace is "outside" it

## Problem

- `canonicalPath` (`server/workspaces.ts:14-20`) returns `realpathSync(path)`
  when the path exists and silently falls back to `resolve(path)` on **any**
  error. The two branches canonicalise differently: an existing path loses
  its symlinks, a missing one keeps them.
- `within(root, dir)` (`server/workspaces.ts:23-26`) compares the two. The
  daemon reports its workspaces by real path (fspec canonicalises,
  `rust/sessions/src/default_project.rs`), so with root
  `/private/var/folders/…/ws` and a Paseo directory `/var/folders/…/ws/new`
  that does not exist yet, `relative()` gives `../../../var/…` and the
  directory is reported outside its workspace. Discovery
  (`server/daemon.ts:301`) then says no daemon serves it and sessions/boards
  (`servingWorkspace`) pick the wrong workspace.
- An `EACCES`/`ELOOP` from realpath is swallowed the same way.
- The FSPEC-015 symlink scenario only exercises two existing paths
  (`test/daemon-workspace-guard.test.ts:73-93` hands the fake daemon
  `realpathSync(real)`), so the missing-path case was never covered.

## Fix

`canonicalPath` resolves the path, then realpaths it; when realpath reports
`ENOENT` or `ENOTDIR` (the path does not exist), it canonicalises the parent
the same way and appends the missing segment. Both arguments of `within`
therefore always go through the same rule: the real path of the deepest
existing ancestor plus the not-yet-existing remainder. Any other realpath
error throws `cannot resolve <path>: <reason>`.

## Alternatives rejected

- Resolve both paths without realpath: symlinked spellings of existing
  workspaces would stop matching (FSPEC-015).
- Treat a missing directory as outside every workspace: the daemon creates
  sessions in directories Paseo has not created yet only through
  `create_session_in_workspace`, which then rejects it with its own reason;
  guessing "outside" would route it to the wrong workspace instead.
- Keep swallowing other realpath errors: a guess.
