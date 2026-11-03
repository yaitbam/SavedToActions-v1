// Shapes from docs/API_MAP.md only. Times are server display strings, never converted in the browser.

export type Nullable<T> = T | null;

export interface AuthStatus {
  configured: boolean;
  connected: boolean;
  hasRefreshToken: boolean;
  missingScopes: string[];
}

export interface Settings {
  workStart: string;
  workEnd: string;
  tz: Nullable<string>;
  ignoreAllDay: boolean;
}

export interface GoalMetrics {
  importedSaves: number;
  demoSaves: number;
  planned: number;
  markedDone: number;
  savesWithDoneAction: number;
  deadlinePassedWithoutCompletion: number;
  actionRate: Nullable<number>;
  timeScheduledMin: number;
}

export interface Goal {
  id: number;
  name: string;
  metrics: GoalMetrics;
}

export interface Slot {
  startUtc: string;
  endUtc: string;
  tz: string;
  durationMin: number;
  startDisplay: string;
  endDisplay: string;
}

export interface SlotLabel extends Slot {
  label?: string;
}

export interface ReadbackDriftDisplay {
  field: string;
  expectedDisplay: string;
  actualDisplay: string;
}

export interface Readback {
  status: Nullable<"ok" | "drift" | "failed">;
  at: Nullable<string>;
  atDisplay: Nullable<string>;
  drift: Array<{ field: string; expected: unknown; actual: unknown }>;
  driftDisplay: ReadbackDriftDisplay[];
  error: Nullable<string>;
}

export interface Block extends Slot {
  id: number;
  actionId: number;
  googleEventId: Nullable<string>;
  idempotencyKey: string;
  supersededBy: Nullable<number>;
  cancelledAt: Nullable<string>;
  eventDeletedAt: Nullable<string>;
  readback: Nullable<Readback>;
}

export type CheckState = "green" | "amber" | "red" | "needs_input" | "error";

export interface Check {
  id: number;
  blockId: number;
  checkedAt: string;
  checkedAtDisplay: string;
  source: "manual" | "watcher";
  state: CheckState;
  reason: Nullable<string>;
  tz: string;
  explanation: string[];
  conflicts: Array<{ title?: string; startDisplay: string; endDisplay: string }>;
  problems: string[];
  alternative: Nullable<Slot>;
  hints: unknown;
  latestFeasibleStart: Nullable<SlotLabel>;
  ownEventFound: boolean;
  deadline: Nullable<{ utc: string; display: string }>;
}

export type ActionStatus = "open" | "planned" | "done" | "skipped";
export type ActionKind = "try" | "opportunity" | "other";

export interface Deadline {
  wall: string;
  tz: string;
  tzSource: string;
  tzSourceLabel: string;
  utc: string;
  display: string;
  label: Nullable<string>;
  quote: Nullable<string>;
  yearAssumed: boolean;
}

interface Sourced {
  matches: { note: boolean; transcription: boolean };
  badge: Nullable<string>;
  badgeLabel: Nullable<string>;
}

export interface Evidence extends Sourced {
  quote: Nullable<string>;
}

export interface VerbatimItem extends Sourced {
  type: "prompt" | "link" | "keyword";
  text: string;
}

export interface EventDate extends Sourced {
  text: string;
  start: Nullable<string>;
  end: Nullable<string>;
}

export interface Effort {
  suggestedMin: Nullable<number>;
  confirmedMin: Nullable<number>;
  confirmed: boolean;
  label: Nullable<"Model estimate" | "Your estimate">;
  scheduledMin: number;
}

export interface ActionWarning {
  code: string;
  field?: string;
  proposed?: unknown;
}

export interface Action {
  id: number;
  saveId: number;
  status: ActionStatus;
  goalId: Nullable<number>;
  kind: ActionKind;
  label: Nullable<"claim" | "validate" | "read" | "someday">;
  title: Nullable<string>;
  note: Nullable<string>;
  transcription: Nullable<string>;
  screenshotUrl: string;
  isDemo: boolean;
  block: Nullable<Block>;
  check: Nullable<Check>;
  doneAt: Nullable<string>;
  doneAtDisplay: Nullable<string>;
  deadline: Nullable<Deadline>;
  eventDates: EventDate[];
  deliverables: string[];
  verbatimItems: VerbatimItem[];
  evidence: Evidence;
  effort: Effort;
  edited: string[];
  warnings: ActionWarning[];
  model: Nullable<string>;
  createdAt: string;
}

export interface ActionPatch {
  title?: string;
  goalId?: Nullable<number>;
  kind?: ActionKind;
  label?: Nullable<string>;
  deliverables?: string[];
  verbatimItems?: Array<{ type: string; text: string }>;
  eventDates?: Array<{ text: string; start?: string; end?: string }>;
  evidenceQuote?: string;
  deadline?: Nullable<{ wall: string; tz?: string; label?: string }>;
  confirmedEffortMin?: Nullable<number>;
}

export interface SaveCreated {
  saveId: number;
  action: Action;
  extraction: { ms: number; usage: unknown; image: unknown };
}

export interface SaveCreatedAsync {
  saveId: number;
  jobId: number;
  extractionStatus: string;
  statusUrl: string;
}

export interface ExtractionJob {
  id: number;
  state: "queued" | "running" | "done" | "failed";
}

