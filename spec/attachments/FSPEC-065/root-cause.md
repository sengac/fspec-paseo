# FSPEC-065 root cause: provider-settings failures disappear

## Problem

- `catalogCacheKey` (`server/provider.ts:77-96`) answers `undefined` for a
  failed `list_provider_credentials` (line 82) and for any thrown error
  (line 92). Paseo then caches the catalog per directory instead of
  reporting anything.
- `runWrite` (`client/settings-actions.ts:38-40`) swallows a failed reload of
  the provider list and a failed Paseo model refresh after a successful
  write: the screen shows stale rows and Paseo's picker misses the change
  with no hint.
- The OAuth sheet's status watch (`client/oauth-sheet.tsx:126-141`) retries
  a failed status RPC every 2 s forever in a bare `catch`; "Copy code"
  swallows a failed copy (line 222); closing the sheet swallows a failed
  cancel (line 161).

## Paseo's handling

A rejected `getCatalogCacheKey` marks the provider snapshot entry
`status: "error"` with the message
(`paseo/packages/server/src/server/agent/provider-snapshot-manager.ts:928-948`).

## Fix

- `catalogCacheKey` rejects with the reason: `fspec daemon
  list_provider_credentials failed: <error>` for the daemon's error,
  otherwise the connection/discovery error itself.
- `runWrite`: after a successful write, a failed reload adds the warning
  `Saved, but the provider list could not be reloaded: <reason>` and a failed
  refresh `Saved, but Paseo's fspec models could not be refreshed: <reason>`,
  joined after the write's own warning.
- OAuth: a failed status poll ends the sign-in as failed with
  `The sign-in status could not be read: <reason>`; a failed copy shows
  `The code could not be copied: <reason>`; a failed cancel on close is
  logged (`console.error`), the sheet being gone.

## Alternatives rejected

- Report a failed refresh as a failed write: the write did happen.
