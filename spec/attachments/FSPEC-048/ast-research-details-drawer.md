# Research: work unit details as a right-hand drawer over the board

## Today

`client/board-details.tsx` `DetailsDialog` renders the work unit's full record in the plugin
`Modal` (`@getpaseo/plugin/client/ui`). That is a bottom sheet on compact layouts and a centered
dialog on wide ones. `client/board-panel.tsx:318` mounts it with `detailsId`.

## Wanted

A drawer that slides in from the right **over the top of the board**, covering part of it (not a
separate tab, not a bottom sheet). The board stays visible and dimmed behind it, and tapping the dim
area, Back, or Close dismisses it. It has to clear Android's navigation bar and follow Paseo's
plugin design rules.

## Paseo facts (~/projects/paseo)

- **No drawer component for plugins.** `@getpaseo/plugin/client/ui` exports Modal, ScrollView,
  FlatList, TextInput, Settings*, Sidebar*, Loading, Markdown, ExternalLink, Icon, useToast and copyText
  (`packages/app/src/plugins/react-native/ui.ts`).
- **The explorer sidebar is the wrong vehicle.** `locations: ["explorer"]` puts a panel in the
  right-hand explorer, but on phones that is a full-width overlay
  (`screens/workspace/explorer-sidebar/geometry.tsx`: `width: overlay ? containerWidth : …`), and it
  is the file explorer's slot. Workspace panels also take no params, so it can't be told which card to show.
- **The plugin runtime modules** (`plugins/evaluate.ts` runtimeRequire) are react, react/jsx-runtime,
  react-native, @getpaseo/plugin, @getpaseo/plugin/client, …/client/ui and @tanstack/react-query.
  **`react-native-safe-area-context` is not available.**
- **Insets.** The Android app is edge-to-edge (`app.config.js` `edgeToEdgeEnabled: true`).
  Workspace panels are not padded by the host (`plugins/workspace-panels/panel.tsx` passes only
  theme, host, layout{compact, platform} and navigation). Paseo's own panels pad themselves with
  `useSafeAreaInsets()`: `git/diff-pane.tsx:1752`, `git/commits-section/commits-section.tsx:108`
  (`paddingBottom: insets.bottom`), `review/feedback/surface.tsx:51`, and the composer dock and
  left sidebar. The explorer overlay pads top, left and right with insets (`geometry.tsx:73-75`).
  Plugin `Modal` gets the bottom inset because the host owns it (`components/adaptive-modal-sheet.tsx:295-297`).
- **Design rules** (public-docs/plugins/reference.md "Theme and layout"):
  - Colours come only from `theme.colors`: `surface0` for the root, `surface1` for raised panels,
    `border` for dividers, `foreground` and `foregroundMuted` for text.
  - Tighten padding when `layout.compact` is true. Recreate styles when theme or compact changes.
  - Use the host `ScrollView` / `FlatList` so scrolling cooperates with host gestures.

## Implementation sketch

- `client/details-drawer.tsx`: an absolutely positioned overlay inside the board panel's root view.
  - A backdrop `Pressable` (dim via `theme.colors.surface0` at reduced opacity, or black with opacity
    from the theme family; no hard-coded white).
  - A right-anchored panel, `Animated.View` with `translateX` from its own width to 0 using the
    RN `Animated` timing API with the native driver.
  - Width: `min(480, 88% of the board width)` when compact, else `min(560, 45%)`.
  - A header with the title and a close button, and the body in the host `ScrollView`.
  - Android hardware Back closes it (`BackHandler`), and web Escape closes it.
- The pure geometry (width rules, animation targets) lives in a tested model.
- Bottom clearance: see the open question on the card.
