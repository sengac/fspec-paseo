import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Pressable, Text } from "react-native";

type Theme = PluginWorkspacePanelProps["theme"];

function makeStyles(theme: Theme, primary: boolean) {
  const c = theme.colors;
  return {
    button: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: primary ? c.accent : c.border,
      backgroundColor: primary ? c.accent : c.surface2,
    },
    text: { color: primary ? c.accentForeground : c.foreground, fontSize: 13 },
  };
}

/** The plugin's small action button (board drawer, settings sheets); `primary` fills it with the accent. */
export function StripButton(props: { theme: Theme; label: string; onPress: () => void; primary?: boolean }) {
  const primary = props.primary === true;
  const styles = useMemo(() => makeStyles(props.theme, primary), [props.theme, primary]);
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={styles.button}>
      <Text style={styles.text}>{props.label}</Text>
    </Pressable>
  );
}
