import type { BoardUnit } from "../shared/board.js";

/**
 * A work unit's full record as the details drawer lays it out (FSPEC-048):
 * typed blocks in the fspec TUI's section order (details-model.ts SECTIONS),
 * deleted items dropped and empty blocks omitted. Pure.
 */
export type Block =
  | { kind: "text"; title: string; text: string }
  | { kind: "userStory"; title: string; rows: Array<{ label: string; text: string }> }
  | { kind: "numbered"; title: string; items: string[] }
  | { kind: "list"; title: string; items: string[] }
  | { kind: "questions"; title: string; items: Array<{ text: string; answer: string | null }> }
  | { kind: "storm"; title: string; groups: Array<{ title: string; items: string[] }> }
  | { kind: "links"; title: string; groups: Array<{ label: string; ids: string[] }> }
  | { kind: "attachments"; title: string; items: string[] }
  | { kind: "history"; title: string; items: Array<{ state: string; at: string }> }
  | { kind: "fields"; title: string; rows: Array<{ label: string; value: string }> };

/** `dependsOn` -> `Depends On`, `bounded_context` -> `Bounded Context`. */
export function humanize(key: string): string {
  const words: string[] = [];
  let current = "";
  let previousLower = false;
  for (const character of key) {
    if (character === "_" || character === "-" || character === " ") {
      words.push(current);
      current = "";
      previousLower = false;
      continue;
    }
    const upper = character !== character.toLowerCase();
    if (upper && previousLower) {
      words.push(current);
      current = "";
    }
    previousLower = character !== character.toUpperCase() || /[0-9]/.test(character);
    current += character;
  }
  words.push(current);
  return words
    .filter((word) => word !== "")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

export type DrawerActionId = "openInAgent" | "moveUp" | "moveDown" | "close";

/** On Android the app is edge-to-edge and plugins cannot read insets: reserve the 3-button bar. */
export const ANDROID_BOTTOM_INSET = 48;

const HEADER_FIELDS = ["id", "title", "type", "status", "epic", "estimate"];
/** fspec's id counters: bookkeeping, not details. */
const COUNTERS = ["nextRuleId", "nextExampleId", "nextQuestionId", "nextNoteId", "nextAssumptionId"];
const LINK_FIELDS = ["parent", "children", "dependsOn", "blocks", "blockedBy", "relatesTo"];
const LISTS: Array<[string, string, "numbered" | "list"]> = [
  ["rules", "Rules", "numbered"],
  ["examples", "Examples", "list"],
];
const NOTES: Array<[string, string]> = [
  ["assumptions", "Assumptions"],
  ["architectureNotes", "Architecture Notes"],
];
const STORM_GROUPS: Array<[string, string]> = [
  ["event", "Domain Events"],
  ["command", "Commands"],
  ["policy", "Policies"],
  ["hotspot", "Hotspots"],
  ["aggregate", "Aggregates"],
  ["bounded_context", "Bounded Contexts"],
  ["external_system", "External Systems"],
];
const HISTORY_FIELDS = ["stateHistory", "statusHistory"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Any value as one readable string (lossless for nested data). */
function show(value: unknown): string {
  return scalar(value) ?? (value === null ? "—" : JSON.stringify(value));
}

/** The live entries of a list: deleted items dropped. */
function live(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((entry) => !(isRecord(entry) && entry.deleted === true)) : [];
}

function itemText(entry: unknown): string {
  if (isRecord(entry) && typeof entry.text === "string") return entry.text;
  return show(entry);
}

function stormItem(entry: unknown): string {
  if (!isRecord(entry)) return show(entry);
  const extra = Object.entries(entry)
    .filter(([key, value]) => !["type", "text", "id", "deleted", "createdAt"].includes(key) && scalar(value) !== null)
    .map(([key, value]) => `${humanize(key)}: ${scalar(value)}`);
  const text = typeof entry.text === "string" ? entry.text : "";
  return extra.length === 0 ? text : `${text} — ${extra.join(", ")}`;
}

export function documentFor(record: Record<string, unknown>): Block[] {
  const blocks: Block[] = [];
  const used = new Set([...HEADER_FIELDS, ...COUNTERS]);
  const take = (key: string) => {
    used.add(key);
    return record[key];
  };

  const description = take("description");
  if (typeof description === "string" && description.trim() !== "") {
    blocks.push({ kind: "text", title: "Description", text: description });
  }

  const story = take("userStory");
  if (isRecord(story)) {
    const rows = [
      { label: "As a", text: scalar(story.role) ?? "" },
      { label: "I want", text: scalar(story.action) ?? "" },
      { label: "So that", text: scalar(story.benefit) ?? "" },
    ].filter((row) => row.text !== "");
    if (rows.length > 0) blocks.push({ kind: "userStory", title: "User Story", rows });
  }

  for (const [key, title, kind] of LISTS) {
    const items = live(take(key)).map(itemText);
    if (items.length > 0) blocks.push({ kind, title, items });
  }

  const questions = live(take("questions")).map((entry) => ({
    text: itemText(entry),
    answer: isRecord(entry) && scalar(entry.answer) !== null ? scalar(entry.answer) : null,
  }));
  if (questions.length > 0) blocks.push({ kind: "questions", title: "Questions", items: questions });

  for (const [key, title] of NOTES) {
    const items = live(take(key)).map(itemText);
    if (items.length > 0) blocks.push({ kind: "list", title, items });
  }

  const storm = take("eventStorm");
  if (isRecord(storm)) {
    const items = live(storm.items);
    const typeOf = (entry: unknown) => (isRecord(entry) && typeof entry.type === "string" ? entry.type : null);
    const groups = STORM_GROUPS.map(([kind, title]) => ({
      title,
      items: items.filter((entry) => typeOf(entry) === kind).map(stormItem),
    }));
    const other = items.filter((entry) => !STORM_GROUPS.some(([kind]) => typeOf(entry) === kind)).map(stormItem);
    if (other.length > 0) groups.push({ title: "Other Items", items: other });
    const shown = groups.filter((group) => group.items.length > 0);
    if (shown.length > 0) blocks.push({ kind: "storm", title: "Event Storm", groups: shown });
  }

  const links = LINK_FIELDS.map((key) => {
    const value = take(key);
    const ids = (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).filter(
      (id): id is string => typeof id === "string",
    );
    return { label: humanize(key), ids };
  }).filter((group) => group.ids.length > 0);
  if (links.length > 0) blocks.push({ kind: "links", title: "Relationships", groups: links });

  const attachments = take("attachments");
  if (Array.isArray(attachments) && attachments.length > 0) {
    blocks.push({ kind: "attachments", title: "Attachments", items: attachments.map(show) });
  }

  for (const key of HISTORY_FIELDS) {
    const items = live(take(key))
      .filter(isRecord)
      .map((entry) => ({ state: show(entry.state ?? entry.status), at: show(entry.timestamp ?? entry.at) }));
    if (items.length > 0) blocks.push({ kind: "history", title: "History", items });
  }

  const rows = Object.entries(record)
    .filter(([key, value]) => !used.has(key) && value !== undefined)
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => ({ label: humanize(key), value: show(value) }));
  if (rows.length > 0) blocks.push({ kind: "fields", title: "Details", rows });

  return blocks;
}

/**
 * An attachment as a Markdown link to its absolute path, which Paseo's
 * workspace file-link resolver opens in its file viewer. Angle brackets keep
 * paths with spaces intact.
 */
export function attachmentLink(workspace: string, path: string): { name: string; folder: string; markdown: string } {
  const absolute = path.startsWith("/") ? path : `${workspace.replace(/\/+$/, "")}/${path}`;
  const slash = path.lastIndexOf("/");
  const name = slash < 0 ? path : path.slice(slash + 1);
  const folder = slash < 0 ? "" : path.slice(0, slash).replace(/^\//, "");
  return { name, folder, markdown: `[${name.replace(/([\[\]])/g, "\\$1")}](<${absolute}>)` };
}

/** The drawer's title and chips: from the board snapshot, refined by the full record once loaded. */
export function drawerHeader(unit: BoardUnit, record: Record<string, unknown> | null): { title: string; chips: string[] } {
  const title = scalar(record?.title) ?? unit.title;
  const estimate = record !== null && typeof record.estimate === "number" ? record.estimate : unit.estimate;
  const chips = [
    scalar(record?.type) ?? unit.workType,
    scalar(record?.status) ?? unit.status,
    scalar(record?.epic) ?? unit.epic,
    estimate === null || estimate === undefined ? null : `${estimate} pts`,
  ].filter((chip): chip is string => chip !== null && chip !== "");
  return { title: `${unit.id} — ${title}`, chips };
}

/** The card's actions at the top of the drawer; done cards cannot be reordered. */
export function drawerActions(unit: BoardUnit, canOpenAgent: boolean): Array<{ id: DrawerActionId; label: string }> {
  const actions: Array<{ id: DrawerActionId; label: string }> = [];
  if (canOpenAgent) actions.push({ id: "openInAgent", label: "Open in agent" });
  if (unit.status !== "done") actions.push({ id: "moveUp", label: "Move up" }, { id: "moveDown", label: "Move down" });
  actions.push({ id: "close", label: "Close" });
  return actions;
}

/** 88% of the board (at most 480) when compact; otherwise 45%, between 360 and 560. */
export function drawerWidth(boardWidth: number, compact: boolean): number {
  if (compact) return Math.min(480, Math.round(boardWidth * 0.88));
  return Math.min(560, Math.max(360, Math.round(boardWidth * 0.45)));
}

export function bottomInset(platform: "ios" | "android" | "web"): number {
  return platform === "android" ? ANDROID_BOTTOM_INSET : 0;
}

/**
 * The work units the drawer showed, like a browser history: selecting a card
 * starts a new history, following a relationship adds after the current entry
 * (dropping forward entries), back and forward move within it.
 */
export interface DrawerState {
  history: string[];
  index: number;
}
export type DrawerEvent =
  | { type: "select"; id: string }
  | { type: "follow"; id: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "close" };

export const EMPTY_DRAWER: DrawerState = { history: [], index: -1 };

export function drawerReducer(state: DrawerState, event: DrawerEvent): DrawerState {
  switch (event.type) {
    case "select":
      return { history: [event.id], index: 0 };
    case "follow": {
      if (currentId(state) === event.id) return state;
      const history = [...state.history.slice(0, state.index + 1), event.id];
      return { history, index: history.length - 1 };
    }
    case "back":
      return canGoBack(state) ? { ...state, index: state.index - 1 } : state;
    case "forward":
      return canGoForward(state) ? { ...state, index: state.index + 1 } : state;
    case "close":
      return EMPTY_DRAWER;
  }
}

export function currentId(state: DrawerState): string | null {
  return state.history[state.index] ?? null;
}

export function canGoBack(state: DrawerState): boolean {
  return state.index > 0;
}

export function canGoForward(state: DrawerState): boolean {
  return state.index >= 0 && state.index < state.history.length - 1;
}
