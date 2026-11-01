# FSPEC-064 root cause: undecodable frames are ignored and a port-less URL dials 80/443

## Problem

- `onFrame` (`server/daemon.ts:420-445`) swallows a `decodeEnvelope` failure
  ("a frame we cannot decode never breaks the connection here") and an Rpc
  envelope whose `decodeResponseFrame` fails ("ignore undecodable rpc
  frames"). The request waiting for that response then hangs, and a codec
  out of step with the daemon goes unnoticed.
- Text frames are dropped without a trace (`server/daemon.ts:415-416`,
  `toBytes`).
- An explicit connect URL without a port dials 80, or 443 for `wss:`
  (`server/daemon.ts:325-326`); a `wss:` URL is silently dialled as `ws:`
  and any path is dropped (`server/daemon.ts:327-331`).

## What fspec does

`rust/rpc-server/src/pump.rs:139-145`: a binary frame that does not
bincode-decode as an Envelope is logged (`warn!`) and the connection is
closed. `pump.rs:181-183`: text frames are logged and ignored. fspec's
daemon has no default port (it writes the bound port to its daemons entry).

## Fix

- An undecodable envelope or rpc response frame is a protocol error: logged
  (`[fspec] protocol error …`), the socket is closed and the connection drops
  with reason `protocol error: <envelope|rpc response> frame could not be
  decoded — <decoder message>`. Outstanding requests reject with it and open
  sessions get `session.runtime_failed` with it (the FSPEC-030 lost-connection
  path, which is the user-visible notice); during the handshake the connect
  fails with it.
- A text frame is logged and ignored, as the daemon does.
- An explicit URL must be `ws://<loopback host>:<port>/`: no port fails
  `fspec daemon connect URL <url> names no port — the fspec daemon has no
  default port; use ws://127.0.0.1:<port>/`; another scheme or a path other
  than `/` fails naming the URL.

## Alternatives rejected

- Skip the bad frame and keep the connection: the stream is no longer
  trustworthy and a waiting request never settles.
- Keep dialling 80/443: a guessed port.
