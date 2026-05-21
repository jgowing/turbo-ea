import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { alpha, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Collapse from "@mui/material/Collapse";
import LinearProgress from "@mui/material/LinearProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import ReportShell from "./ReportShell";
import SaveReportDialog from "./SaveReportDialog";
import TimelineSlider from "@/components/TimelineSlider";
import FilterSelect, { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import TagPicker from "@/components/TagPicker";
import type { TagGroup } from "@/types";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { useTimeline } from "@/hooks/useTimeline";
import { useResolveLabel, useResolveMetaLabel } from "@/hooks/useResolveLabel";
import { useAiStatus } from "@/hooks/useAiStatus";
import type { PortfolioInsightsResponse, StructuredInsight } from "@/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppRelation {
  relation_type: string;
  related_id: string;
  related_name: string;
  related_type: string;
}

interface AppStakeholder {
  user_id: string;
  user_display_name: string;
  role: string;
}

interface AppData {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  relations: AppRelation[];
  org_ids: string[];
  tag_ids?: string[];
  stakeholders?: AppStakeholder[];
}

interface StakeholderRoleDef {
  key: string;
  label: string;
  color?: string;
  translations?: Record<string, string>;
}

interface StakeholderUserRef {
  id: string;
  display_name: string;
  email?: string;
}

interface TagGroupDef {
  id: string;
  name: string;
  mode: string;
  tags: { id: string; name: string; color?: string }[];
}

interface FieldOption {
  key: string;
  label: string;
  color?: string;
  translations?: Record<string, string>;
}

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: FieldOption[];
  translations?: Record<string, string>;
}

interface SectionDef {
  section: string;
  fields: FieldDef[];
}

interface RelTypeDef {
  key: string;
  label: string;
  reverse_label?: string;
  source_type_key: string;
  target_type_key: string;
  other_type_key: string;
}

interface OrgRef {
  id: string;
  name: string;
}

interface ApiResponse {
  items: AppData[];
  fields_schema: SectionDef[];
  relation_types: RelTypeDef[];
  groupable_types: Record<string, { id: string; name: string; type: string }[]>;
  organizations: OrgRef[];
  tag_groups?: TagGroupDef[];
  stakeholder_roles?: StakeholderRoleDef[];
  stakeholder_users?: StakeholderUserRef[];
}

interface GroupData {
  key: string;
  label: string;
  apps: AppData[];
  /** Optional accent color (used for stakeholder role headers). */
  color?: string;
  /** For stakeholder-role groups, maps card.id -> stakeholder display names
   * holding *this* role on that card. Drives the chip sub-label. */
  appUserNames?: Record<string, string[]>;
}

