import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Loading, Markdown, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Pressable, Text, View } from "react-native";
import { type BoardDetailsOutput, type BoardUnit, boardDetailsRpc } from "../shared/board.js";
import { StripButton } from "./board-details.js";
import {
  attachmentLink,
  type Block,
  bottomInset,
  documentFor,
  type DrawerActionId,
  drawerActions,
  drawerHeader,
  drawerWidth,
} from "./details-document.js";

type Theme = PluginWorkspacePanelProps["theme"];
type Layout = PluginWorkspacePanelProps["layout"];

const DURATION_MS = 220;

function makeStyles(theme: Theme, compact: boolean) {
  const c = theme.colors;
  const pad = compact ? 14 : 18;
  return {
    panel: {
      position: "absolute" as const,
      top: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.surface1,
      borderLeftWidth: 1,
      borderColor: c.border,
    },
    header: { padding: pad, paddingBottom: 12, gap: 10, borderBottomWidth: 1, borderColor: c.border },
    nav: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
    arrow: (enabled: boolean) => ({
      width: 32,
      height: 28,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface2,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      opacity: enabled ? 1 : 0.4,
    }),
    arrowText: { color: c.foreground, fontSize: 15, lineHeight: 18 },
    title: { color: c.foreground, fontSize: compact ? 16 : 17, fontWeight: "700" as const },
    row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, alignItems: "center" as const },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface2,
    },
    chipText: { color: c.foregroundMuted, fontSize: 12 },
    linkChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: c.accent },
    linkText: { color: c.accent, fontSize: 13, fontWeight: "600" as const },
    body: { padding: pad, gap: 18 },
    blockTitle: {
      color: c.foregroundMuted,
      fontSize: 11,
      fontWeight: "700" as const,
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
      marginBottom: 6,
    },
    text: { color: c.foreground, fontSize: 14, lineHeight: 20 },
    muted: { color: c.foregroundMuted, fontSize: 13, lineHeight: 18 },
    item: { flexDirection: "row" as const, gap: 8, marginBottom: 6 },
    marker: { color: c.accent, fontSize: 14, lineHeight: 20, minWidth: 18, textAlign: "right" as const },
    label: { color: c.foregroundMuted, fontSize: 12, fontWeight: "600" as const, width: compact ? 72 : 96 },
    open: { color: c.statusWarning, fontSize: 12, fontWeight: "600" as const },
    error: { color: c.statusDanger, fontSize: 13 },
  };
}

type Styles = ReturnType<typeof makeStyles>;

/**
 * A work unit's details as a drawer that slides in from the right over the
 * board (FSPEC-048): back / forward through the work units it showed, the
 * card's actions, then its full fspec record laid out as formatted blocks.
 * The board beside it stays usable; Close, Android Back or Escape closes it.
 * Layout decisions live in details-document.ts.
 */
