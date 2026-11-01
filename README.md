# fspec for Paseo

A [Paseo](https://paseo.sh) plugin that lets you run fspec agent sessions from Paseo and see the live fspec Kanban board inside a Paseo workspace.

The plugin is an ordinary client of a running **fspec daemon**. It doesn't start a second agent runtime, shell out to the `fspec` CLI, or poll. It connects to the daemon over the same WebSocket RPC protocol the fspec TUI uses, so a session started from Paseo is a real fspec session. The fspec TUI sees it, it shows on the fspec board, and it keeps its history after Paseo closes.

```
┌──────────── Paseo app (desktop / web / phone) ────────────┐
│  Agent timeline   ·   Model picker   ·   fspec board panel │
└──────────────────────────────┬─────────────────────────────┘
                               │ Paseo protocol
┌──────────────────────────────┴─────────────────────────────┐
│ Paseo daemon                                               │
│   └─ plugin subprocess: fspec-paseo-provider               │
│        index.server.ts  → "fspec" provider + board RPCs    │
│        index.client.tsx → board panel, /board, buttons     │
└──────────────────────────────┬─────────────────────────────┘
                               │ ws://127.0.0.1:<port>/  (bincode + tarpc frames)
┌──────────────────────────────┴─────────────────────────────┐
│ fspec daemon  (fspec daemon  |  fspec with TUI)            │
│   workspaces · sessions · work units · checkpoints         │
└────────────────────────────────────────────────────────────┘
```

## What you get

**An `fspec` agent provider in Paseo**

- **Models:** the model picker lists every model from every *reachable* provider configured in fspec, as `provider/model`. The default is fspec's own default model, the one the fspec TUI sets; when fspec's default isn't listed, the picker has no default. An agent opened without a model gets fspec's default. fspec starts every session on its default model, so with no fspec default an agent can't open: the plugin says so and never sets fspec's default for you (set it under **Default model** on the providers screen or in the TUI). A resumed agent keeps its own model unless you pick one, and resetting an agent's model applies fspec's current default. Thinking levels are Off / Low / Medium / High.
- **Live timeline:** streaming assistant text, reasoning, tool calls with their results and progress, notices, errors, compaction, and token/context usage.
- **Steer, queue and stop:** a prompt you send while a turn is running is queued by fspec and runs as its own turn, in order. Steering it instead (Paseo's steer) joins the running turn: fspec reads it at the next safe point, after the pending tool results and before its next model request. A steer the turn never reached runs as a turn of its own when the turn finishes. **Stop** interrupts the running turn; prompts queued behind it are kept, and a notice lists them. They run, in order, before the next prompt you send.
- **Approvals and questions:** fspec approval pauses and HITL (human-in-the-loop) questions appear as Paseo permission prompts, and so do the ones raised by sub-agents. An approval shows fspec's message and details and is attached to the tool call fspec names as the one it holds back; when fspec names none, the approval stands on its own. A pause the plugin can't read shows as an error notice instead of leaving the agent silently paused. A command waiting on stdin asks you for the input.
- **Agent and Bot modes:** **Agent** (the default) is an ordinary fspec agent. **Bot** starts an fspec orchestrator bot, like the TUI's *New Bot*: it breaks your request into tasks, hands each to a sub-agent through fspec's AgentManager tool, and reports back. Technically, a bot is a session created with fspec's orchestrator role. A resumed or imported session shows as Bot when its role is that bot role, and bots are marked `Bot · ` in the import list. Switching the mode of an open agent sets or clears the role.
- **Sub-agents:** fspec sub-agent sessions appear as child sessions under the parent agent.
- **Composer commands:** `/compact`, `/clear`, `/continue [on|off|N]`, `/goal [text|clear|verify <cmd>]`, `/focus <work-unit-id|none>`. These behave the same as in the fspec TUI.
- **Attachments:** fspec only accepts text, so the plugin saves pasted images to a private temp folder and passes their paths to the agent. Uploaded files are passed by the path Paseo stored them at.
- **Revert:** fspec checkpoints become Paseo revert points and restore the working tree.
- **Resume and import:** Paseo agents reattach to their fspec session after a restart. The plugin resumes the saved session on the daemon first; if fspec can't resume it, opening the agent fails with fspec's reason instead of starting an empty session. A prompt fspec refuses fails its turn with fspec's reason. Paseo's "import session" list shows the daemon's live and saved sessions, and you can search them by prompt text.

**The fspec board as a Paseo workspace panel**

- The columns are backlog, specifying, testing, implementing, validating, done, and blocked, with a story-point summary. The board updates live as the daemon pushes work-unit changes.
- **Every workspace the daemon serves has its board.** A Paseo workspace shows the board of the fspec workspace that holds its directory, whether that's the daemon's start workspace or another one it serves. Only the sessions of that workspace show as focused on its cards. Card details and **Move up** / **Move down** work on every board: they name the board's own workspace to the daemon.
- You can search by id, title, or description.
- **Tapping a card opens its details in a drawer** that slides in from the right over the board. The board stays usable beside it, and tapping another card switches the drawer to that card.
  - The drawer shows the card's full fspec record as formatted sections: description, user story, numbered rules, examples, questions with answers, notes, event storm, relationships, attachments and status history.
  - The card's actions sit at the top of the drawer: **Open in agent**, **Move up** / **Move down**, and **Close**.
  - Tapping a relationship chip (Depends On, Relates To, and so on) opens that work unit in the drawer. The **‹ ›** arrows step back and forward through the units you've visited.
  - Tapping an attachment opens the file in Paseo's file viewer.
  - Close it with **Close**, Android **Back**, or **Escape** on web.
- **Move up / Move down** reorders a card within its column.
- **Open in agent** switches to the fspec agent already focused on that card. If there isn't one, it creates an fspec agent with the default model and runs `/focus <id>` in it.
- To open the board, use the workspace panel tab, the Command Center item **Open fspec board**, or the `/board` slash command. On phones, which don't show plugin panels in the tab menu, use the **fspec board** entry in the workspace `···` menu. That entry only appears for workspaces the fspec daemon serves.

**fspec providers as a Paseo settings screen**

This screen mirrors the fspec TUI's `/provider` view.

- Open it from **Settings → Plugins → fspec for Paseo → fspec providers**, the Command Center item **fspec providers**, or the `/fspec-providers` slash command. On phones it opens full-screen from Settings.
- **One tree, like the TUI.** Each provider header shows its status: `✓ sk-••••abcd [env]` for a key, `✓ OAuth [Claude]` for a sign-in, or `(not configured)`. It also shows `(N profiles)` and the last test result. Tap a header to expand it. You get **Test** and **Refresh models**, then the provider's rows in the TUI's order:
  - **OAuth** providers (Anthropic, Codex, GitHub Copilot):
    - `✓ Logged in [Claude]` opens **Log out**.
    - **Sign in with browser** opens a browser on the computer running fspec.
    - **Sign in with code** shows a link, then you paste the code.
    - **Sign in with device code** shows a code to enter, and waits as long as it takes. Copilot first asks for an optional GitHub Enterprise host.
  - **🔑 API key** for key-based providers: save, test or remove the key. Removing a key that comes from the environment lasts until the daemon restarts, and you're told so.
  - **⚙ Settings**, for every provider: Context Window, Max Output Tokens, Compaction Threshold (`80%` or `200000`), Streaming, Auto-Continue, Preserve Thinking, Max Images, and Loop Detection with its Window, Repeat and Retries. These use the same defaults, hints and validation as the TUI.
  - **📁 profiles** and **+ Add profile**: named endpoints under any provider. Each has a Name, a Base URL, an API key and the same settings. Profiles can be created, edited, renamed or deleted. OpenAI profiles need their own endpoint and key; other providers' profiles inherit authentication.
  - **◆ custom models** and **+ Add model to <profile>**, under each OpenAI profile: models your local server offers that fspec can't discover. The form has the TUI model selector's fields: Model ID, Display Name, Facade, Context Window, Max Output Tokens, Compaction Trigger (`80%` or `200000`), Reasoning and Vision. Models can be added, edited (changing the ID replaces the model) or deleted. fspec doesn't report a saved model's Facade, Max Output Tokens or Compaction Trigger, so editing starts them blank, as in the TUI. Every change shows up in Paseo's fspec model picker. Each write names the profile's base provider as fspec reports it, and anything fspec refuses (a missing profile, an unknown model ID) is shown on the form.
- **Keys and tokens stay off the app.** API keys, profile keys, OAuth tokens and PKCE verifiers never reach it. You see masked keys or "a key is stored", and leaving a key field empty keeps the stored key.
- **Default model:** the **Default model** row at the top lists every reachable model as `provider/model` and shows fspec's current default. Choosing one makes it fspec's default (the same setting the TUI's model selector writes), so new fspec agents start on it.
- **Paseo's fspec model picker updates after every change.** Changes made in the fspec TUI are picked up too.

## Requirements

- **Paseo ≥ 0.13.0** with plugins enabled.
- **fspec** installed, with the daemon running in the project you want to work in. This was developed against fspec 0.10.9 at commit `344d00b4`, which has multi-workspace daemons, `submit_input`, `get_default_model`, per-daemon discovery files and bearer auth. Older daemons lack those RPCs.
- Node.js ≥ 20, but only if you want to run the typecheck or tests. Paseo compiles the plugin's TypeScript itself, so there's no build step.

## Setup

### 1. Set up fspec in your project

From the project root, set fspec up the way you normally would: `fspec bootstrap`, `fspec configure-tools --test-command … --quality-commands …`, and so on. Then configure at least one model provider in fspec, with credentials, so fspec can actually reach it. The plugin has no model configuration of its own. Whatever fspec can reach is what appears in Paseo's model picker. Unreachable providers are hidden.

### 2. Start the fspec daemon in that project

A daemon starts in one directory, its **start workspace**, and can serve other workspaces too: an fspec agent opened from Paseo in another project gets a session in that project's workspace on the same daemon. Start it from a project root, either headless:

```sh
cd ~/projects/my-app
fspec daemon                 # binds 127.0.0.1 on a random port
```

or with the TUI, which runs the same daemon plus a terminal UI in one process:

```sh
cd ~/projects/my-app
fspec
```

Check that it's up:

```sh
fspec status                 # "fspec daemon: alive", uptime, connected clients…
```

On startup every daemon writes its own discovery file, `daemons/<pid>.json`, with its port, pid and start workspace. The plugin reads only those files (never `daemon.json`):

| Condition                     | Location                          |
|-------------------------------|-----------------------------------|
| `XDG_RUNTIME_DIR` set         | `$XDG_RUNTIME_DIR/fspec/daemons/` |
| otherwise                     | `~/.fspec/daemons/`               |

The rule is explicit, with no fallback:

- An fspec agent and a board panel connect to **the one live daemon whose start workspace holds their Paseo directory**. If none does, or more than one does (two daemons in the same project, or nested projects), the connection fails with a message listing every live daemon (pid, workspace, port).
- The providers screen (and a catalog lookup without a directory) serves no directory, so it needs **exactly one live daemon**; with several it fails the same way.
- `FSPEC_DAEMON_URL` (a loopback `ws://` URL) always wins and skips discovery: set it to choose a daemon yourself, for example for a directory outside every daemon's start workspace.
- Entries whose pid is no longer alive are not daemons; fspec removes them.

If the daemon was started with `FSPEC_DAEMON_TOKEN` set, it only accepts clients that send that token. Set the same `FSPEC_DAEMON_TOKEN` in the Paseo daemon's environment, and the plugin sends it as `Authorization: Bearer <token>` on every connection.

To run the daemon under launchd or systemd, `fspec daemon --bind 127.0.0.1:<port>` gives you a fixed port and `--pidfile <path>` writes a pidfile. `--bind` only accepts loopback addresses.

### 3. Install the plugin in Paseo

Plugins have to be enabled in the Paseo daemon config (`~/.paseo/config.json`):

```json
{
  "pluginsEnabled": true
}
```

Then install the plugin. The simplest way is straight from GitHub:

```sh
paseo plugin add git:sengac/fspec-paseo
```

If you want to edit the plugin, install it from a local checkout instead:

```sh
git clone https://github.com/sengac/fspec-paseo.git ~/projects/fspec-paseo
paseo plugin install ~/projects/fspec-paseo
```

A local install adds an entry like this to `~/.paseo/config.json`:

```json
"plugins": {
  "fspec-paseo-provider": {
    "source": "directory",
    "path": "/Users/you/projects/fspec-paseo",
    "enabled": true
  }
}
```

To manage the plugin:

```sh
paseo plugin ls                              # is it installed and enabled?
paseo plugin reload fspec-paseo-provider     # after pulling or editing the code
paseo plugin logs fspec-paseo-provider       # plugin output and errors
paseo plugin disable|enable|remove fspec-paseo-provider
```

### 4. Check that Paseo can see fspec

```sh
paseo provider models fspec                  # should list fspec's models
paseo run --provider fspec --cwd ~/projects/my-app "Summarise the backlog"
```

In the app, **fspec** should now be listed as an agent provider. If it shows as unavailable, its diagnostic says why, for example `no fspec daemon is running — no live entry in ~/.fspec/daemons; start fspec daemon first`. See [Troubleshooting](#troubleshooting).

### 5. Optional: add an fspec agent profile

An agent profile makes fspec a one-click choice in Paseo. You can create it in the app or add it to `daemon.agentProfiles` in `~/.paseo/config.json`:

```json
{
  "daemon": {
    "agentProfiles": [
      {
        "id": "agent_profile_fspec_default",
        "name": "fspec",
        "color": "green",
        "provider": "fspec",
        "thinkingOptionId": "off",
        "notes": "Runs the agent through the local fspec daemon. Model defaults to fspec's default model."
      }
    ]
  }
}
```

If you leave `model` out, the profile uses fspec's default model. To pin a model, set `"model": "<fspec-provider>/<model-id>"` using an id from `paseo provider models fspec`.

If you only want fspec agents, you can turn off the built-in providers under `agents.providers` (for example `"claude": { "enabled": false }`). This is optional.

## Configuration reference

| Setting | Where | Effect |
|---|---|---|
| `FSPEC_DAEMON_URL` | Environment of the **Paseo daemon** | Explicit daemon URL, e.g. `ws://127.0.0.1:41413/`. Skips discovery (`daemons/`) entirely; the way to choose a daemon when several qualify. Must be a loopback host (`127.0.0.1`, `::1`, `localhost`). |
| `FSPEC_DAEMON_TOKEN` | Environment of the **Paseo daemon** | Sent as `Authorization: Bearer <token>` on every connection. Needed when the fspec daemon was started with the same variable. |
| `XDG_RUNTIME_DIR` | Environment of both daemons | Moves `daemons/` (and fspec's `daemon.json`) to `$XDG_RUNTIME_DIR/fspec/`. Paseo and fspec must agree on this. |
| `pluginsEnabled` | `~/.paseo/config.json` | Must be `true` for the plugin to load. |
| fspec model providers | fspec | Determines which models Paseo can pick from. |

The plugin runs inside the Paseo daemon, so it sees the Paseo daemon's environment, not your shell's. If you set `FSPEC_DAEMON_URL` or `FSPEC_DAEMON_TOKEN`, restart the Paseo daemon after changing it.

## How it works

### Workspaces

One fspec daemon can serve several workspaces (`list_workspaces`). Each fspec agent runs in the workspace of its Paseo working directory, so it never silently edits a different project:

- A directory inside the daemon's **start workspace** gets an ordinary session there (`create_session_checked`).
- A directory inside another workspace the daemon already serves gets a session in that workspace. The deepest match wins, so a project inside the start workspace keeps its own workspace.
- Any other directory becomes a new workspace: the daemon opens it and creates the session there (`create_session_in_workspace`). If the daemon refuses, the open fails with its reason, for example `fspec could not create a session in /gone: workspace path is not a directory: /gone`.

Paseo's import list shows the sessions of the served workspace that holds the directory, and nothing for a directory no workspace holds. Listing never opens a workspace.

Several local daemons can run at once. Each agent and board panel uses the daemon serving its directory (see [Start the fspec daemon](#2-start-the-fspec-daemon-in-that-project)). `FSPEC_DAEMON_URL` pins every connection to one daemon.

### Connection lifecycle

- **Availability** (`status()`) checks `FSPEC_DAEMON_URL` when set, otherwise that at least one live `daemons/` entry exists; it picks no daemon and never opens a socket.
- **Connections:** each Paseo provider connection opens its own WebSocket to `ws://127.0.0.1:<port>/`, the full surface with server push. It waits for the daemon's two handshake frames (`WorkUnitsUpdate`, then `SessionSnapshot`) and then sends tarpc requests over it. Live output comes from the daemon's pushed stream chunks and session events, not from polling.
- **Sessions:** `session.open` creates a daemon session, or reattaches to the one saved in Paseo's persistence. It then applies the model and thinking level. Each prompt becomes `send_input`, and each turn is settled exactly once from the daemon's terminal chunk (done, error, or interrupted).
- **Teardown:** if the daemon goes away (for example it shuts down with close 1001), every open turn fails with a clear reason. When Paseo closes the connection or unloads the plugin, the plugin destroys the daemon sessions it owns and then closes the socket.
- **Board:** the board uses its own daemon connection. Paseo has no server-to-UI push, so the panel long-polls a `watch` RPC that the server holds for up to 20 s, which is under Paseo's 30 s plugin RPC timeout. It returns early as soon as the daemon pushes a change.

### Wire protocol

The daemon speaks **bincode 1.x** (fixed-width little-endian integers, u64 length prefixes) carrying **tarpc 0.34** request and response messages inside fspec's own WebSocket `Envelope` frames. All of the encoding and decoding lives in `server/bincode.ts` and `server/wire.ts`. It's checked against golden vectors generated from the Rust source (`test/golden/`). The full format is documented in [`docs/fspec-wire-protocol.md`](docs/fspec-wire-protocol.md).

## Project layout

```
paseo-plugin.json        Plugin manifest (id fspec-paseo-provider, Paseo >= 0.13.0)
index.server.ts          Server entry: registers the "fspec" provider and board RPCs
index.client.tsx         Client entry: board panel, Command Center item, /board, header buttons
icon.svg                 Provider icon

server/
  provider.ts            Provider registration, capability negotiation, input dispatch
  daemon.ts              Daemon discovery (daemons/, FSPEC_DAEMON_URL), loopback rule,
                         bearer token, socket, RPC
  session.ts             Paseo session ↔ daemon session: open/resume, prompts, steer/queue, turns, stop,
                         permissions, sub-agents, revert, import list, commands, modes
  workspaces.ts          Which served workspace holds a directory
  bot.ts                 fspec's orchestrator bot role and the agent/bot modes
  transcript.ts          Stream chunks → Paseo timeline items, usage
  transcript-json.ts     Replay of persisted transcripts
  interactions.ts        Approval pauses / HITL questions ↔ Paseo permission requests
  commands.ts            /compact /clear /continue /goal /focus
  attachments.ts         Images and uploaded files → paths in the prompt text
  catalog.ts             list_providers → Paseo model picker
  board.ts               Live board feeds per daemon and workspace: watch, details, move, availability
  settings.ts, oauth.ts  fspec providers screen feed: credentials, settings, profiles, custom models,
                         default model, OAuth
  bincode.ts, wire.ts    The fspec wire codec

shared/                  RPC schemas shared by server and client (board, settings)
client/                  Board panel and providers screen UI (React Native) and their pure models

docs/                    Reference: fspec wire protocol, Paseo provider contract
spec/                    fspec specs for this project (features, work units, foundation)
test/                    Vitest suites, a fake daemon, and golden wire vectors
```

## Development

```sh
npm install
npm run typecheck        # server + client tsconfigs
npm test                 # vitest; runs against a fake daemon, no real fspec needed
```

To try a change live, run `paseo plugin reload fspec-paseo-provider` after editing, and check `paseo plugin logs fspec-paseo-provider` for errors.

This project is itself built with fspec. Every feature has a work unit and a Gherkin feature file under `spec/features/`, and each source file names the feature it implements in its header comment.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| fspec provider unavailable: `no fspec daemon is running — no live entry in …` | No daemon is running. Run `fspec daemon` (or `fspec`) in the project. |
| `no fspec daemon serves X — the live daemons are …` | No running daemon's start workspace holds X. Start fspec in X, or set `FSPEC_DAEMON_URL` to the daemon you want. |
| `N fspec daemons serve X — …` / `N fspec daemons are running and this connection serves no directory — …` | More than one daemon qualifies, and the plugin never picks one for you. Stop all but one, or set `FSPEC_DAEMON_URL`. |
| `fspec could not create a session in X: …` | The daemon could not open X as a workspace, or could not create the session there. The reason follows the colon. |
| `the fspec daemon serves X, not Y` (board) | No workspace the daemon serves holds Y. Open an fspec agent in Y (the daemon then serves it), or start fspec there. |
| `fspec daemon list_workspaces failed: …` | The daemon could not list the workspaces it serves (for example its workspace registry is unreadable). The board and new agents need that list; fix the reason after the colon. |
| No models in the picker | fspec has no reachable model provider. Fix the provider config or credentials in fspec. |
| `non-loopback daemon host …` | `FSPEC_DAEMON_URL` points at a non-loopback host. Only loopback is supported. The daemon's bearer token is not a substitute for TLS. |
| `… could not be established — …FSPEC_DAEMON_TOKEN…` | The daemon is down, or it requires a token the Paseo daemon doesn't send or doesn't match. Set `FSPEC_DAEMON_TOKEN` for the Paseo daemon and restart it. |
| No fspec board button on phone | No workspace the running daemon serves holds the workspace's directory. |
| Board shows "Reconnecting: …" | The daemon restarted or went away. The panel recovers once the daemon is back. |
| Plugin doesn't load at all | Check `pluginsEnabled: true`, `paseo plugin ls`, and `paseo plugin logs fspec-paseo-provider`. |
