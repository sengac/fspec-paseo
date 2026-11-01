@done
@provider
@core
@FSPEC-003
@FSPEC-060
Feature: Discover and connect to the fspec daemon
  """
  Client lives in server/daemon.ts on top of the FSPEC-002 codec (server/wire.ts + server/bincode.ts): encode/decode Envelope + tarpc request/response. Target resolution: explicit connect URL (provider config / env FSPEC_DAEMON_URL) wins over discovery of the live daemons/<pid>.json entries ($XDG_RUNTIME_DIR/fspec/daemons else ~/.fspec/daemons; FSPEC-060: daemon.json is no longer read, see fspec-daemon-discovery.feature for which entry serves a directory). Loopback-only (127.0.0.1, ::1, localhost) enforced before any socket. status() is a lightweight probe (resolve + validate, no socket); connect() opens the WebSocket (path /) and completes the handshake (WorkUnitsUpdate + SessionSnapshot) before reporting established.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   0. FSPEC-060 supersedes rules 1, 2 and 9 and examples 1-3 and 6: discovery reads the live daemons/<pid>.json entries (same directory resolution, XDG_RUNTIME_DIR first), never daemon.json; no live entry -> 'no fspec daemon is running — no live entry in <daemons dir>; start fspec daemon first'; dead entries are left for fspec to prune
  #   1. daemon.json autodiscovery resolution order: if env XDG_RUNTIME_DIR is set and non-empty, use $XDG_RUNTIME_DIR/fspec/daemon.json; otherwise ~/.fspec/daemon.json. The daemon writes it atomically after bind; the client shares this exact resolution.
  #   2. daemon.json verification: parse JSON, require `port` (u16) and `pid` (u32); `started_at`/`version`/`workspace` are optional. Probe the pid for liveness (kill(pid,0) on unix, EPERM counts as alive). If the pid is dead, the stale file is DELETED and the error is 'no daemon.json found (stale daemon.json removed at <path>) — start fspec daemon first'. Missing file → 'no daemon.json found at <path> — start fspec daemon first'.
  #   3. Loopback-only: the daemon connection target's host must be exactly 127.0.0.1, ::1, or localhost (bracketed IPv6 allowed). Any other host (e.g. 8.8.8.8, an external hostname) is REJECTED as non-loopback — the plugin never connects to a non-loopback daemon address, because the daemon itself only binds loopback (auth/TLS for external binds is out of scope). This applies to both the explicit connect URL and the port discovered via daemon.json.
  #   4. Connect URL precedence: an explicit connect URL (provider configuration, env FSPEC_DAEMON_URL) bypasses daemon.json autodiscovery entirely. If the URL is set, it wins; only when it is unset/empty does the plugin fall back to daemon.json autodiscovery.
  #   5. Target URL shape: for the standard surface the client connects to ws://127.0.0.1:<port> (path /). The port comes from daemon.json autodiscovery or the explicit connect URL. The client always uses the full surface (path /), never /fspec-read-v2.
  #   6. Connect/handshake: the client opens a WebSocket to the resolved loopback target with path / (full surface). After the WS upgrade the server immediately sends two initial frames — a WorkUnitsUpdate (initial snapshot, may be empty) then a SessionSnapshot (sent even when empty). The connection is considered ESTABLISHED only once BOTH initial frames have been received. An empty SessionSnapshot is valid and distinguishes 'checked, none open' from 'never asked'.
  #   7. Connection-drop handling: if the WebSocket is closed by the server or the network mid-session (including a server Close{code:1001, going_away}), the client transitions to a connection-lost state, tears down all in-flight/outstanding request state, and the provider surfaces it as a connection loss (open sessions are torn down). The client does NOT auto-reconnect: it stays down until status()/connect() is called again and re-resolves the target.
  #   8. Clean shutdown: when Paseo unloads the plugin / calls close(), the client closes the WebSocket connection (sends a Close frame / aborts) and releases ALL state — clears open sessions, disconnects event listeners, and cancels any in-flight request tracking. close() is idempotent (a second call is a no-op that does not throw). No sockets, timers, or listener registrations leak after close().
  #   9. Discovery order (status/connect): (1) explicit connect URL from provider configuration (env FSPEC_DAEMON_URL) — if set and non-empty, use it (after loopback validation) and skip daemon.json entirely; (2) otherwise resolve daemon.json (XDG_RUNTIME_DIR first, then ~/.fspec) and verify port+pid; (3) if neither yields a usable loopback target, report unavailable with a diagnostic naming the missing piece.
  #   10. Availability diagnostic: when status() is unavailable, the diagnostic must be user-actionable and name WHAT is wrong, distinguishing at least: (a) no daemon.json found / no daemon running (point to the resolved path and 'start fspec daemon'), (b) stale daemon.json removed (stale file at <path>), (c) the explicit connect URL is not a loopback address (name the offending host), (d) the daemon was found but the connection attempt failed (e.g. connect refused on 127.0.0.1:<port>). An available:false status ALWAYS carries a non-empty diagnostic.
  #
  # EXAMPLES:
  #   1. daemon.json present and valid (port 41413, pid alive) → discovery yields ws://127.0.0.1:41413/ and a connect() completes the handshake (WS open + WorkUnitsUpdate + SessionSnapshot received), so the connection is established.
  #   2. No daemon.json at the resolved path AND no explicit connect URL → status() reports { available: false } with a diagnostic that says 'no daemon.json found at <resolved path> — start fspec daemon first'.
  #   3. daemon.json exists but its pid is dead (stale) → the file is deleted and status() reports unavailable with a diagnostic saying 'no daemon.json found (stale daemon.json removed at <path>) — start fspec daemon first'.
  #   4. Explicit connect URL (provider config) points at 8.8.8.8:41413 → rejected as a non-loopback target BEFORE any socket is opened; status() reports unavailable with a diagnostic naming the offending host and stating loopback-only (127.0.0.1, ::1, or localhost) is required.
  #   5. Provider configuration sets an explicit connect URL (ws://127.0.0.1:5555) AND a daemon.json exists pointing at a different port → the plugin connects to the explicit URL's port (5555) and ignores daemon.json entirely.
  #   6. Both $XDG_RUNTIME_DIR/fspec/daemon.json and ~/.fspec/daemon.json exist, with XDG set → the XDG_RUNTIME_DIR path wins (port 6001, not the 7001 from ~/.fspec).
  #   7. A daemon closes its connection mid-session (server Close code 1001 going_away) → the client transitions to connection-lost, tears down outstanding request state, and the provider surfaces a connection-lost event; open sessions are torn down. No automatic reconnect until status()/connect() runs again.
  #   8. Paseo unloads the plugin while the daemon connection is open → close() closes the WebSocket, clears open sessions and event listeners, and resolves; calling close() a second time is a no-op that does not throw, and no sockets, timers, or listener registrations leak afterward.
  #
  # ASSUMPTIONS:
  #   1. Design split: status() performs LIGHTWEIGHT discovery+validation only (resolve target, enforce loopback, verify daemon.json pid) and opens NO socket — it is a fast availability probe. connect() performs the real WebSocket open + handshake (WorkUnitsUpdate + SessionSnapshot) and returns the ProviderConnection. Connection failures (case d) surface at connect() time, not status() time.
  #   2. Testability: the daemon client is built on the FSPEC-002 codec public surface (encode/decode Envelope + tarpc request/response from server/wire.ts). It accepts an injectable WebSocket transport (default: Node global WebSocket) so tests can supply a fake/in-memory WS server or stub transport — no real daemon is required to run the suite.
  #
  # ========================================
  Background: User Story
    As a the fspec-paseo developer (and the Paseo user who relies on the plugin)
    I want to attach to a running fspec daemon as a client — discovering it via daemon.json or an explicit connect URL, enforcing loopback-only targets, completing the connect/handshake, and shutting down cleanly when Paseo unloads the plugin
    So that the provider can report truthful daemon availability and later stories (catalog, session lifecycle, transcript) have a real connection to build on

  Scenario: A live daemon entry yields a connected client
    Given daemons/4321.json names a live daemon on port 41413 whose workspace holds the client's directory
    And provider configuration does not set an explicit connect URL
    When the plugin resolves the daemon target and connects
    Then the resolved target is the loopback WebSocket URL from that entry
    And the connection completes the handshake after receiving the initial WorkUnitsUpdate and SessionSnapshot
    And the connection is reported established

  Scenario: No live daemon reports unavailable with an actionable diagnostic
    Given the daemons directory holds no entry
    And provider configuration does not set an explicit connect URL
    When Paseo calls the provider's status()
    Then status reports available false
    And the diagnostic says no fspec daemon is running, names the daemons directory and says to start the fspec daemon

  Scenario: A dead daemon's entry counts as no daemon
    Given daemons/999999.json names a daemon whose pid is dead
    When Paseo calls the provider's status()
    Then status reports available false with the no-daemon diagnostic
    And the entry is left on disk for fspec to prune

  Scenario: A non-loopback connect URL is rejected before any socket opens
    Given provider configuration sets an explicit connect URL pointing at a non-loopback host
    When the plugin resolves the daemon target
    Then the target is rejected as non-loopback before any socket is opened
    And status reports available false
    And the diagnostic names the offending host and says only loopback (127.0.0.1, ::1, or localhost) is allowed

  Scenario: The explicit connect URL wins over discovery
    Given provider configuration sets an explicit connect URL on a different port than the live daemon entry
    And a live daemon entry exists in the daemons directory
    When the plugin resolves the daemon target
    Then the connection target uses the explicit connect URL's port
    And the daemons directory is never read

  Scenario: XDG_RUNTIME_DIR wins over the home directory for daemon entries
    Given both the XDG_RUNTIME_DIR daemons directory (port 6001) and the home directory daemons directory (port 7001) hold a live entry
    And XDG_RUNTIME_DIR is set and non-empty
    When the plugin resolves the daemon target
    Then the resolved entry is under XDG_RUNTIME_DIR
    And the resolved port is 6001

  Scenario: A mid-session connection drop is surfaced as connection lost
    Given the plugin has an established daemon connection
    When the daemon closes the WebSocket mid-session with a going-away close
    Then the client transitions to connection-lost and tears down outstanding request state
    And the provider surfaces a connection-lost event with its open sessions torn down
    And the client does not reconnect on its own

  Scenario: Unloading the plugin closes the daemon connection cleanly
    Given the plugin has an open daemon connection
    When Paseo unloads the plugin and the connection is closed
    Then the WebSocket is closed and open sessions and event listeners are released
    And a second close is a no-op that does not throw
    And no sockets, timers, or listener registrations remain

  Scenario: An unreachable daemon fails the connect with a diagnostic
    Given a valid loopback target was resolved
    When the plugin attempts to connect and the connection is refused
    Then connect fails
    And the failure says the connection to the resolved loopback target could not be established
