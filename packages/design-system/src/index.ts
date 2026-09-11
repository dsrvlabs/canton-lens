// @canton-lens/design-system — the design system for Canton Lens.
//
// **This package knows nothing of the domain.** The words ledger·lens·contract·party are not here,
// and neither is judgement (that belongs to packages/core). What lives here is tokens and the
// domain-free primitives built from them.
//
// The stylesheet is imported separately — once, at the entry point:
//   import "@canton-lens/design-system/styles.css";

export {
  Badge,
  type BadgeTone,
  CopyButton,
  Crumb,
  Faint,
  Inline,
  Mono,
  Muted,
} from "./components/chip.tsx";
export {
  ActionRow,
  Button,
  type ButtonSize,
  type ButtonVariant,
  Disclosure,
  FloatingButton,
  Pager,
  RefreshIcon,
  SearchBar,
  SearchButton,
  SearchInput,
  SuggestInput,
  TextInput,
  Toolbar,
  ToolbarFlag,
  ToolbarForm,
} from "./components/control.tsx";

export { Band, Columns, LoadingBar, Scroll, Shell, SidePanel } from "./components/layout.tsx";
export {
  Anchor,
  DescriptionList,
  Menu,
  MenuAside,
  MenuEmpty,
  MenuRow,
  Nav,
  NavGroup,
  NavItem,
  NavItemSoon,
  Tab,
  Tabs,
} from "./components/list.tsx";
export {
  Banner,
  Card,
  CardGrid,
  CardUnavailable,
  ListCard,
  ListCardAmount,
  ListCardMeta,
  ListCardSub,
  Section,
  SectionBody,
} from "./components/surface.tsx";
export { GroupRow, MessageRow, RowLink, Table } from "./components/table.tsx";
export { activateHandlers, cx, truncate } from "./components/util.ts";
export { NARROW_BREAKPOINT_PX, token } from "./tokens.ts";