interface DrawerData {
  label: string;
  apps: AppData[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const UNSET_COLOR = "#9e9e9e";
const DEFAULT_APP_COLOR = "#0f7eb5";

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pickSelectFields(schema: SectionDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const s of schema)
    for (const f of s.fields)
      if (f.type === "single_select") out.push(f);
  return out;
}

function getAppColor(
  app: AppData,
  colorBy: string,
  selectFields: FieldDef[],
): string {
  if (!colorBy) return DEFAULT_APP_COLOR;
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return UNSET_COLOR;
  const fd = selectFields.find((f) => f.key === colorBy);
  const opt = fd?.options?.find((o) => o.key === val);
  return opt?.color || UNSET_COLOR;
}

function getAppColorLabel(
  app: AppData,
  colorBy: string,
  selectFields: FieldDef[],
): string | null {
  if (!colorBy) return null;
  const val = (app.attributes || {})[colorBy] as string | undefined;
  if (!val) return null;
  const fd = selectFields.find((f) => f.key === colorBy);
  const opt = fd?.options?.find((o) => o.key === val);
  return opt?.label || val;
}

function parseDate(s: string | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function isAppAliveAtDate(app: AppData, dateMs: number): boolean {
  const lc = app.lifecycle;
  if (!lc) return true;
  const dates = LIFECYCLE_PHASES.map((p) => parseDate(lc[p])).filter(
    (d): d is number => d != null,
  );
  if (dates.length === 0) return true;
  if (Math.min(...dates) > dateMs) return false;
  const eol = parseDate(lc.endOfLife);
  if (eol != null && eol <= dateMs) return false;
  return true;
}

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

/* ------------------------------------------------------------------ */
/*  Filter helpers                                                     */
/* ------------------------------------------------------------------ */

interface FilterState {
  attributeFilters: Record<string, string[]>;
  relationFilters: Record<string, string[]>;
  /** Flat list of selected tag ids (bucketed by group at filter time) */
  tagFilterIds: string[];
  tagGroups: TagGroupDef[];
  timelineDate: number;
  search: string;
  /** Restrict to cards where at least one stakeholder is one of these users. */
  stakeholderUserIds: string[];
  /** Restrict to cards where at least one stakeholder holds one of these roles. */
  stakeholderRoleKeys: string[];
}

function matchesFilters(
  app: AppData,
  filters: FilterState,
): boolean {
  if (!isAppAliveAtDate(app, filters.timelineDate)) return false;
  // Attribute filters
  const attrs = app.attributes || {};
  for (const [key, vals] of Object.entries(filters.attributeFilters)) {
    if (vals.length === 0) continue;
    const v = attrs[key] as string | undefined;
    const isEmpty = v === undefined || v === null || v === "";
    const wantEmpty = vals.includes(EMPTY_FILTER_KEY);
    const realVals = vals.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && isEmpty) continue;
    if (realVals.length > 0 && realVals.includes(v as string)) continue;
    return false;
  }
  // Relation filters (e.g. Organization, Platform, etc.)
  for (const [typeKey, ids] of Object.entries(filters.relationFilters)) {
    if (ids.length === 0) continue;
    const appRels = app.relations.filter((r) => r.related_type === typeKey);
    const wantEmpty = ids.includes(EMPTY_FILTER_KEY);
    const realIds = ids.filter((x) => x !== EMPTY_FILTER_KEY);
    if (wantEmpty && appRels.length === 0) continue;
    if (realIds.length > 0 && appRels.some((r) => realIds.includes(r.related_id))) continue;
    return false;
  }
  // Tag filters (OR within a group, AND across groups) — bucket the flat
  // selection by tag_group_id before matching.
  if (filters.tagFilterIds.length > 0) {
    const appTagIds = new Set(app.tag_ids || []);
    const selectedSet = new Set(filters.tagFilterIds);
    for (const group of filters.tagGroups) {
      const pickedInGroup = group.tags
        .filter((tag) => selectedSet.has(tag.id))
        .map((tag) => tag.id);
      if (pickedInGroup.length === 0) continue;
      if (!pickedInGroup.some((id) => appTagIds.has(id))) return false;
    }
  }
  if (
    filters.search &&
    !app.name.toLowerCase().includes(filters.search.toLowerCase())
  )
    return false;
  // Stakeholder filters
  if (filters.stakeholderUserIds.length > 0) {
    const ids = new Set(filters.stakeholderUserIds);
    if (!(app.stakeholders || []).some((s) => ids.has(s.user_id))) return false;
  }
  if (filters.stakeholderRoleKeys.length > 0) {
    const keys = new Set(filters.stakeholderRoleKeys);
    if (!(app.stakeholders || []).some((s) => keys.has(s.role))) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Grouping logic                                                     */
/* ------------------------------------------------------------------ */

type GroupByMode =
  | { kind: "attribute"; fieldKey: string }
  | { kind: "relation"; typeKey: string }
  | { kind: "stakeholder_role" };

function groupApps(
  apps: AppData[],
  mode: GroupByMode,
  selectFields: FieldDef[],
  groupableTypes: Record<string, { id: string; name: string; type: string }[]>,
  stakeholderRoles: StakeholderRoleDef[] = [],
): { groups: GroupData[]; ungrouped: AppData[] } {
  if (mode.kind === "attribute") {
    const field = selectFields.find((f) => f.key === mode.fieldKey);
    const options = field?.options || [];
    const buckets = new Map<string, AppData[]>();
    const ungrouped: AppData[] = [];

    for (const opt of options) buckets.set(opt.key, []);
    for (const app of apps) {
      const val = (app.attributes || {})[mode.fieldKey] as string | undefined;
      if (val && buckets.has(val)) {
        buckets.get(val)!.push(app);
      } else {
        ungrouped.push(app);
      }
    }

    const groups: GroupData[] = [];
    for (const opt of options) {
      const items = buckets.get(opt.key) || [];
      groups.push({ key: opt.key, label: opt.label, apps: items });
    }
    return { groups, ungrouped };
  }

  if (mode.kind === "stakeholder_role") {
    // One bucket per active role definition. A card appears in every role
    // bucket it has stakeholders for — same multi-bucket behaviour as
    // relation grouping. Cards with no stakeholders go to `ungrouped`
    // (the caller decides whether to render them as an "Unassigned" tile).
    const buckets = new Map<string, { apps: AppData[]; names: Record<string, string[]> }>();
    const grouped = new Set<string>();

    for (const r of stakeholderRoles) buckets.set(r.key, { apps: [], names: {} });
    for (const app of apps) {
      const seenRoles = new Set<string>();
      for (const sh of app.stakeholders || []) {
        const bucket = buckets.get(sh.role);
        if (!bucket) continue;
        if (!seenRoles.has(sh.role)) {
          bucket.apps.push(app);
          seenRoles.add(sh.role);
        }
        bucket.names[app.id] = bucket.names[app.id] || [];
        if (!bucket.names[app.id].includes(sh.user_display_name)) {
          bucket.names[app.id].push(sh.user_display_name);
        }
        grouped.add(app.id);
      }
    }

    const groups: GroupData[] = [];
    for (const r of stakeholderRoles) {
      const b = buckets.get(r.key);
      if (!b || b.apps.length === 0) continue;
      groups.push({
        key: r.key,
        label: r.label,
        apps: b.apps,
        color: r.color,
        appUserNames: b.names,
      });
    }
    groups.sort((a, b) => b.apps.length - a.apps.length);

    const ungrouped = apps.filter((a) => !grouped.has(a.id));
    return { groups, ungrouped };
  }

  // Relation grouping
  const members = groupableTypes[mode.typeKey] || [];
  const buckets = new Map<string, AppData[]>();
  const grouped = new Set<string>();

  for (const m of members) buckets.set(m.id, []);
  for (const app of apps) {
    for (const rel of app.relations) {
      if (rel.related_type === mode.typeKey && buckets.has(rel.related_id)) {
        buckets.get(rel.related_id)!.push(app);
        grouped.add(app.id);
      }
    }
  }

  const groups: GroupData[] = [];
  for (const m of members) {
    const items = buckets.get(m.id) || [];
    if (items.length > 0) {
      groups.push({ key: m.id, label: m.name, apps: items });
    }
  }
  groups.sort((a, b) => b.apps.length - a.apps.length);

  const ungrouped = apps.filter((a) => !grouped.has(a.id));
  return { groups, ungrouped };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function AppChip({
  app,
  colorBy,
  selectFields,
  onClick,
  stakeholderNames,
}: {
  app: AppData;
  colorBy: string;
  selectFields: FieldDef[];
  onClick: () => void;
  /** Optional list of stakeholder display names to attach as a secondary
   * caption on the chip \u2014 used in stakeholder-role grouping so each chip
   * reads "Card name (Alice, Bob)". */
  stakeholderNames?: string[];
}) {
  const color = getAppColor(app, colorBy, selectFields);
  const colorLabel = getAppColorLabel(app, colorBy, selectFields);
  const light = isLightColor(color);
  const userSuffix =
    stakeholderNames && stakeholderNames.length > 0
      ? stakeholderNames.join(", ")
      : null;
  const tipParts = [app.name];
  if (userSuffix) tipParts.push(userSuffix);
  if (colorLabel) tipParts.push(colorLabel);
  const tip = tipParts.join(" \u2014 ");

  return (
    <Tooltip title={tip}>
      <Chip
        size="small"
        label={
          userSuffix ? (
            <Box component="span" sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
              <Box component="span">{app.name}</Box>
              <Box
                component="span"
                sx={{
                  fontSize: "0.65rem",
                  fontWeight: 400,
                  opacity: 0.85,
                }}
              >
                \u00b7 {userSuffix}
              </Box>
            </Box>
          ) : (
            app.name
          )
        }
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        sx={{
          bgcolor: color,
          color: light ? "#333" : "#fff",
          fontWeight: 500,
          fontSize: "0.72rem",
          maxWidth: 280,
          cursor: "pointer",
          "&:hover": { opacity: 0.85 },
        }}
      />
    </Tooltip>
  );
}

function GroupCard({
  group,
  colorBy,
  selectFields,
  onGroupClick,
  onAppClick,
  countLabel,
}: {
  group: GroupData;
  colorBy: string;
  selectFields: FieldDef[];
  onGroupClick: (g: GroupData) => void;
  onAppClick: (id: string) => void;
  countLabel: (count: number) => string;
}) {
  const { t } = useTranslation(["reports"]);
  const count = group.apps.length;

  /* Build color-by distribution for the stacked bar */
  const colorSegments = useMemo(() => {
    if (!colorBy || count === 0) return [];
    const fd = selectFields.find((f) => f.key === colorBy);
    const counts = new Map<string, { color: string; label: string; n: number }>();
    for (const app of group.apps) {
      const val = (app.attributes || {})[colorBy] as string | undefined;
      const optKey = val || "__unset__";
      if (!counts.has(optKey)) {
        const opt = val ? fd?.options?.find((o) => o.key === val) : undefined;
        counts.set(optKey, {
          color: opt?.color || UNSET_COLOR,
          label: opt?.label || t("portfolio.notSet"),
          n: 0,
        });
      }
      counts.get(optKey)!.n += 1;
    }
    return Array.from(counts.values()).filter((s) => s.n > 0);
  }, [colorBy, count, group.apps, selectFields, t]);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "background.paper",
        cursor: "pointer",
        transition: "box-shadow 0.2s",
        "&:hover": { boxShadow: 3 },
        display: "flex",
        flexDirection: "column",
      }}
      onClick={() => onGroupClick(group)}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          bgcolor: "action.hover",
          borderBottom: count > 0 ? 1 : "none",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, flex: 1 }}
          noWrap
        >
          {group.label}
        </Typography>
        <Chip
          size="small"
          label={countLabel(count)}
          sx={{
            height: 22,
            fontSize: "0.72rem",
            fontWeight: 600,
            bgcolor: count > 0
              ? (t) => alpha(t.palette.primary.main, 0.08)
              : "action.hover",
            color: count > 0 ? "primary.dark" : "text.disabled",
          }}
        />
      </Box>

      {/* Color-by stacked bar */}
      {colorSegments.length > 0 && (
        <Tooltip
          title={colorSegments
            .map((s) => `${s.label}: ${s.n} (${Math.round((s.n / count) * 100)}%)`)
            .join(" · ")}
        >
          <Box sx={{ height: 6, display: "flex" }}>
            {colorSegments.map((s, i) => (
              <Box
                key={i}
                sx={{
                  height: "100%",
                  width: `${(s.n / count) * 100}%`,
                  bgcolor: s.color,
                  transition: "width 0.3s",
                }}
              />
            ))}
          </Box>
        </Tooltip>
      )}

