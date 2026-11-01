@done
@core
@provider
@FSPEC-054
Feature: Find the right local fspec daemon and authenticate to it

  """
  server/daemon.ts: liveDaemonEntries(dir) reads daemons/*.json (fspec rust/fspec/src/common/daemon_registry.rs list_live_daemons; the plugin ignores dead entries instead of deleting them, leaving that to fspec), resolveTarget picks entry/daemon.json/lowest pid with a workspace hint set by preferWorkspace(cwd) (first one wins, before the first connect); openSocket(url, { headers }) with Authorization from FSPEC_DAEMON_TOKEN (fspec rust/rpc/src/auth_token.rs, rpc-server/src/client/connect.rs); the default transport passes headers to Node's undici WebSocket. server/provider.ts dispatch hints the daemon client. server/board.ts createBoardFeed routes each cwd to a per-daemon board feed pinned with connectUrl. daemon.json now names one live daemon and is never overwritten by a second one (BUG-289), so it is the right fallback.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. Every local daemon advertises itself in daemons/<pid>.json beside daemon.json ($XDG_RUNTIME_DIR/fspec/daemons or ~/.fspec/daemons, daemon.json schema: port, pid, workspace, started_at, version); entries that cannot be read or whose pid is not alive are ignored
  #   2. A daemon client is bound to the daemon chosen for the first Paseo directory it serves: the live entry whose workspace holds the directory (deepest match), else the live daemon daemon.json names, else the live entry with the lowest pid; FSPEC_DAEMON_URL still wins over all of them and the availability probe uses the same order without a directory
  #   3. The provider connection hints its client with the directory of the first catalog, sessions or session.open input that carries one; the board picks a daemon for each panel directory the same way, one board connection per daemon
  #   4. With neither a live daemon.json nor a live entry, discovery reports the same diagnostics as before (missing or stale daemon.json, which is still removed when its pid is dead)
  #   5. When FSPEC_DAEMON_TOKEN is set (non-empty) in the Paseo daemon's environment, every WebSocket upgrade carries 'Authorization: Bearer <token>'; without it no Authorization header is sent; a daemon armed with a token answers a missing or wrong bearer with HTTP 401 (fspec RPC-447)
  #   6. The loopback-only rule is unchanged: a discovered port is always dialled on 127.0.0.1 and FSPEC_DAEMON_URL must name a loopback host; a failed connect names FSPEC_DAEMON_TOKEN as something to check
  #
  # EXAMPLES:
  #   1. daemon.json names pid 100 (workspace /a, port 4100); daemons/200.json is live with workspace /b, port 4200; an agent opens in /b/web -> the provider connects to ws://127.0.0.1:4200/
  #   2. Same files, agent in /c -> ws://127.0.0.1:4100/ (daemon.json)
  #   3. No daemon.json; daemons/111.json (dead pid, workspace /p) and daemons/222.json (live, workspace /other) -> directory /p connects to 222's port
  #   4. FSPEC_DAEMON_TOKEN=s3cret -> the socket is opened with headers { Authorization: 'Bearer s3cret' }
  #
  # ========================================

  Background: User Story
    As a Paseo user running more than one fspec daemon, possibly token-protected
    I want to have the plugin find the daemon serving my project and authenticate to it
    So that agents and boards reach the right daemon without FSPEC_DAEMON_URL, and protected daemons accept the plugin

  Scenario: The daemon serving the Paseo directory is preferred over daemon.json
    Given daemon.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
    When a daemon client hinted with "/b/web" resolves its target
    Then it targets "ws://127.0.0.1:4200/"

  Scenario: Without a daemon serving the directory the client uses daemon.json
    Given daemon.json names a live daemon in "/a" on port 4100 and daemons/200.json a live daemon in "/b" on port 4200
    When a daemon client hinted with "/c" resolves its target
    Then it targets "ws://127.0.0.1:4100/"

  Scenario: Dead daemon entries are ignored
    Given no daemon.json, daemons/111.json for a dead daemon in "/p" on port 4111 and daemons/222.json for a live daemon in "/other" on port 4222
    When a daemon client hinted with "/p" resolves its target
    Then it targets "ws://127.0.0.1:4222/"

  Scenario: An fspec agent connects to the daemon serving its directory
    Given daemon.json names a live daemon in "/a" and daemons/200.json a live daemon in "/b"
    When Paseo opens an fspec agent in "/b"
    Then the provider's socket was opened to the daemon in "/b" and the session was created there

  Scenario: Each board panel reaches the daemon serving its directory
    Given daemon.json names a live daemon in "/a" and daemons/200.json a live daemon in "/b"
    When board panels watch "/a" and "/b"
    Then the board of "/a" comes from the daemon in "/a" and the board of "/b" from the daemon in "/b"

  Scenario: A configured token is sent as a bearer header
    Given FSPEC_DAEMON_TOKEN is "s3cret" in the Paseo daemon's environment
    When the daemon client connects
    Then the WebSocket was opened with the header "Authorization: Bearer s3cret"

  Scenario: Without a token no Authorization header is sent
    Given FSPEC_DAEMON_TOKEN is not set
    When the daemon client connects
    Then the WebSocket was opened without an Authorization header