export interface SaveListItem {
  saveId: number;
  note: Nullable<string>;
  importedAt: string;
  importedAtDisplay: string;
  screenshotUrl: string;
  isDemo: boolean;
  extraction: unknown;
  jobId: Nullable<number>;
  action: Nullable<Action>;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface SaveDetail {
  saveId: number;
  note: Nullable<string>;
  importedAt: string;
  importedAtDisplay: string;
  isDemo: boolean;
  screenshotUrl: string;
  extractionStatus: string;
  job: unknown;
  action: Nullable<Action>;
}

export interface ActionList extends Page<Action> {
  countsByView: { all: number; risk: number; later: number };
}

export interface ActionQuery {
  q?: string;
  goal?: number;
  kind?: ActionKind;
  status?: string;
  has_deadline?: boolean;
  saved?: "all" | "risk" | "later" | "week";
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface ProposeFound {
  mode: "new" | "move";
  found: true;
  slot: Slot;
  source: "events" | "freebusy";
  latestFeasibleStart: Nullable<SlotLabel>;
}

export interface ProposeNotFound {
  mode: "new" | "move";
  found: false;
  reason: string;
  hints: unknown;
  explanation: string[];
  source: string;
}

export type ProposeResult = ProposeFound | ProposeNotFound;

export interface AgentPlan {
  traceId: number;
  outcome: "proposed" | "rejected" | "no_slot" | "max_turns";
  mode: "new" | "move";
  proposal: Nullable<Slot>;
  rationale: unknown;
  rejected: unknown[];
  fallback: Nullable<Slot>;
  noSlot: Nullable<{ reason: string; explanation: string[] }>;
  failure: unknown;
  usage: unknown;
  turns: number;
  approveWith: Nullable<{ endpoint: "approve" | "move"; startUtc: string; endUtc: string }>;
  note: Nullable<string>;
}

export interface ApproveResult {
  replayed: boolean;
  action: Action;
  block: Block;
}

export interface MoveResult {
  action: Action;
  block: Block;
  previous: { id: number; eventDeleted: boolean; deleteError: Nullable<string> };
}

export interface RecheckResult {
  check: Check;
  action: Action;
}

export interface RecheckAllResult {
  results: Array<{
    actionId: number;
    ok: boolean;
    status: number;
    check?: Check;
    action?: Action;
    error?: string;
  }>;
  calendarUnchanged: true;
}

export interface SkipResult {
  action: Action;
  calendar: { hadBlock: boolean; removed: boolean; removeError: Nullable<string> };
}

export interface TraceSummary {
  id: number;
  actionId: number;
  createdAt: string;
  finishedAt: Nullable<string>;
  instruction: Nullable<string>;
  outcome: Nullable<string>;
  model: Nullable<string>;
  turns: number;
}

export interface TraceStep {
  n: number;
  at: string;
  ms: Nullable<number>;
  type: string;
  [key: string]: unknown;
}

export interface Trace extends TraceSummary {
  result: unknown;
  steps: TraceStep[];
}

export interface HomeSummary {
  id: number;
  saveId: number;
  title: Nullable<string>;
  kind: ActionKind;
  status: ActionStatus;
  goalId: Nullable<number>;
  isDemo: boolean;
  screenshotUrl: string;
  deadline: Nullable<Deadline>;
  effort: Effort;
  block: Nullable<Block>;
  check: Nullable<Check>;
  warnings: string[];
}

export type AttentionState =
  | "red"
  | "amber"
  | "needs_input"
  | "error"
  | "readback_drift"
  | "readback_failed";

export interface HomeAttention {
  action: HomeSummary;
  state: AttentionState;
  reason: string;
  text: string;
  reasons: string[];
}

export interface HomeRecentSave {
  saveId: number;
  importedAt: string;
  importedAtDisplay: string;
  note: Nullable<string>;
  screenshotUrl: string;
  isDemo: boolean;
  extraction: unknown;
  action: Nullable<HomeSummary>;
}

export interface Home {
  now: { utc: string; tz: Nullable<string>; display: string };
  google_connected: boolean;
  connected_email: Nullable<string>;
  next_up: Nullable<HomeSummary>;
  upcoming: Array<HomeSummary & { state?: string }>;
  needs_attention: HomeAttention[];
  recent_saves: HomeRecentSave[];
  inbox_count: number;
  inbox: { needs_effort: number; failed_extractions: number };
  alerts_count: number;
  metric_definitions: Record<string, string>;
}

export interface WeekChip {
  title: string;
  kind: "busy" | "prep";
  left: number;
  width: number;
  startDisplay: string;
  endDisplay: string;
}

export interface WeekDay {
  date: string;
  label: string;
  startDisplay: string;
  endDisplay: string;
  now: boolean;
  deadline: boolean;
  chips: WeekChip[];
}

export interface Week {
  tz: string;
  days: WeekDay[];
  maxDays: number;
  weekLabel: string;
  previousDate: string;
  nextDate: string;
  todayDate: string;
}

export interface Insights {
  totals: {
    importedSaves: number;
    markedDone: number;
    savesWithDoneAction: number;
    actionRate: Nullable<number>;
    deadlinePassedWithoutCompletion: number;
    timeScheduledMin: number;
    demoSaves: number;
  };
  weekly: Array<{
    weekStart: string;
    label: string;
    importedSaves: number;
    doneSaves: number;
    actionRate: Nullable<number>;
  }>;
  goals: Goal[];
  kinds: Array<{ name: string; count: number }>;
  definitions: Record<string, string>;
  seriesNote: Nullable<string>;
}