      {/* App chips */}
      {count > 0 && (
        <Box sx={{ p: 1.5, display: "flex", flexWrap: "wrap", gap: 0.5, flex: 1 }}>
          {group.apps
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((app) => (
              <AppChip
                key={app.id}
                app={app}
                colorBy={colorBy}
                selectFields={selectFields}
                onClick={() => onAppClick(app.id)}
                stakeholderNames={group.appUserNames?.[app.id]}
              />
            ))}
        </Box>
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

interface PortfolioReportProps {
  /** Card type key to load. Defaults to "Application" for the legacy
   * Application Portfolio route. */
  initialCardType?: string;
  /** When true, render a card-type picker in the toolbar so the user can
   * switch between any visible card type — used by the Flexible Portfolio. */
  showTypeSelector?: boolean;
  /** Distinct key for saved-report persistence so the Application Portfolio
   * and Flexible Portfolio keep independent localStorage state. */
  savedReportKey?: string;
  /** Title override (defaults to the resolved card type label, then to the
   * generic Application Portfolio title for backwards compatibility). */
  titleOverride?: string;
}

export default function PortfolioReport({
  initialCardType = "Application",
  showTypeSelector = false,
  savedReportKey = "portfolio",
  titleOverride,
}: PortfolioReportProps = {}) {
  const { t } = useTranslation(["reports", "common"]);
  const theme = useTheme();
  const { types: metamodelTypes } = useMetamodel();
  const rl = useResolveLabel();
  const rml = useResolveMetaLabel();
  const saved = useSavedReport(savedReportKey);
  const { chartRef, thumbnail, captureAndSave } = useThumbnailCapture(() => saved.setSaveDialogOpen(true));

  // Data
  const [cardType, setCardType] = useState<string>(initialCardType);
  const [data, setData] = useState<ApiResponse | null>(null);
  // Tracks the card type that the currently-loaded `data` belongs to. Used to
  // gate the defaults- and persist-effects so they don't fire while data is
  // stale (between picking a new type and the fresh fetch resolving).
  const [dataCardType, setDataCardType] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [sidePanelCardId, setSidePanelCardId] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  // AI insights
  const { aiStatus } = useAiStatus();
  const [aiInsights, setAiInsights] = useState<PortfolioInsightsResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  // Controls — defaults are set dynamically after data loads
  const [groupByRaw, setGroupByRaw] = useState("");
  const [colorBy, setColorBy] = useState("");
  const [search, setSearch] = useState("");
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Filters
  const [attrFilters, setAttrFilters] = useState<Record<string, string[]>>({});
  const [relationFilters, setRelationFilters] = useState<Record<string, string[]>>({});
  const [tagFilterIds, setTagFilterIds] = useState<string[]>([]);
  const [stakeholderUserIds, setStakeholderUserIds] = useState<string[]>([]);
  const [stakeholderRoleKeys, setStakeholderRoleKeys] = useState<string[]>([]);
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [showAllRelFilters, setShowAllRelFilters] = useState(false);

  // Timeline
  const tl = useTimeline();

  // Table sort
  const [sortK, setSortK] = useState("name");
  const [sortD, setSortD] = useState<"asc" | "desc">("asc");

  // Load saved report config
  useEffect(() => {
    const cfg = saved.consumeConfig();
    tl.restore(cfg?.timelineDate as number | undefined);
    if (cfg) {
      if (showTypeSelector && cfg.cardType) setCardType(cfg.cardType as string);
      if (cfg.view) setView(cfg.view as "chart" | "table");
      if (cfg.groupByRaw) setGroupByRaw(cfg.groupByRaw as string);
      if (cfg.colorBy != null) setColorBy(cfg.colorBy as string);
      if (cfg.search != null) setSearch(cfg.search as string);
      if (cfg.attrFilters) setAttrFilters(cfg.attrFilters as Record<string, string[]>);
      if (cfg.relationFilters) setRelationFilters(cfg.relationFilters as Record<string, string[]>);
      // Migrate prior `{groupId: tagIds[]}` shape to a flat `string[]`
      if (cfg.tagFilterIds) {
        setTagFilterIds(cfg.tagFilterIds as string[]);
      } else if (cfg.tagFilters && typeof cfg.tagFilters === "object") {
        const flat: string[] = [];
        for (const vals of Object.values(cfg.tagFilters as Record<string, string[]>)) {
          if (Array.isArray(vals)) flat.push(...vals);
        }
        setTagFilterIds(flat);
      }
      // Backwards compat: old saved configs may have filterOrgs
      if (cfg.filterOrgs) setRelationFilters((prev) => ({ ...prev, Organization: cfg.filterOrgs as string[] }));
      if (cfg.stakeholderUserIds) setStakeholderUserIds(cfg.stakeholderUserIds as string[]);
      if (cfg.stakeholderRoleKeys) setStakeholderRoleKeys(cfg.stakeholderRoleKeys as string[]);
      if (cfg.includeUnassigned != null) setIncludeUnassigned(Boolean(cfg.includeUnassigned));
      if (cfg.sortK) setSortK(cfg.sortK as string);
      if (cfg.sortD) setSortD(cfg.sortD as "asc" | "desc");
      setDefaultsApplied(true);
    }
  }, [saved.loadedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const getConfig = () => ({
    cardType,
    view,
    groupByRaw,
    colorBy,
    search,
    attrFilters,
    relationFilters,
    tagFilterIds,
    stakeholderUserIds,
    stakeholderRoleKeys,
    includeUnassigned,
    timelineDate: tl.persistValue,
    sortK,
    sortD,
  });

  // Auto-persist config to localStorage. Skip the very first run so that on
  // mount we don't overwrite a previously-saved config with the initial
  // defaults (the consume-config effect runs alongside this one but its state
  // updates have not yet flushed when this closure is first invoked). Also
  // skip while data is stale (between switching card types and the new fetch
  // resolving) — otherwise we'd persist transient empty groupByRaw/colorBy
  // that would prevent defaults from re-applying on the next load.
  const skipFirstPersistRef = useRef(true);
  useEffect(() => {
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
      return;
    }
    if (dataCardType !== cardType) return;
    saved.persistConfig(getConfig());
  }, [cardType, dataCardType, view, groupByRaw, colorBy, search, attrFilters, relationFilters, tagFilterIds, stakeholderUserIds, stakeholderRoleKeys, includeUnassigned, tl.timelineDate, sortK, sortD]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset all parameters to defaults
  const handleReset = useCallback(() => {
    saved.resetAll();
    setCardType(initialCardType);
    setView("chart");
    setGroupByRaw("");
    setColorBy("");
    setSearch("");
    setAttrFilters({});
    setRelationFilters({});
    setTagFilterIds([]);
    setStakeholderUserIds([]);
    setStakeholderRoleKeys([]);
    setIncludeUnassigned(false);
    setShowAllRelFilters(false);
    tl.reset();
    setSortK("name");
    setSortD("asc");
    setDefaultsApplied(false);
  }, [saved, initialCardType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch data — refetches whenever the user picks a different card type.
  useEffect(() => {
    let cancelled = false;
    const fetchedFor = cardType;
    setData(null);
    setDataCardType(null);
    setAiInsights(null);
    setAiOpen(false);
    api
      .get<ApiResponse>(`/reports/app-portfolio?type=${encodeURIComponent(cardType)}`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setDataCardType(fetchedFor);
      });
    return () => {
      cancelled = true;
    };
  }, [cardType]);

  // Switching card types invalidates field/relation/tag selections because
  // the keys they reference don't exist on the new type. Clear them so the
  // "Apply defaults once data is available" effect re-picks valid values.
  const handleCardTypeChange = useCallback((nextType: string) => {
    if (nextType === cardType) return;
    setCardType(nextType);
    setGroupByRaw("");
    setColorBy("");
    setAttrFilters({});
    setRelationFilters({});
    setTagFilterIds([]);
    setStakeholderUserIds([]);
    setStakeholderRoleKeys([]);
    setIncludeUnassigned(false);
    setShowAllRelFilters(false);
    setDefaultsApplied(false);
  }, [cardType]);

  // Derived data — resolve field & option labels for the current locale
  const selectFields = useMemo(() => {
    const raw = data ? pickSelectFields(data.fields_schema) : [];
    return raw.map((f) => ({
      ...f,
      label: rl(f.key, f.translations),
      options: f.options?.map((o) => ({
        ...o,
        label: rl(o.key, o.translations),
      })),
    }));
  }, [data, rl]);

  // Build group-by options from schema + relation types
  const groupByOptions = useMemo(() => {
    if (!data) return [];
    const opts: { key: string; label: string; icon: string }[] = [];

    // Attribute-based grouping (single_select fields)
    for (const f of selectFields) {
      if (f.options && f.options.length > 0) {
        opts.push({ key: `attr:${f.key}`, label: f.label, icon: "tune" });
      }
    }

    // Relation-based grouping
    for (const [typeKey, members] of Object.entries(data.groupable_types)) {
      if (members.length > 0) {
        const typeMeta = metamodelTypes.find((t) => t.key === typeKey);
        const label = rml(typeMeta?.key ?? "", typeMeta?.translations, "label") || typeKey;
        const icon = typeMeta?.icon || "link";
        opts.push({ key: `rel:${typeKey}`, label, icon });
      }
    }

    // Stakeholder-role grouping — only when the type defines roles AND at
    // least one card has stakeholders, otherwise the option just yields an
    // empty view.
    const hasStakeholderAssignments = data.items.some(
      (a) => (a.stakeholders || []).length > 0,
    );
    if ((data.stakeholder_roles || []).length > 0 && hasStakeholderAssignments) {
      opts.push({
        key: "sh:roles",
        label: t("portfolio.groupBy.stakeholderRole"),
        icon: "groups",
      });
    }

    return opts;
  }, [data, selectFields, metamodelTypes, rml, t]);

  // Apply defaults once data is available. Skip when `data` is stale (loaded
  // for a previous card type) — otherwise we'd pick options from the old
  // type's schema right after the user switches types.
  useEffect(() => {
    if (!data || dataCardType !== cardType || defaultsApplied) return;
    // Set defaults from first available options
    if (!groupByRaw && groupByOptions.length > 0) {
      setGroupByRaw(groupByOptions[0].key);
    }
    if (!colorBy && selectFields.length > 0) {
      setColorBy(selectFields[0].key);
    }
    setDefaultsApplied(true);
  }, [data, dataCardType, cardType, groupByOptions, selectFields, defaultsApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ensure groupByRaw has a valid default
  const groupByKey = useMemo(() => {
    if (groupByRaw && groupByOptions.find((o) => o.key === groupByRaw)) return groupByRaw;
    return groupByOptions[0]?.key || "";
  }, [groupByRaw, groupByOptions]);

  const groupByMode = useMemo<GroupByMode>(() => {
    if (groupByKey.startsWith("attr:")) {
      return { kind: "attribute", fieldKey: groupByKey.slice(5) };
    }
    if (groupByKey === "sh:roles") {
      return { kind: "stakeholder_role" };
    }
    return { kind: "relation", typeKey: groupByKey.slice(4) };
  }, [groupByKey]);

  // Color-by options: all single_select fields + "none"
  const colorByOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [
      { key: "", label: t("portfolio.noColor") },
    ];
    for (const f of selectFields) {
      opts.push({ key: f.key, label: f.label });
    }
    return opts;
  }, [selectFields, t]);

  // Timeline range
  const { dateRange, yearMarks, hasLifecycleData } = useMemo(() => {
    const now = tl.todayMs;
    const pad3y = 3 * 365.25 * 86400000;
    const empty = {
      dateRange: { min: now - pad3y, max: now + pad3y },
      yearMarks: [] as { value: number; label: string }[],
      hasLifecycleData: false,
    };
    if (!data) return empty;

    let minD = Infinity;
    let maxD = -Infinity;
    let hasLC = false;
    for (const app of data.items) {
      const lc = app.lifecycle || {};
      for (const p of LIFECYCLE_PHASES) {
        const d = parseDate(lc[p]);
        if (d != null) {
          minD = Math.min(minD, d);
          maxD = Math.max(maxD, d);
          hasLC = true;
        }
      }
    }

    if (!hasLC) return empty;

    const pad = 365.25 * 86400000;
    minD -= pad;
    maxD += pad;
    const marks: { value: number; label: string }[] = [];
    const sy = new Date(minD).getFullYear();
    const ey = new Date(maxD).getFullYear();
    for (let y = sy; y <= ey + 1; y++) {
      const t = new Date(y, 0, 1).getTime();
      if (t >= minD && t <= maxD) marks.push({ value: t, label: String(y) });
    }

    return { dateRange: { min: minD, max: maxD }, yearMarks: marks, hasLifecycleData: hasLC };
  }, [data, tl.todayMs]);

  // Build filters state
  const filters = useMemo<FilterState>(
    () => ({
      attributeFilters: attrFilters,
      relationFilters,
      tagFilterIds,
      tagGroups: data?.tag_groups || [],
      timelineDate: tl.timelineDate,
      search,
      stakeholderUserIds,
      stakeholderRoleKeys,
    }),
    [attrFilters, relationFilters, tagFilterIds, data, tl.timelineDate, search, stakeholderUserIds, stakeholderRoleKeys],
  );

  // Filtered apps
  const filteredApps = useMemo(() => {
    if (!data) return [];
    return data.items.filter((a) => matchesFilters(a, filters));
  }, [data, filters]);

  // Grouped data
  const { groups, ungrouped } = useMemo(() => {
    if (!data) return { groups: [], ungrouped: [] };
    // For stakeholder-role grouping, only the roles the user selected (if
    // any) drive the visible tiles — same intent as a "show only these
    // roles" toggle. Empty selection means all roles.
    const stakeholderRoles =
      groupByMode.kind === "stakeholder_role" && stakeholderRoleKeys.length > 0
        ? (data.stakeholder_roles || []).filter((r) => stakeholderRoleKeys.includes(r.key))
        : data.stakeholder_roles || [];
    return groupApps(
      filteredApps,
      groupByMode,
      selectFields,
      data.groupable_types,
      stakeholderRoles,
    );
  }, [filteredApps, groupByMode, selectFields, data, stakeholderRoleKeys]);

  // Color-by distribution for the ungrouped section
  const ungroupedColorSegments = useMemo(() => {
    if (!colorBy || ungrouped.length === 0) return [];
    const fd = selectFields.find((f) => f.key === colorBy);
    const counts = new Map<string, { color: string; label: string; n: number }>();
    for (const app of ungrouped) {
      const val = (app.attributes || {})[colorBy] as string | undefined;
      const optKey = val || "__unset__";
      if (!counts.has(optKey)) {
        const opt = val ? fd?.options?.find((o) => o.key === val) : undefined;
        counts.set(optKey, {
          color: opt?.color || UNSET_COLOR,
          label: opt?.label || t("portfolio.notSet"),
          n: 0,
        });
      }
      counts.get(optKey)!.n += 1;
    }
    return Array.from(counts.values()).filter((s) => s.n > 0);
  }, [colorBy, ungrouped, selectFields, t]);

  // Summary stats
  const stats = useMemo(() => {
    const total = filteredApps.length;
    const withEol = filteredApps.filter(
      (a) => a.lifecycle?.endOfLife,
    ).length;
    return { total, withEol };
  }, [filteredApps]);

  // Color legend — built dynamically from schema
  const colorLegend = useMemo(() => {
    if (!colorBy) return null;
    const fd = selectFields.find((f) => f.key === colorBy);
    if (!fd?.options) return null;
    return fd.options
      .filter((o) => o.color)
      .map((o) => ({ label: o.label, color: o.color! }));
  }, [colorBy, selectFields]);

  const hasActiveFilters =
    Object.values(attrFilters).some((v) => v.length > 0) ||
    Object.values(relationFilters).some((v) => v.length > 0) ||
    tagFilterIds.length > 0 ||
    stakeholderUserIds.length > 0 ||
    stakeholderRoleKeys.length > 0 ||
    search.length > 0;

  // In stakeholder-role mode, most cards land in `ungrouped` whenever they
  // have no stakeholders. Showing them by default would drown the view, so
  // the user opts in via the "Include unassigned" toggle. Every other mode
  // keeps the legacy "always show" behaviour.
  const showUngrouped =
    groupByMode.kind === "stakeholder_role" ? includeUnassigned : true;
  const visibleUngrouped = showUngrouped ? ungrouped : [];

  const clearFilters = useCallback(() => {
    setAttrFilters({});
    setRelationFilters({});
    setTagFilterIds([]);
    setStakeholderUserIds([]);
    setStakeholderRoleKeys([]);
    setSearch("");
    tl.reset();
  }, [tl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAppClick = useCallback((id: string) => {
    setDrawer(null);
    setSidePanelCardId(id);
  }, []);

  // AI insights handler
  const handleGenerateInsights = useCallback(async () => {
    if (!data) return;
    setAiLoading(true);
    setAiError("");
    setAiOpen(true);
    try {
      // Build attribute distributions
      const attrDist: Record<string, Record<string, number>> = {};
      for (const f of selectFields) {
        const counts: Record<string, number> = {};
        for (const app of filteredApps) {
          const v = (app.attributes || {})[f.key] as string | undefined;
          const k = v || "Not set";
          counts[k] = (counts[k] || 0) + 1;
        }
        attrDist[f.label] = counts;
      }

      // Build lifecycle phase counts
      const lcCounts: Record<string, number> = {};
      for (const app of filteredApps) {
        const lc = app.lifecycle;
        if (!lc) {
          lcCounts["No lifecycle"] = (lcCounts["No lifecycle"] || 0) + 1;
          continue;
        }
        const now = Date.now();
        const phases = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];
        let current = "Unknown";
        for (const p of phases) {
          const d = lc[p] ? new Date(lc[p]).getTime() : null;
          if (d && d <= now) current = p;
        }
        lcCounts[current] = (lcCounts[current] || 0) + 1;
      }

      // Build group summaries
      const groupSummaries = groups.map((g) => {
        const breakdown: Record<string, number> = {};
        if (colorBy) {
          for (const app of g.apps) {
            const v = (app.attributes || {})[colorBy] as string | undefined;
            const k = v || "Not set";
            breakdown[k] = (breakdown[k] || 0) + 1;
          }
        }
        return { name: g.label, count: g.apps.length, breakdown };
      });

      // Build human-readable filter descriptions for AI context
      const activeFilterDescs: string[] = [];
      if (search) activeFilterDescs.push(`Search: "${search}"`);
      for (const [key, vals] of Object.entries(attrFilters)) {
        if (vals.length > 0) {
          const field = selectFields.find((f) => f.key === key);
          activeFilterDescs.push(`${field?.label || key}: ${vals.join(", ")}`);
        }
      }
      if (tl.timelineDate) activeFilterDescs.push(`Timeline date: ${tl.timelineDate}`);

      const res = await api.post<PortfolioInsightsResponse>("/ai/portfolio-insights", {
        total_apps: filteredApps.length,
        group_by: groupByRaw || null,
        color_by: colorBy || null,
        groups: groupSummaries,
        attribute_summary: attrDist,
        lifecycle_summary: lcCounts,
        active_filters: activeFilterDescs,
      });
      setAiInsights(res);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setAiLoading(false);
    }
  }, [data, filteredApps, groups, selectFields, colorBy, groupByRaw, attrFilters, search, tl.timelineDate, t]);

  const handleGroupClick = useCallback((g: GroupData) => {
    setDrawer({ label: g.label, apps: g.apps });
  }, []);

  // Build relation filter options from groupable_types
  const relationFilterOptions = useMemo(() => {
    if (!data) return [];
    const out: { typeKey: string; label: string; icon: string; options: { key: string; label: string }[] }[] = [];
    for (const [typeKey, members] of Object.entries(data.groupable_types)) {
      if (members.length === 0) continue;
      const typeMeta = metamodelTypes.find((t) => t.key === typeKey);
      out.push({
        typeKey,
        label: rml(typeMeta?.key ?? "", typeMeta?.translations, "label") || typeKey,
        icon: typeMeta?.icon || "link",
        options: members.map((m) => ({ key: m.id, label: m.name })),
      });
    }
    return out;
  }, [data, metamodelTypes]);

  // Table helpers
  const tableSort = (k: string) => {
    setSortD(sortK === k && sortD === "asc" ? "desc" : "asc");
    setSortK(k);
  };

  const tableSorted = useMemo(() => {
    const dir = sortD === "asc" ? 1 : -1;
    return [...filteredApps].sort((a, b) => {
      if (sortK === "name") return a.name.localeCompare(b.name) * dir;
      if (sortK === "subtype")
        return (a.subtype || "").localeCompare(b.subtype || "") * dir;
      // Attribute column
      const av = ((a.attributes || {})[sortK] as string) || "";
      const bv = ((b.attributes || {})[sortK] as string) || "";
      return av.localeCompare(bv) * dir;
    });
  }, [filteredApps, sortK, sortD]);

  const groupByLabel =
    groupByOptions.find((o) => o.key === groupByKey)?.label || t("common.group");

  const colorByLabel = colorByOptions.find((o) => o.key === colorBy)?.label || "";
  const activeFilterCount =
    Object.values(attrFilters).flat().length +
    Object.values(relationFilters).flat().length +
    tagFilterIds.length +
    stakeholderUserIds.length +
    stakeholderRoleKeys.length;

  // Visible card types — populates the optional type selector and resolves
  // the localised label of the currently-selected type for dynamic strings.
  const cardTypeOptions = useMemo(() => {
    return metamodelTypes
      .filter((tp) => !tp.is_hidden)
      .map((tp) => ({
        key: tp.key,
        label: rml(tp.key, tp.translations, "label") || tp.label || tp.key,
        icon: tp.icon || "category",
        color: tp.color,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metamodelTypes, rml]);
  const currentType = metamodelTypes.find((tp) => tp.key === cardType);
  const typeLabel =
    rml(cardType, currentType?.translations, "label") ||
    currentType?.label ||
    cardType;
  const typeIcon = currentType?.icon || "dashboard";
  const typeColor = currentType?.color || "#0f7eb5";

  // Title falls back to the legacy hardcoded "Application Portfolio" string
  // when the type is Application so existing screenshots/tests stay valid.
  const resolvedTitle = titleOverride
    ? titleOverride
    : showTypeSelector
      ? t("flexiblePortfolio.titleFor", { type: typeLabel })
      : cardType === "Application"
        ? t("portfolio.title")
        : t("flexiblePortfolio.titleFor", { type: typeLabel });

  // Group/ungrouped count chip — "{n} apps" for the legacy Application
  // Portfolio (preserves wording); "{n} {typeLabel}" once the user picks
  // a different type so the pill matches the cards on screen.
  const countLabel = useCallback(
    (n: number) =>
      cardType === "Application"
        ? t("portfolio.apps", { count: n })
        : `${n} ${typeLabel}`,
    [cardType, typeLabel, t],
  );

  // Noun used after the summary stat ("12 applications" vs "12 Business
  // Process"). Application Portfolio keeps the localised plural "applications"
  // string for back-compat; other types fall back to the singular type label.
  const typeNoun =
    cardType === "Application" ? t("portfolio.applications") : typeLabel;

  // Empty-state messages, parameterised by type for the Flexible Portfolio.
  const noItemsFiltered =
    cardType === "Application"
      ? t("portfolio.noAppsFiltered")
      : t("portfolio.noItemsFiltered", { type: typeLabel });
  const noItemsEmpty =
    cardType === "Application"
      ? t("portfolio.noAppsEmpty")
      : t("portfolio.noItemsEmpty", { type: typeLabel });
  const noItemsInGroup =
    cardType === "Application"
      ? t("portfolio.noAppsInGroup")
      : t("portfolio.noItemsInGroup", { type: typeLabel });

  const printParams = useMemo(() => {
    const params: { label: string; value: string }[] = [];
    params.push({ label: t("portfolio.groupBy"), value: groupByLabel });
    if (colorBy) params.push({ label: t("common.colorBy"), value: colorByLabel });
    if (search) params.push({ label: t("common.search"), value: search });
    if (tl.printParam) params.push(tl.printParam);
    if (view === "table") params.push({ label: t("common.view"), value: t("common.table") });
    if (activeFilterCount > 0) params.push({ label: t("common.filters"), value: t("common.filtersActive", { count: activeFilterCount }) });
    return params;
  }, [groupByLabel, colorBy, colorByLabel, search, tl.printParam, view, activeFilterCount, t]);

  if (!data)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <ReportShell
      title={resolvedTitle}
      icon={typeIcon}
      iconColor={typeColor}
      paginateRowSelector="[data-export-row]"
      view={view}
      onViewChange={setView}
      chartRef={chartRef}
      onSaveReport={captureAndSave}
      savedReportName={saved.savedReportName ?? undefined}
      onResetSavedReport={saved.resetSavedReport}
      onReset={handleReset}
      printParams={printParams}
      actions={
        aiStatus.portfolio_insights_enabled ? (
          <Tooltip title={t("portfolio.aiInsights")}>
            <span>
              <IconButton
                size="small"
                onClick={() => {
                  if (aiOpen) {
                    setAiOpen(false);
                  } else if (aiInsights) {
                    setAiOpen(true);
                  } else {
                    handleGenerateInsights();
                  }
                }}
                disabled={aiLoading || filteredApps.length === 0}
                sx={{ color: aiOpen ? "primary.main" : "#1976d2" }}
              >
                {aiLoading ? (
                  <CircularProgress size={18} />
                ) : (
                  <MaterialSymbol icon="auto_awesome" size={20} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        ) : undefined
      }
      toolbar={
        <>
          {/* Row 1: Main controls */}
          {showTypeSelector && (
            <TextField
              select
              size="small"
              label={t("flexiblePortfolio.cardType")}
              value={cardType}
              onChange={(e) => handleCardTypeChange(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              {cardTypeOptions.map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color={o.color || theme.palette.text.secondary} />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            select
            size="small"
            label={t("portfolio.groupBy")}
            value={groupByKey}
            onChange={(e) => setGroupByRaw(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {groupByOptions.length > 0 && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                {t("portfolio.attributes")}
              </MenuItem>
            )}
            {groupByOptions
              .filter((o) => o.key.startsWith("attr:"))
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color={theme.palette.text.secondary} />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
            {groupByOptions.some((o) => o.key.startsWith("rel:")) && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                {t("portfolio.relatedTypes")}
              </MenuItem>
            )}
            {groupByOptions
              .filter((o) => o.key.startsWith("rel:"))
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color={theme.palette.text.secondary} />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
            {groupByOptions.some((o) => o.key.startsWith("sh:")) && (
              <MenuItem disabled sx={{ opacity: 0.6, fontSize: "0.75rem", fontWeight: 600 }}>
                {t("portfolio.stakeholders")}
              </MenuItem>
            )}
            {groupByOptions
              .filter((o) => o.key.startsWith("sh:"))
              .map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon={o.icon} size={16} color={theme.palette.text.secondary} />
                    {o.label}
                  </Box>
                </MenuItem>
              ))}
          </TextField>

          <TextField
            select
            size="small"
            label={
              cardType === "Application"
                ? t("portfolio.colorAppsBy")
                : t("common.colorBy")
            }
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {colorByOptions.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            label={t("common.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 160 }}
            slotProps={{
              input: {
                startAdornment: (
                  <MaterialSymbol
                    icon="search"
                    size={18}
                    color="#999"
                  />
                ),
              },
            }}
          />

          {/* Timeline slider */}
          {hasLifecycleData && (
            <TimelineSlider
              value={tl.timelineDate}
              onChange={tl.setTimelineDate}
              dateRange={dateRange}
              yearMarks={yearMarks}
              todayMs={tl.todayMs}
            />
          )}

          {/* Row 2: Filters */}
          <Box sx={{ width: "100%", pt: 0.5 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 1,
              }}
            >
              <MaterialSymbol icon="filter_alt" size={16} color="#999" />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                {t("portfolio.typeFilters", { type: typeLabel })}
              </Typography>
              {hasActiveFilters && (
                <Chip
                  size="small"
                  label={t("portfolio.clearAll")}
                  variant="outlined"
                  onDelete={clearFilters}
                  sx={{ fontSize: "0.7rem", height: 22, ml: 0.5 }}
                />
              )}
            </Box>
            <Box
              sx={{
                display: "flex",
                gap: 2,
                flexWrap: "wrap",
              }}
            >
              {/* Related By section */}
              {relationFilterOptions.length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("portfolio.relatedBy")}
                  </Typography>
                  {relationFilterOptions.slice(0, showAllRelFilters ? undefined : 2).map((rf) => (
                    <FilterSelect
                      key={rf.typeKey}
                      label={rf.label}
                      options={rf.options}
                      value={relationFilters[rf.typeKey] || []}
                      onChange={(v) =>
                        setRelationFilters((prev) => ({ ...prev, [rf.typeKey]: v }))
                      }
                    />
                  ))}
                  {!showAllRelFilters && relationFilterOptions.length > 2 && (
                    <Tooltip title={t("portfolio.showMore", { count: relationFilterOptions.length - 2 })}>
                      <Chip
                        size="small"
                        icon={<MaterialSymbol icon="add" size={14} />}
                        label={t("portfolio.more", { count: relationFilterOptions.length - 2 })}
                        onClick={() => setShowAllRelFilters(true)}
                        sx={{
                          height: 26,
                          fontSize: "0.72rem",
                          fontWeight: 500,
                          cursor: "pointer",
                          bgcolor: "background.paper",
                          border: "1px dashed",
                          borderColor: "divider",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      />
                    </Tooltip>
                  )}
                  {showAllRelFilters && relationFilterOptions.length > 2 && (
                    <Chip
                      size="small"
                      label={t("portfolio.less")}
                      onClick={() => setShowAllRelFilters(false)}
                      sx={{
                        height: 26,
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                      }}
                    />
                  )}
                </Box>
              )}

              {/* Stakeholders section */}
              {((data?.stakeholder_roles || []).length > 0 ||
                (data?.stakeholder_users || []).length > 0) && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("portfolio.stakeholders")}
                  </Typography>
                  {(data?.stakeholder_users || []).length > 0 && (
                    <FilterSelect
                      label={t("portfolio.filter.stakeholderName")}
                      options={(data?.stakeholder_users || []).map((u) => ({
                        key: u.id,
                        label: u.display_name,
                      }))}
                      value={stakeholderUserIds}
                      onChange={setStakeholderUserIds}
                    />
                  )}
                  {(data?.stakeholder_roles || []).length > 0 && (
                    <FilterSelect
                      label={t("portfolio.filter.stakeholderRole")}
                      options={(data?.stakeholder_roles || []).map((r) => ({
                        key: r.key,
                        label: r.label,
                        color: r.color,
                      }))}
                      value={stakeholderRoleKeys}
                      onChange={setStakeholderRoleKeys}
                    />
                  )}
                  {groupByMode.kind === "stakeholder_role" && (
                    <FormControlLabel
                      sx={{ ml: 0.5, mr: 0 }}
                      control={
                        <Switch
                          size="small"
                          checked={includeUnassigned}
                          onChange={(e) => setIncludeUnassigned(e.target.checked)}
                        />
                      }
                      label={
                        <Typography variant="caption" sx={{ fontSize: "0.72rem" }}>
                          {t("portfolio.filter.includeUnassigned")}
                        </Typography>
                      }
                    />
                  )}
                </Box>
              )}

              {/* Tags section */}
              {(data?.tag_groups || []).length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("portfolio.tags")}
                  </Typography>
                  <TagPicker
                    groups={(data?.tag_groups || []) as unknown as TagGroup[]}
                    value={tagFilterIds}
                    onChange={setTagFilterIds}
                    size="small"
                    label={t("portfolio.tags")}
                    placeholder=""
                    sx={{ minWidth: 180, maxWidth: 320 }}
                  />
                </Box>
              )}

              {/* Own Fields section */}
              {selectFields.filter((f) => f.options && f.options.length > 0).length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                    bgcolor: "action.hover",
                    borderRadius: 1.5,
                    px: 1.5,
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}
                  >
                    {t("portfolio.fields")}
                  </Typography>
                  {selectFields
                    .filter((f) => f.options && f.options.length > 0)
                    .map((f) => (
                      <FilterSelect
                        key={f.key}
                        label={f.label}
                        options={(f.options || []).map((o) => ({
                          key: o.key,
                          label: o.label,
                          color: o.color,
                        }))}
                        value={attrFilters[f.key] || []}
                        onChange={(v) =>
                          setAttrFilters((prev) => ({ ...prev, [f.key]: v }))
                        }
                      />
                    ))}
                </Box>
              )}
            </Box>
          </Box>
        </>
      }
      legend={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          {/* Summary stats */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <MaterialSymbol icon={typeIcon} size={16} color={typeColor} />
              <Typography variant="caption" color="text.secondary">
                <strong>{stats.total}</strong> {typeNoun}
              </Typography>
            </Box>
            {stats.withEol > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <MaterialSymbol icon="warning" size={16} color="#e65100" />
                <Typography variant="caption" color="text.secondary">
                  <strong>{stats.withEol}</strong> {t("portfolio.withEol")}
                </Typography>
              </Box>
            )}
            {ungrouped.length > 0 && (
              <Chip
                size="small"
                label={`${ungrouped.length} ${t("portfolio.ungrouped")}`}
                color="warning"
                variant="outlined"
                sx={{ fontSize: "0.72rem" }}
              />
            )}
          </Box>

          {/* Color legend */}
          {colorBy && colorLegend && colorLegend.length > 0 && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                ml: 2,
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                {colorByOptions.find((o) => o.key === colorBy)?.label}:
              </Typography>
              {colorLegend.map((item) => (
                <Box
                  key={item.label}
                  sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                >
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: item.color,
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {item.label}
                  </Typography>
                </Box>
              ))}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: UNSET_COLOR,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {t("portfolio.notSet")}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      }
    >
      {/* AI Insights panel */}
      <Collapse in={aiOpen}>
        <Paper
          sx={{
            p: 2,
            mb: 2,
            border: 1,
            borderColor: "primary.main",
            bgcolor: alpha(theme.palette.primary.main, 0.03),
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <MaterialSymbol icon="insights" size={20} color={theme.palette.primary.main} />
            <Typography variant="subtitle2" fontWeight={700}>
              {t("portfolio.aiInsightsTitle")}
            </Typography>
            {aiInsights?.model && (
              <Chip label={aiInsights.model} size="small" variant="outlined" sx={{ ml: "auto" }} />
            )}
            <IconButton size="small" onClick={() => setAiOpen(false)} sx={{ ml: aiInsights?.model ? 0 : "auto" }}>
              <MaterialSymbol icon="close" size={18} />
            </IconButton>
          </Box>

          {aiLoading && <LinearProgress sx={{ mb: 1 }} />}

          {aiError && (
            <Alert severity="error" sx={{ mb: 1 }} onClose={() => setAiError("")}>
              {aiError}
            </Alert>
          )}

          {aiInsights && aiInsights.insights.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {aiInsights.insights
                .filter((ins) => typeof ins !== "string")
                .map((insight, i) => {
                const si = insight as StructuredInsight;
                return (
                  <Paper
                    key={i}
                    variant="outlined"
                    sx={{ p: 1.5 }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
                      <MaterialSymbol icon="lightbulb" size={18} color={theme.palette.primary.main} />
                      <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
                        {si.title}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                      {si.observation}
                    </Typography>
                    {si.recommendation && (
                      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mt: 0.5 }}>
                        <MaterialSymbol icon="subdirectory_arrow_right" size={16} color={theme.palette.primary.main} style={{ marginTop: 2 }} />
                        <Typography variant="body2" color="primary.dark" fontWeight={500}>
                          {si.recommendation}
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                );
              })}
            </Box>
          )}

          {aiInsights && aiInsights.insights.length === 0 && !aiLoading && (
            <Typography variant="body2" color="text.secondary">
              {t("portfolio.aiNoInsights")}
            </Typography>
          )}

          {aiInsights && !aiLoading && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MaterialSymbol icon="refresh" size={16} />}
                sx={{ textTransform: "none" }}
                onClick={handleGenerateInsights}
              >
                {t("portfolio.aiRegenerate")}
              </Button>
            </Box>
          )}
        </Paper>
      </Collapse>

      {view === "chart" ? (
        <>
          {groups.length === 0 && visibleUngrouped.length === 0 ? (
            <Box sx={{ py: 8, textAlign: "center" }}>
              <Typography color="text.secondary">
                {hasActiveFilters ? noItemsFiltered : noItemsEmpty}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Group cards grid */}
              <Box
                className="report-print-grid-4"
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "1fr 1fr",
                    md: "1fr 1fr 1fr",
                    lg: "1fr 1fr 1fr 1fr",
                  },
                  gap: 2,
                }}
              >
                {groups.map((g) => (
                  <Box key={g.key} data-export-row>
                    <GroupCard
                      group={g}
                      colorBy={colorBy}
                      selectFields={selectFields}
                      onGroupClick={handleGroupClick}
                      onAppClick={handleAppClick}
                      countLabel={countLabel}
                    />
                  </Box>
                ))}
              </Box>

              {/* Ungrouped section */}
              {visibleUngrouped.length > 0 && (
                <Box
                  sx={{
                    border: "1px dashed",
                    borderColor: "divider",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: "action.hover",
                      borderBottom: "1px dashed",
                      borderColor: "divider",
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                    onClick={() =>
                      setDrawer({
                        label: t("portfolio.ungroupedLabel", { groupBy: groupByLabel }),
                        apps: ungrouped,
                      })
                    }
                  >
                    <MaterialSymbol
                      icon="help_outline"
                      size={18}
                      color="#999"
                    />
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 600, color: "text.secondary", flex: 1 }}
                    >
                      {t("portfolio.notAssignedTo", { groupBy: groupByLabel })}
                    </Typography>
                    <Chip
                      size="small"
                      label={countLabel(ungrouped.length)}
                      sx={{
                        height: 22,
                        fontSize: "0.72rem",
                        bgcolor: (t) => alpha(t.palette.warning.main, 0.12),
                        color: "warning.dark",
                        fontWeight: 600,
                      }}
                    />
                  </Box>
                  {/* Color-by stacked bar */}
                  {ungroupedColorSegments.length > 0 && (
                    <Tooltip
                      title={ungroupedColorSegments
                        .map(
                          (s) =>
                            `${s.label}: ${s.n} (${Math.round((s.n / ungrouped.length) * 100)}%)`,
                        )
                        .join(" · ")}
                    >
                      <Box sx={{ height: 6, display: "flex" }}>
                        {ungroupedColorSegments.map((s, i) => (
                          <Box
                            key={i}
                            sx={{
                              height: "100%",
                              width: `${(s.n / ungrouped.length) * 100}%`,
                              bgcolor: s.color,
                              transition: "width 0.3s",
                            }}
                          />
                        ))}
                      </Box>
                    </Tooltip>
                  )}
                  <Box
                    sx={{
                      p: 1.5,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 0.5,
                    }}
                  >
                    {ungrouped
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((app) => (
                        <AppChip
                          key={app.id}
                          app={app}
                          colorBy={colorBy}
                          selectFields={selectFields}
                          onClick={() => handleAppClick(app.id)}
                        />
                      ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </>
      ) : (
        /* Table view */
        <Paper variant="outlined" sx={{ overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "name"}
                    direction={sortK === "name" ? sortD : "asc"}
                    onClick={() => tableSort("name")}
                  >
                    {t("common:labels.name")}
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortK === "subtype"}
                    direction={sortK === "subtype" ? sortD : "asc"}
                    onClick={() => tableSort("subtype")}
                  >
                    {t("common:labels.subtype")}
                  </TableSortLabel>
                </TableCell>
                {groupByMode.kind === "attribute" && (
                  <TableCell>
                    <TableSortLabel
                      active={sortK === groupByMode.fieldKey}
                      direction={
                        sortK === groupByMode.fieldKey ? sortD : "asc"
                      }
                      onClick={() => tableSort(groupByMode.fieldKey)}
                    >
                      {groupByLabel}
                    </TableSortLabel>
                  </TableCell>
                )}
                {groupByMode.kind === "relation" && (
                  <TableCell>{groupByLabel}</TableCell>
                )}
                {groupByMode.kind === "stakeholder_role" && (
                  <TableCell>{groupByLabel}</TableCell>
                )}
                {colorBy && (
                  <TableCell>
                    <TableSortLabel
                      active={sortK === colorBy}
                      direction={sortK === colorBy ? sortD : "asc"}
                      onClick={() => tableSort(colorBy)}
                    >
                      {colorByOptions.find((o) => o.key === colorBy)?.label ||
                        t("common.colorBy")}
                    </TableSortLabel>
                  </TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {tableSorted.map((app) => {
                const attrs = app.attributes || {};
                const groupVal =
                  groupByMode.kind === "attribute"
                    ? (() => {
                        const val = attrs[groupByMode.fieldKey] as string;
                        const fd = selectFields.find(
                          (f) => f.key === groupByMode.fieldKey,
                        );
                        return (
                          fd?.options?.find((o) => o.key === val)?.label ||
                          val ||
                          "\u2014"
                        );
                      })()
                    : groupByMode.kind === "stakeholder_role"
                      ? (() => {
                          const sh = app.stakeholders || [];
                          if (sh.length === 0) return "\u2014";
                          const roleLabels = new Map<string, string>();
                          for (const r of data?.stakeholder_roles || []) {
                            roleLabels.set(r.key, r.label);
                          }
                          return sh
                            .map((s) => {
                              const role = roleLabels.get(s.role) || s.role;
                              return `${s.user_display_name} (${role})`;
                            })
                            .join(", ");
                        })()
                      : app.relations
                          .filter(
                            (r) => r.related_type === groupByMode.typeKey,
                          )
                          .map((r) => r.related_name)
                          .join(", ") || "\u2014";
                const colorVal = colorBy
                  ? getAppColorLabel(app, colorBy, selectFields) || "\u2014"
                  : null;
                const colorDot = colorBy
                  ? getAppColor(app, colorBy, selectFields)
                  : null;

                return (
                  <TableRow
                    key={app.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => setSidePanelCardId(app.id)}
                  >
                    <TableCell sx={{ fontWeight: 500 }}>
                      {app.name}
                    </TableCell>
                    <TableCell>{app.subtype || "\u2014"}</TableCell>
                    <TableCell>{groupVal}</TableCell>
                    {colorBy && (
                      <TableCell>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                          }}
                        >
                          <Box
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              bgcolor: colorDot,
                            }}
                          />
                          {colorVal}
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Detail drawer */}
      <Drawer
        anchor="right"
        open={!!drawer}
        onClose={() => setDrawer(null)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}
      >
        {drawer && (
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
                {drawer.label}
              </Typography>
              <IconButton onClick={() => setDrawer(null)}>
                <MaterialSymbol icon="close" size={20} />
              </IconButton>
            </Box>

            {/* Summary metrics */}
            <Box sx={{ display: "flex", gap: 3, mb: 2 }}>
              <Box sx={{ textAlign: "center", minWidth: 80 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {drawer.apps.length}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {typeNoun}
                </Typography>
              </Box>
              {drawer.apps.filter((a) => a.lifecycle?.endOfLife).length > 0 && (
                <Box sx={{ textAlign: "center", minWidth: 80 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: "#e65100" }}>
                    {drawer.apps.filter((a) => a.lifecycle?.endOfLife).length}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("portfolio.eolRisk")}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Application list */}
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, mb: 1 }}
            >
              {typeNoun} ({drawer.apps.length})
            </Typography>
            <List dense>
              {drawer.apps
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => {
                  // Build secondary text dynamically from active color/group fields
                  const parts: string[] = [];
                  if (a.subtype) parts.push(a.subtype);
                  if (colorBy) {
                    const lbl = getAppColorLabel(a, colorBy, selectFields);
                    if (lbl) parts.push(lbl);
                  }
                  if (a.lifecycle?.endOfLife) parts.push(`EOL: ${a.lifecycle.endOfLife}`);

                  return (
                    <ListItemButton
                      key={a.id}
                      onClick={() => handleAppClick(a.id)}
                    >
                      <ListItemText
                        primary={a.name}
                        secondary={parts.join(" \u00B7 ") || undefined}
                      />
                      {colorBy && (
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            bgcolor: getAppColor(a, colorBy, selectFields),
                            flexShrink: 0,
                            ml: 1,
                          }}
                        />
                      )}
                      {a.lifecycle?.endOfLife && (
                        <MaterialSymbol
                          icon="warning"
                          size={16}
                          color="#e65100"
                        />
                      )}
                    </ListItemButton>
                  );
                })}
              {drawer.apps.length === 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ py: 2, textAlign: "center" }}
                >
                  {noItemsInGroup}
                </Typography>
              )}
            </List>
          </Box>
        )}
      </Drawer>
      <CardDetailSidePanel
        cardId={sidePanelCardId}
        open={!!sidePanelCardId}
        onClose={() => setSidePanelCardId(null)}
      />
      <SaveReportDialog
        open={saved.saveDialogOpen}
        onClose={() => saved.setSaveDialogOpen(false)}
        reportType={savedReportKey}
        config={getConfig()}
        thumbnail={thumbnail}
      />
    </ReportShell>
  );
}
