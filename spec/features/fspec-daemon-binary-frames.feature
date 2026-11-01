@done
@core
@provider
@FSPEC-008
@FSPEC-064
Feature: Receive daemon frames as ArrayBuffer on the default WebSocket
  """
  server/daemon.ts default openSocket sets binaryType; onMessage accepts Blob via arrayBuffer(). FSPEC-064: onFrame treats an undecodable envelope or rpc response frame as a protocol error (logged, socket closed, connection dropped with the reason, like fspec's rust/rpc-server/src/pump.rs); text frames are logged and ignored.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The default socket factory sets binaryType = 'arraybuffer' before any frame can arrive, so every binary daemon frame reaches the codec as an ArrayBuffer
  #   2. A binary frame delivered as a Blob (a transport that ignores binaryType) is still decoded, not silently dropped
  #   3. FSPEC-064: a binary frame whose Envelope or tarpc response frame does not decode is a protocol error: logged, the socket closed and the connection dropped with reason 'protocol error: <the envelope|an rpc response> frame could not be decoded — <decoder message>'; outstanding requests reject with it, sessions get session.runtime_failed, later frames are not processed; during the handshake connect fails with it
  #   4. FSPEC-064: a text frame is logged and ignored (fspec's pump does the same); a frame of another non-binary type is a protocol error
  #   5. FSPEC-064: a response for a request id nobody waits for is logged
  #
  # EXAMPLES:
  #   1. Against the live fspec 0.10.9 daemon, connect() with the default factory never completed the handshake (frames arrived as Blob and were ignored); with binaryType 'arraybuffer' the handshake completed and list_providers decoded
  #   2. A transport that hands the client a Blob holding the WorkUnitsUpdate and SessionSnapshot frames still completes the handshake
  #
  # ========================================
  Background: User Story
    As a Paseo user with a running fspec daemon
    I want to have the provider connect to the real daemon and receive its frames
    So that the model picker and sessions work outside the test fakes

  Scenario: The default WebSocket receives daemon frames as ArrayBuffer
    Given the daemon client uses its default WebSocket factory
    When it opens the socket to the daemon
    Then the socket's binaryType is "arraybuffer" before any frame arrives
    And the WorkUnitsUpdate and SessionSnapshot handshake completes and a list_providers response decodes

  Scenario: A Blob frame is decoded instead of dropped
    Given a transport that delivers binary daemon frames as Blob
    When the daemon sends the WorkUnitsUpdate and SessionSnapshot handshake frames
    Then the client completes the handshake

  Scenario: An undecodable frame drops the connection as a protocol error
    Given an established daemon connection with a list_providers request in flight
    When the daemon sends a binary frame that is not an Envelope
    Then the request rejects with "protocol error: the envelope frame could not be decoded"
    And the client is connection-lost after one connection-lost event, the socket is closed and the plugin log has the reason

  Scenario: An undecodable rpc response during the handshake fails the connect
    Given a daemon that answers the handshake with an rpc envelope whose response frame does not decode
    When the client connects
    Then connect fails with "protocol error: an rpc response frame could not be decoded"

  Scenario: A session sees a protocol error as a lost runtime
    Given an open Paseo fspec session
    When the daemon sends a binary frame that is not an Envelope
    Then the session gets session.runtime_failed naming the protocol error

  Scenario: Text frames are logged and ignored
    Given an established daemon connection
    When the daemon sends a text frame
    Then the plugin log notes the ignored text frame and the connection stays established
