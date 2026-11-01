@done
@core
@provider
@FSPEC-054
@FSPEC-060
Feature: Find the right local fspec daemon and authenticate to it
  """
  server/daemon.ts: liveEntries reads daemons/*.json (fspec rust/fspec/src/common/daemon_registry.rs list_live_daemons; the plugin ignores dead and unreadable entries instead of deleting them, leaving that to fspec). FSPEC-060: resolveTarget takes the explicit connect URL (connectUrl or FSPEC_DAEMON_URL), else exactly one qualifying live entry: the entries whose workspace holds the bound directory (bindDirectory or the directory option, first one wins), or every live entry for a client bound to no directory; none or several fail naming every live daemon. daemon.json is never read: every daemon it can name also has a daemons/ entry (BUG-289). The workspace registry (rust/common/src/workspace_registry.rs) is shared by every daemon of one data directory and records each one's start workspace, so it cannot tell daemons apart. status() is available when at least one live daemon exists. openSocket(url, { headers }) carries Authorization from FSPEC_DAEMON_TOKEN (fspec rust/rpc/src/auth_token.rs). server/provider.ts binds the first input directory and the catalog cache key's cwd; server/board.ts binds each panel directory and keeps a failed directory's reason.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Every local daemon advertises itself in daemons/<pid>.json beside daemon.json ($XDG_RUNTIME_DIR/fspec/daemons or ~/.fspec/daemons, daemon.json schema: port, pid, workspace, started_at, version); entries that cannot be read or whose pid is not alive are not daemons
  #   2. FSPEC-060: an explicit connect URL wins; otherwise a client bound to a Paseo directory uses the one live daemon whose workspace holds it, and a client bound to no directory uses the one live daemon; none or several fail the connection naming every live daemon (pid, workspace, port) and the way out; daemon.json is never read
  #   3. The provider connection binds the directory of the first catalog, sessions or session.open input that carries one, and the catalog cache key binds Paseo's cwd; the board binds each panel directory, one board connection per daemon, and a panel no daemon serves reports why
  #   4. The provider's status() is available when an explicit URL is valid or at least one live daemon exists; it chooses no daemon
  #   5. When FSPEC_DAEMON_TOKEN is set (non-empty) in the Paseo daemon's environment, every WebSocket upgrade carries 'Authorization: Bearer <token>'; without it no Authorization header is sent; a daemon armed with a token answers a missing or wrong bearer with HTTP 401 (fspec RPC-447)
  #   6. The loopback-only rule is unchanged: a discovered port is always dialled on 127.0.0.1 and FSPEC_DAEMON_URL must name a loopback host; a failed connect names FSPEC_DAEMON_TOKEN as something to check
  #
  # EXAMPLES:
  #   1. daemons/100.json (/a, 4100) and daemons/200.json (/b, 4200); directory /b/web -> ws://127.0.0.1:4200/
  #   2. Same entries, directory /c -> 'no fspec daemon serves /c — the live daemons are pid 100 in /a (port 4100), pid 200 in /b (port 4200); start fspec in /c, or set FSPEC_DAEMON_URL to choose a daemon'
  #   3. daemons/111.json (dead, /p) and daemons/222.json (live, /other); directory /p -> 'no fspec daemon serves /p — the live daemons are pid 222 in /other (port 4222); …'
  #   4. daemons/100.json (/a) and daemons/300.json (/a/b); directory /a/b/c -> '2 fspec daemons serve /a/b/c — pid 100 in /a (port 4100), pid 300 in /a/b (port 4300); stop all but one, or set FSPEC_DAEMON_URL to choose one'
  #   5. Settings (no directory) with daemons /a and /b -> '2 fspec daemons are running and this connection serves no directory — …; set FSPEC_DAEMON_URL to choose one'
  #   6. FSPEC_DAEMON_TOKEN=s3cret -> the socket is opened with headers { Authorization: 'Bearer s3cret' }
  #
  # ========================================
  Background: User Story
    As a Paseo user running more than one fspec daemon, possibly token-protected
    I want to have the plugin find the daemon serving my project and authenticate to it
    So that agents and boards reach the right daemon without FSPEC_DAEMON_URL, and protected daemons accept the plugin

  Scenario: The daemon whose workspace holds the directory is used
    Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
    When a daemon client bound to "/b/web" resolves its target
    Then it targets "ws://127.0.0.1:4200/"

  Scenario: A directory no daemon serves fails naming the live daemons
    Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
    When a daemon client bound to "/c" resolves its target
    Then it fails with "no fspec daemon serves /c — the live daemons are pid 100 in /a (port 4100), pid 200 in /b (port 4200); start fspec in /c, or set FSPEC_DAEMON_URL to choose a daemon"

  Scenario: Dead daemon entries never serve a directory
    Given daemons/111.json for a dead daemon in "/p" on port 4111 and daemons/222.json for a live daemon in "/other" on port 4222
    When a daemon client bound to "/p" resolves its target
    Then it fails with "no fspec daemon serves /p — the live daemons are pid 222 in /other (port 4222); start fspec in /p, or set FSPEC_DAEMON_URL to choose a daemon"

  Scenario: Several daemons serving the directory fail naming them
    Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/300.json a live daemon in "/a/b" on port 4300
    When a daemon client bound to "/a/b/c" resolves its target
    Then it fails with "2 fspec daemons serve /a/b/c — pid 100 in /a (port 4100), pid 300 in /a/b (port 4300); stop all but one, or set FSPEC_DAEMON_URL to choose one"

  Scenario: A connection bound to no directory needs exactly one daemon
    Given daemons/100.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
    When the settings feed lists providers, and later only the daemon in "/a" is live
    Then the first list is unavailable with "2 fspec daemons are running and this connection serves no directory — pid 100 in /a (port 4100), pid 200 in /b (port 4200); set FSPEC_DAEMON_URL to choose one"
    And the second list comes from the daemon in "/a"
    And the provider's status is available while either daemon is live

  Scenario: An fspec agent connects to the daemon serving its directory
    Given daemons/100.json names a live daemon in "/a" and daemons/200.json a live daemon in "/b"
    When Paseo opens an fspec agent in "/b"
    Then the provider's socket was opened to the daemon in "/b" and the session was created there

  Scenario: Each board panel reaches the daemon serving its directory
    Given daemons/100.json names a live daemon in "/a" and daemons/200.json a live daemon in "/b"
    When board panels watch "/a", "/b" and "/c"
    Then the board of "/a" comes from the daemon in "/a" and the board of "/b" from the daemon in "/b"
    And the board of "/c" is unavailable with "no fspec daemon serves /c — the live daemons are pid 100 in /a (port 4100), pid 200 in /b (port 4200); start fspec in /c, or set FSPEC_DAEMON_URL to choose a daemon"

  Scenario: A configured token is sent as a bearer header
    Given FSPEC_DAEMON_TOKEN is "s3cret" in the Paseo daemon's environment
    When the daemon client connects
    Then the WebSocket was opened with the header "Authorization: Bearer s3cret"

  Scenario: Without a token no Authorization header is sent
    Given FSPEC_DAEMON_TOKEN is not set
    When the daemon client connects
    Then the WebSocket was opened without an Authorization header