export function DetailsDrawer(props: {
  cwd: string;
  /** The fspec daemon's workspace root: attachments are paths inside it. */
  workspace: string;
  /** The work unit shown; `unit` is its board snapshot, or a stand-in for a linked unit. */
  unit: BoardUnit;
  boardWidth: number;
  theme: Theme;
  layout: Layout;
  canOpenAgent: boolean;
  opening: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
  onAction(action: Exclude<DrawerActionId, "close">): void;
  onFollow(id: string): void;
  onClose(): void;
}) {
  const { theme, layout, unit } = props;
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const width = drawerWidth(props.boardWidth, layout.compact);
  const details = useRpc(boardDetailsRpc);
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const [answer, setAnswer] = useState<BoardDetailsOutput | null>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    let live = true;
    setAnswer(null);
    detailsRef.current({ cwd: props.cwd, id: unit.id }).then(
      (result) => live && setAnswer(result),
      (error: unknown) => live && setAnswer({ state: "unavailable", reason: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [props.cwd, unit.id]);

  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slide]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(slide, { toValue: 0, duration: DURATION_MS * 0.8, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
      () => onClose.current(),
    );
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    // Android Back closes the drawer (BackHandler does not exist on web).
    const back =
      layout.platform === "web"
        ? null
        : BackHandler.addEventListener("hardwareBackPress", () => {
            closeRef.current();
            return true;
          });
    // Web: Escape closes the drawer.
    const target = globalThis as unknown as {
      addEventListener?: (type: string, listener: (event: { key?: string }) => void) => void;
      removeEventListener?: (type: string, listener: (event: { key?: string }) => void) => void;
    };
    const onKey = (event: { key?: string }) => {
      if (event.key === "Escape") closeRef.current();
    };
    if (layout.platform === "web") target.addEventListener?.("keydown", onKey);
    return () => {
      back?.remove();
      if (layout.platform === "web") target.removeEventListener?.("keydown", onKey);
    };
  }, [layout.platform]);

  const record = answer?.state === "ready" ? answer.workUnit : null;
  const header = drawerHeader(unit, record);
  const blocks = record === null ? null : documentFor(record);
  const fallbackDescription = unit.description;

  return (
    // box-none: the wrapper lets touches through to the board; only the panel takes them.
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
      <Animated.View
        style={[styles.panel, { width, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] }]}
      >
        <View style={styles.header}>
          <View style={styles.nav}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous work unit"
              accessibilityState={{ disabled: !props.canGoBack }}
              disabled={!props.canGoBack}
              onPress={props.onBack}
              style={styles.arrow(props.canGoBack)}
            >
              <Text style={styles.arrowText}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next work unit"
              accessibilityState={{ disabled: !props.canGoForward }}
              disabled={!props.canGoForward}
              onPress={props.onForward}
              style={styles.arrow(props.canGoForward)}
            >
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </View>
          <Text style={styles.title} selectable numberOfLines={3}>
            {header.title}
          </Text>
          <View style={styles.row}>
            {header.chips.map((chip) => (
              <View key={chip} style={styles.chip}>
                <Text style={styles.chipText}>{chip}</Text>
              </View>
            ))}
          </View>
          <View style={styles.row}>
            {drawerActions(unit, props.canOpenAgent).map((action) =>
              action.id === "close" ? (
                <StripButton key={action.id} theme={theme} label={action.label} onPress={close} />
              ) : (
                <StripButton
                  key={action.id}
                  theme={theme}
                  primary={action.id === "openInAgent"}
                  label={action.id === "openInAgent" && props.opening ? "Opening…" : action.label}
                  onPress={() => props.onAction(action.id as Exclude<DrawerActionId, "close">)}
                />
              ),
            )}
          </View>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.body, { paddingBottom: 24 + bottomInset(layout.platform) }]}
        >
          {answer?.state === "unavailable" ? <Text style={styles.error}>{answer.reason}</Text> : null}
          {blocks === null ? (
            <>
              {fallbackDescription !== null ? <TextBlock styles={styles} title="Description" text={fallbackDescription} /> : null}
              {answer === null ? <Loading /> : null}
            </>
          ) : (
            blocks.map((block, index) => (
              <BlockView
                key={`${block.title}-${index}`}
                block={block}
                styles={styles}
                workspace={props.workspace}
                onFollow={props.onFollow}
              />
            ))
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function TextBlock(props: { styles: Styles; title: string; text: string }) {
  return (
    <View>
      <Text style={props.styles.blockTitle}>{props.title}</Text>
      <Text style={props.styles.text} selectable>
        {props.text}
      </Text>
    </View>
  );
}

function Items(props: { styles: Styles; items: string[]; numbered?: boolean }) {
  return (
    <View>
      {props.items.map((text, index) => (
        <View key={index} style={props.styles.item}>
          <Text style={props.styles.marker}>{props.numbered ? `${index + 1}.` : "•"}</Text>
          <Text style={[props.styles.text, { flex: 1 }]} selectable>
            {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function formatTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

/** One formatted block of the record. */
function BlockView(props: { block: Block; styles: Styles; workspace: string; onFollow(id: string): void }) {
  const { block, styles } = props;
  const title = <Text style={styles.blockTitle}>{block.title}</Text>;
  switch (block.kind) {
    case "text":
      return <TextBlock styles={styles} title={block.title} text={block.text} />;
    case "userStory":
      return (
        <View>
          {title}
          {block.rows.map((row) => (
            <View key={row.label} style={styles.item}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={[styles.text, { flex: 1 }]} selectable>
                {row.text}
              </Text>
            </View>
          ))}
        </View>
      );
    case "attachments":
      return (
        <View>
          {title}
          {block.items.map((path) => {
            const link = attachmentLink(props.workspace, path);
            return (
              <View key={path} style={{ marginBottom: 8 }}>
                {/* Paseo's Markdown opens workspace file links in its file viewer. */}
                <Markdown>{link.markdown}</Markdown>
                {link.folder !== "" ? <Text style={styles.muted}>{link.folder}</Text> : null}
              </View>
            );
          })}
        </View>
      );
    case "numbered":
    case "list":
      return (
        <View>
          {title}
          <Items styles={styles} items={block.items} numbered={block.kind === "numbered"} />
        </View>
      );
    case "questions":
      return (
        <View>
          {title}
          {block.items.map((question, index) => (
            <View key={index} style={[styles.item, { flexDirection: "column", gap: 2 }]}>
              <Text style={styles.text} selectable>
                {question.text}
              </Text>
              {question.answer === null ? (
                <Text style={styles.open}>Open</Text>
              ) : (
                <Text style={styles.muted} selectable>{`Answer: ${question.answer}`}</Text>
              )}
            </View>
          ))}
        </View>
      );
    case "storm":
      return (
        <View>
          {title}
          {block.groups.map((group) => (
            <View key={group.title} style={{ marginBottom: 8 }}>
              <Text style={[styles.muted, { fontWeight: "600" }]}>{`${group.title} (${group.items.length})`}</Text>
              <Items styles={styles} items={group.items} />
            </View>
          ))}
        </View>
      );
    case "links":
      return (
        <View>
          {title}
          {block.groups.map((group) => (
            <View key={group.label} style={[styles.item, { alignItems: "center" }]}>
              <Text style={styles.label}>{group.label}</Text>
              <View style={[styles.row, { flex: 1 }]}>
                {group.ids.map((id) => (
                  <Pressable key={id} accessibilityRole="link" onPress={() => props.onFollow(id)} style={styles.linkChip}>
                    <Text style={styles.linkText}>{id}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case "history":
      return (
        <View>
          {title}
          {block.items.map((entry, index) => (
            <View key={index} style={[styles.item, { alignItems: "center" }]}>
              <View style={[styles.chip, { minWidth: 96, alignItems: "center" }]}>
                <Text style={styles.chipText}>{entry.state}</Text>
              </View>
              <Text style={styles.muted}>{formatTime(entry.at)}</Text>
            </View>
          ))}
        </View>
      );
    case "fields":
      return (
        <View>
          {title}
          {block.rows.map((row) => (
            <View key={row.label} style={styles.item}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={[styles.muted, { flex: 1 }]} selectable>
                {/^\d{4}-\d{2}-\d{2}T/.test(row.value) ? formatTime(row.value) : row.value}
              </Text>
            </View>
          ))}
        </View>
      );
  }
}
