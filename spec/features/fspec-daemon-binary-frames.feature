@done
@core
@provider
@FSPEC-008
Feature: Receive daemon frames as ArrayBuffer on the default WebSocket

  """
  server/daemon.ts default openSocket sets binaryType; onMessage accepts Blob via arrayBuffer().
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. The default socket factory sets binaryType = 'arraybuffer' before any frame can arrive, so every binary daemon frame reaches the codec as an ArrayBuffer
  #   2. A binary frame delivered as a Blob (a transport that ignores binaryType) is still decoded, not silently dropped
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

