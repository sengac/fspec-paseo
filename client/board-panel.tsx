import {
  type PluginWorkspacePanelProps,
  usePaseo,
  useRpc,
  useTabState,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { FlatList, Loading, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { z } from "zod";
import { type BoardUnit, moveBoardRpc } from "../shared/board.js";
import {
  type BoardColumn,
  type BoardColumnStatus,
  type SearchMode,
  cardLabel,
  compactColumn,
  groupColumns,
  isBoardColumn,
  latestChange,
  pointsSummary,
  revealCard,
  searchUnits,
} from "./board-model.js";
import {
  bottomInset,
  canGoBack,
  canGoForward,
  currentId,
  type DrawerEvent,
  drawerReducer,
  EMPTY_DRAWER,
} from "./details-document.js";
import { DetailsDrawer } from "./details-drawer.js";
import { type AgentEntry, fspecModels, openInAgent } from "./open-in-agent.js";
import { useBoard } from "./use-board.js";

type Theme = PluginWorkspacePanelProps["theme"];
type Focus = Readonly<Record<string, readonly string[]>>;

const tabSchema = z.object({ column: z.string().nullable(), selected: z.string().nullable() });
const defaultTab = { column: null, selected: null };
const SEARCH_MODES: SearchMode[] = ["id", "title", "description"];
const SEARCH_LIMIT = 50;
const COLUMN_WIDTH = 260;
/** The snapshot fields of a linked work unit the board does not hold; the drawer loads the rest. */
const STAND_IN: BoardUnit = {
  id: "",
  title: "",
  workType: "",
  status: "",
  description: null,
  estimate: null,
  epic: null,
  attachments: [],
  lastStateChangeAt: null,
};

function makeStyles(theme: Theme, compact: boolean, inset: number) {
  const c = theme.colors;
  return {
    screen: { flex: 1, minHeight: 0, backgroundColor: c.surface0 },
    header: { padding: compact ? 12 : 16, gap: 8, borderBottomWidth: 1, borderColor: c.border },
    headerRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 8 },
    summary: { flex: 1, color: c.foregroundMuted, fontSize: 13 },
    input: {
      flexGrow: 1,
      flexBasis: 160,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface1,
      color: c.foreground,
    },
    chip: (active: boolean) => ({
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: active ? c.accent : c.border,
      backgroundColor: active ? c.accent : c.surface1,
    }),
    chipText: (active: boolean) => ({ color: active ? c.accentForeground : c.foreground, fontSize: 13 }),
    columns: { flex: 1, minHeight: 0 },
    columnsContent: { padding: 12, paddingBottom: 12 + inset, gap: 12 },
    column: {
      width: COLUMN_WIDTH,
      flex: 1,
      minHeight: 0,
      borderRadius: 10,
      backgroundColor: c.surface1,
      borderWidth: 1,
      borderColor: c.border,
    },
    columnTitle: { padding: 10, color: c.foreground, fontWeight: "600" as const },
    list: { flex: 1, minHeight: 0 },
    listContent: { padding: compact ? 12 : 8, paddingBottom: (compact ? 12 : 8) + inset, gap: 8 },
    card: (selected: boolean, latest: boolean) => ({
      padding: 10,
      gap: 4,
      borderRadius: 8,
      borderWidth: selected ? 2 : 1,
      borderColor: selected ? c.accent : latest ? c.statusWarning : c.border,
      backgroundColor: c.surface2,
    }),
    cardLabel: { color: c.foreground, fontWeight: "600" as const, fontVariant: ["tabular-nums" as const] },
    cardTitle: { color: c.foregroundMuted, fontSize: 13 },
    message: { padding: 24, color: c.foregroundMuted, textAlign: "center" as const },
    warning: { color: c.statusWarning, fontSize: 12 },
  };
}

type Styles = ReturnType<typeof makeStyles>;

/**
 * The fspec board as a workspace panel (FSPEC-035) with card actions
 * (FSPEC-037); a selected card's details slide in as a drawer (FSPEC-048).
 */
export function BoardPanel({ theme, layout, workspaceId, tab, navigation }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const { board, error } = useBoard(directory);
  const [tabState, setTabState] = useTabState(tab, tabSchema, defaultTab);
  // The drawer's history (FSPEC-048), seeded from a selection restored with the tab.
  const [drawer, setDrawer] = useState(() =>
    tabState.selected === null ? EMPTY_DRAWER : drawerReducer(EMPTY_DRAWER, { type: "select", id: tabState.selected }),
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("id");
  // onLayout is not guaranteed for a plugin's root view: until the board is
  // measured, size the drawer from the window, which is always known.
  const [boardWidth, setBoardWidth] = useState(0);
  const window = useWindowDimensions();
  const [opening, setOpening] = useState(false);
  const paseo = usePaseo();
  const toast = useToast();
  const moveCard = useRpc(moveBoardRpc);
  // Plugins cannot read safe-area insets: reserve Android's navigation bar (FSPEC-048).
  const inset = bottomInset(layout.platform);
  const styles = useMemo(() => makeStyles(theme, layout.compact, inset), [theme, layout.compact, inset]);

  const ready = board?.state === "ready" ? board : null;
  const units = ready?.units ?? [];
  const focus: Focus = ready?.focus ?? {};
  const columns = useMemo(() => groupColumns(units), [units]);
  const latest = useMemo(() => latestChange(units), [units]);
  const searching = query !== "";
  const results = useMemo(
    () => (searching ? searchUnits(units, mode, query).slice(0, SEARCH_LIMIT) : []),
    [searching, units, mode, query],
  );

  /** Moves the drawer and keeps the tab's selection (card highlight, restore) in step. */
  const navigate = useCallback(
    (event: DrawerEvent) => {
      const next = drawerReducer(drawer, event);
      setDrawer(next);
      setTabState({ column: tabState.column, selected: currentId(next) });
    },
    [drawer, setTabState, tabState.column],
  );
  const select = useCallback((id: string) => navigate({ type: "select", id }), [navigate]);
  const chooseResult = useCallback(
    (unit: BoardUnit) => {
      const { column, selected } = revealCard(unit);
      setDrawer(drawerReducer(EMPTY_DRAWER, { type: "select", id: selected }));
      setTabState({ column: column ?? tabState.column, selected });
      setQuery("");
    },
    [setTabState, tabState.column],
  );
  const chooseColumn = useCallback(
    (column: BoardColumnStatus) => setTabState({ column, selected: tabState.selected }),
    [setTabState, tabState.selected],
  );

  const renderCard = useCallback(
    ({ item }: { item: BoardUnit }) => (
      <Card
        unit={item}
        focus={focus}
        latest={item.id === latest}
        selected={item.id === tabState.selected}
        styles={styles}
        onPress={select}
      />
    ),
    [focus, latest, tabState.selected, styles, select],
  );

  const move = async (id: string, direction: "up" | "down") => {
    if (directory === null) return;
    try {
      const answer = await moveCard({ cwd: directory, id, direction });
      if (!answer.ok) toast.error(answer.error);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const openAgent = navigation?.openAgent;
  const open = async (unit: BoardUnit) => {
    if (openAgent === undefined || opening) return;
    setOpening(true);
    try {
      const result = await openInAgent(
        {
          async listAgents() {
            const entries: AgentEntry[] = [];
            let cursor: string | undefined;
            do {
              const page = await paseo.agents.list({
                filter: { statuses: ["initializing", "idle", "running", "error"] },
                page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
              });
              entries.push(...page.entries);
              cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
            } while (cursor !== undefined);
            return entries;
          },
          async listModels() {
            return fspecModels(await paseo.providers.listModels("fspec"));
          },
          async createAgent({ provider, title, prompt }) {
            const agent = await paseo.workspaces.ref(workspaceId).agents.create({ config: { provider }, title, prompt });
            return { id: agent.id };
          },
          openAgent: (agentId) => openAgent({ agentId }),
        },
        unit,
        focus,
      );
      if (result.created) toast.show(`Started an fspec agent on ${unit.id}`, { variant: "success" });
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setOpening(false);
    }
  };

  if (board === null) {
    return (
      <View style={styles.screen}>
        {error === null ? <Loading /> : <Text style={styles.message}>{`Retrying: ${error}`}</Text>}
      </View>
    );
  }
  if (board.state === "unavailable") {
    return (
      <View style={styles.screen}>
        <Text style={styles.message}>{board.reason}</Text>
      </View>
    );
  }

  const chosen = isBoardColumn(tabState.column) ? tabState.column : null;
  const shown = compactColumn(chosen, columns);
  const shownId = currentId(drawer);
  // A followed relationship may point at a unit the board does not hold: show it by id.
  const drawerUnit: BoardUnit | null =
    shownId === null ? null : (units.find((unit) => unit.id === shownId) ?? { ...STAND_IN, id: shownId, title: shownId });
  return (
    <View style={styles.screen} onLayout={(event) => setBoardWidth(event.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search by ${mode}`}
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Search work units"
          />
          {SEARCH_MODES.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: option === mode }}
              onPress={() => setMode(option)}
              style={styles.chip(option === mode)}
            >
              <Text style={styles.chipText(option === mode)}>{option}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.headerRow}>
          <Text style={styles.summary}>{pointsSummary(units)}</Text>
          {error !== null ? <Text style={styles.warning}>{`Reconnecting: ${error}`}</Text> : null}
        </View>
        {layout.compact && !searching ? (
          <ColumnChips columns={columns} shown={shown} styles={styles} onChoose={chooseColumn} />
        ) : null}
      </View>
      {searching ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={results}
          keyExtractor={(unit) => unit.id}
          ListEmptyComponent={<Text style={styles.message}>No matching work units</Text>}
          renderItem={({ item }) => (
            <Card
              unit={item}
              focus={focus}
              latest={item.id === latest}
              selected={item.id === tabState.selected}
              styles={styles}
              onPress={() => chooseResult(item)}
              status
            />
          )}
        />
      ) : layout.compact ? (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={columns.find((column) => column.status === shown)?.units ?? []}
          keyExtractor={(unit) => unit.id}
          renderItem={renderCard}
          ListEmptyComponent={<Text style={styles.message}>{`No work units in ${shown}`}</Text>}
        />
      ) : (
        <ScrollView horizontal style={styles.columns} contentContainerStyle={styles.columnsContent}>
          {columns.map((column) => (
            <View key={column.status} style={styles.column}>
              <Text style={styles.columnTitle}>{`${column.status} (${column.units.length})`}</Text>
              <FlatList
                style={styles.list}
                contentContainerStyle={styles.listContent}
                data={column.units}
                keyExtractor={(unit) => unit.id}
                renderItem={renderCard}
              />
            </View>
          ))}
        </ScrollView>
      )}
      {drawerUnit !== null && directory !== null ? (
        <DetailsDrawer
          cwd={directory}
          workspace={board.workspace}
          unit={drawerUnit}
          boardWidth={boardWidth > 0 ? boardWidth : window.width}
          theme={theme}
          layout={layout}
          canOpenAgent={openAgent !== undefined}
          opening={opening}
          onAction={(action) => {
            if (action === "openInAgent") void open(drawerUnit);
            else void move(drawerUnit.id, action === "moveUp" ? "up" : "down");
          }}
          canGoBack={canGoBack(drawer)}
          canGoForward={canGoForward(drawer)}
          onBack={() => navigate({ type: "back" })}
          onForward={() => navigate({ type: "forward" })}
          onFollow={(id) => navigate({ type: "follow", id })}
          onClose={() => navigate({ type: "close" })}
        />
      ) : null}
    </View>
  );
}

function ColumnChips(props: {
  columns: BoardColumn[];
  shown: BoardColumnStatus;
  styles: Styles;
  onChoose: (column: BoardColumnStatus) => void;
}) {
  return (
    <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
      {props.columns.map((column) => {
        const active = column.status === props.shown;
        return (
          <Pressable
            key={column.status}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => props.onChoose(column.status)}
            style={props.styles.chip(active)}
          >
            <Text style={props.styles.chipText(active)}>{`${column.status} (${column.units.length})`}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Card(props: {
  unit: BoardUnit;
  focus: Focus;
  latest: boolean;
  selected: boolean;
  styles: Styles;
  onPress: (id: string) => void;
  /** Search results come from every column, so they also name their column. */
  status?: boolean;
}) {
  const { unit, styles } = props;
  const label = cardLabel(unit, props.focus);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={`${label}${props.latest ? ", most recent change" : ""}: ${unit.title}`}
      onPress={() => props.onPress(unit.id)}
      style={styles.card(props.selected, props.latest)}
    >
      <Text style={styles.cardLabel}>{props.latest ? `⏩ ${label} ⏩` : label}</Text>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {props.status ? `${unit.status} · ${unit.title}` : unit.title}
      </Text>
    </Pressable>
  );
}
