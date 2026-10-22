import { create } from "zustand";
import {
  type ClassifiedStatement,
  type Column,
  type EngineError,
  type ExecutedStatement,
  type ExtractorKind,
  type RowRange,
  type SortKey,
  type TransactionMode,
  type TransactionState,
} from "@table-craft/desktop/engine/protocol.js";
import type { HistoryEntry } from "@table-craft/desktop/preload/bridge.js";
import type { EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { carriedLayout, type ColumnLayout } from "@table-craft/desktop/renderer/model/columnLayout.js";
import { executedText, explainedText, exportedText, firstLine } from "@table-craft/desktop/renderer/model/format.js";
import { clampSelection, type GridSelection } from "@table-craft/desktop/renderer/model/gridSelection.js";
import { statementsToRun, type RunScope, type TextSpan } from "@table-craft/desktop/renderer/model/statementAt.js";
import { useCatalog } from "@table-craft/desktop/renderer/state/catalog.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import {
  useExecutions,
  type ExecutionEnd,
  type ExecutionReporter,
} from "@table-craft/desktop/renderer/state/executions.js";
import { history } from "@table-craft/desktop/renderer/state/history.js";
import { useModal, type ModalRequest } from "@table-craft/desktop/renderer/state/modal.js";
import {
  planTabOf,
  resultTabOf,
  type AnalysedEffect,
  type ConsoleTab,
  type PlanTab,
  type ResultTab,
} from "@table-craft/desktop/renderer/state/resultTab.js";
import { createResultWindows, toError } from "@table-craft/desktop/renderer/state/resultWindows.js";

export {
  ANALYSED_PLAN_TITLE,
  MAX_LOADED_WINDOWS,
  PLAN_TITLE,
  planTabOf,
  resultTabOf,
  rowAt,
  windowOffsetOf,
  withWindow,
  type AnalysedEffect,
  type ConsoleTab,
  type PlanTab,
  type PlanView,
  type ResultFetch,
  type ResultTab,
} from "@table-craft/desktop/renderer/state/resultTab.js";
export { canFetch, toError } from "@table-craft/desktop/renderer/state/resultWindows.js";

/**
 * One console's session. `failed` when it could not open and `disconnected` when its engine went
 * away or it was restored at launch; Run opens a new session from either.
 */
export type ConsoleStatus = "connecting" | "ready" | "running" | "failed" | "disconnected";

export type OutputTone = "info" | "success" | "warning" | "error";

export interface OutputEntry {
  readonly id: number;
  /** Wall-clock time, for the log's `12:04:31` column. */
  readonly at: number;
  /** The statement's first line, or empty when the entry is about no statement. */
  readonly sql: string;
  readonly message: string;
  readonly hint: string | null;
  readonly tone: OutputTone;
}

export type RunOutcome = "succeeded" | "failed" | "cancelled";

export interface LastRun {
  readonly durationMs: number;
  readonly outcome: RunOutcome;
}

/** The statement being run, for the editor to flash; `seq` changes on every statement. */
export interface Flash extends TextSpan {
  readonly seq: number;
}

export interface ConsoleSession {
  readonly datasourceId: string;
  /** The console's file name without `.sql` (decision 16). */
  readonly name: string;
  readonly sessionId: string | null;
  readonly status: ConsoleStatus;
  readonly error: EngineError | null;
  readonly sql: string;
  /** The editor's main selection; empty is a caret. */
  readonly selection: TextSpan;
  readonly results: readonly ConsoleTab[];
  /** `OUTPUT_TAB` or a result or plan tab's id. */
  readonly activeResult: string;
  /** Newest last, at most `OUTPUT_LIMIT` entries; never written to disk. */
  readonly output: readonly OutputEntry[];
  readonly txMode: TransactionMode;
  readonly transactionOpen: boolean;
  readonly lastRun: LastRun | null;
  readonly flash: Flash | null;
  /** Where an action asked the editor to put its caret; `seq` repeats a jump to the same place. */
  readonly jump: Flash | null;
  /** Text an action asked the editor to put at its selection; the editor clears it once applied. */
  readonly insertion: Insertion | null;
}

export interface Insertion {
  readonly text: string;
  readonly seq: number;
}

export interface OpenOptions {
  readonly name?: string;
  readonly sql?: string;
  /** False for a console restored at launch: it stays disconnected until its first Run. */
  readonly connect?: boolean;
}

export interface ConsolesState {
  readonly consoles: Readonly<Record<string, ConsoleSession>>;
  /** Adds a console on `datasourceId`, opening its session unless `connect` is false. */
  readonly open: (id: string, datasourceId: string, options?: OpenOptions) => Promise<void>;
  /** Forgets the console and closes its session, which releases its results. */
  readonly close: (id: string) => void;
  /** Marks the datasource's consoles disconnected; `error` says why when it was not asked for. */
  readonly detach: (datasourceId: string, error: EngineError | null) => void;
  readonly setSql: (id: string, sql: string) => void;
  readonly setSelection: (id: string, selection: TextSpan) => void;
  /** Puts the editor's caret at `span.from` and flashes `span`, as Go to Declaration lands. */
  readonly jumpTo: (id: string, span: TextSpan) => void;
  /** Asks the editor to replace its selection with `text`, or insert it at the caret, as one undo step. */
  readonly insert: (id: string, text: string) => void;
  /** The editor applied the insertion numbered `seq`. */
  readonly inserted: (id: string, seq: number) => void;
  /** Runs what `scope` picks, one statement after another, opening a session first when it has none. */
  readonly run: (id: string, scope: RunScope) => Promise<void>;
  /** Asks the engine to cancel the running statement; `run` then reports it as cancelled. */
  readonly cancel: (id: string) => Promise<void>;
  /** Loads the window at `offset` unless it is loaded or on its way; evicts the furthest past the limit. */
  readonly ensureWindow: (id: string, resultId: string, offset: number) => void;
  /** Fetch Next Page, or Fetch All up to the cap (decision 025). */
  readonly fetchMore: (id: string, resultId: string, all: boolean) => Promise<void>;
  /** Stops a running fetch; the rows it got stay and the cursor stays open. */
  readonly stopFetch: (id: string, resultId: string) => Promise<void>;
  /** Sorts the fetched rows locally; no keys restores the server's order. */
  readonly sort: (id: string, resultId: string, keys: readonly SortKey[]) => Promise<void>;
  readonly setLayout: (id: string, resultId: string, layout: ColumnLayout) => void;
  readonly select: (id: string, resultId: string, selection: GridSelection | null) => void;
  /**
   * Explains the statement at the caret or the selection (plan 012 decision 9): the plugin checks
   * it first, and Analyse of a write asks before it runs.
   */
  readonly explain: (id: string, analyze: boolean) => Promise<void>;
  /**
   * Runs the tab's statement again in place, keeping its layout and sort, reconnecting when it must;
   * a plan tab explains again in the same mode.
   */
  readonly rerun: (id: string, resultId: string) => Promise<void>;
  /** The plan tab's view, selected node or collapsed nodes. */
  readonly updatePlan: (
    id: string,
    planId: string,
    change: Partial<Pick<PlanTab, "view" | "selected" | "collapsed">>,
  ) => void;
  /** The chosen rows and columns as an extractor's text, or null when the engine refused (the Output log says why). */
  readonly extract: (
    id: string,
    resultId: string,
    extractor: ExtractorKind,
    rows: readonly RowRange[],
    columns: readonly number[],
  ) => Promise<string | null>;
  /** Writes the result to `path`, draining its open cursor, and logs what it wrote. */
  readonly exportTo: (
    id: string,
    resultId: string,
    extractor: ExtractorKind,
    path: string,
    columns: readonly number[],
  ) => Promise<boolean>;
  readonly showResult: (id: string, resultId: string) => void;
  readonly togglePin: (id: string, resultId: string) => void;
  /** False when the engine refused, which the Output log then explains. */
  readonly setTransactionMode: (id: string, mode: TransactionMode) => Promise<boolean>;
  readonly commit: (id: string) => Promise<boolean>;
  readonly rollback: (id: string) => Promise<boolean>;
}

export const OUTPUT_TAB = "output";
export const OUTPUT_LIMIT = 500;
export const DEFAULT_CONSOLE_NAME = "console";
const RESULT_TITLE = "Result";
/** Whether Run can start from this status; it reconnects from the last two. */
export function canRun(status: ConsoleStatus): boolean {
  return status === "ready" || status === "disconnected" || status === "failed";
}

/** `Result N` for the smallest N no kept tab holds. */
export function nextResultTitle(kept: readonly Pick<ResultTab, "title">[]): string {
  const taken = new Set(kept.map((tab) => tab.title));
  for (let n = 1; ; n++) if (!taken.has(`${RESULT_TITLE} ${n}`)) return `${RESULT_TITLE} ${n}`;
}

/** The shown tab when it holds rows: what the grid and its actions work on. */
export function activeResultOf(session: ConsoleSession): ResultTab | null {
  const active = activeTabOf(session);
  return active?.kind === "rows" ? active : null;
}

/** The shown result or plan tab; null while Output is shown. */
export function activeTabOf(session: ConsoleSession): ConsoleTab | null {
  return session.results.find((result) => result.id === session.activeResult) ?? null;
}

export function activePlanOf(session: ConsoleSession): PlanTab | null {
  const active = activeTabOf(session);
  return active?.kind === "plan" ? active : null;
}

const isRows = (tab: ConsoleTab): tab is ResultTab => tab.kind === "rows";

/** What the user is asked before Explain Analyse runs a write (plan 012 decision 9). */
export interface AnalyseRequest {
  readonly statement: ClassifiedStatement;
  readonly mode: TransactionMode;
}

export const ANALYSE_TITLE = "Explain Analyse runs this statement";
export const ANALYSE_CONFIRM = "Run and Explain";
const ANALYSE_COMMITS = "Its changes will be committed.";
const ANALYSE_STAYS_OPEN = "Its changes stay in the open transaction until you commit or roll back.";
export const EXPLAIN_ONE_STATEMENT = "Explain one statement at a time.";
const NOTHING_TO_EXPLAIN = "Nothing to explain";
const DECLINED = "Cancelled; nothing ran.";

export function analyseConfirmation({ statement, mode }: AnalyseRequest): ModalRequest {
  return {
    kind: "confirm",
    title: ANALYSE_TITLE,
    message: mode === "auto" ? ANALYSE_COMMITS : ANALYSE_STAYS_OPEN,
    items: [{ label: firstLine(statement.sql), detail: statement.destructive ?? "" }],
    confirm: ANALYSE_CONFIRM,
    destructive: true,
  };
}

/** The label Services lists an explain under (plan 012 decision 13). */
export function explainLabel(sql: string, analyze: boolean): string {
  return `${analyze ? "Explain Analyse" : "Explain"}: ${firstLine(sql)}`;
}

export interface ConsolesDependencies {
  /** The datasource's engine, connected on first use; one port per datasource per window. */
  readonly connect: (datasourceId: string) => Promise<EngineClient>;
  readonly now: () => number;
  /** Wall-clock time for Output entries; defaults to `Date.now`. */
  readonly clock?: () => number;
  /** Asks before destructive statements run (decision 9); false runs none of the batch. */
  readonly confirmDestructive?: (statements: readonly ClassifiedStatement[]) => Promise<boolean>;
  /** Asks before Explain Analyse runs a write (plan 012 decision 9); false runs nothing. */
  readonly confirmAnalyse?: (request: AnalyseRequest) => Promise<boolean>;
  /** DDL took effect outside a transaction: the datasource's cached catalog is stale (decision 19). */
  readonly onDdl?: (datasourceId: string) => void;
  /** Hears each statement start and end, for Services (plan 011, decision 11). */
  readonly executions?: ExecutionReporter;
  /** Each statement once it ends, for query history (decision 030); must not throw. */
  readonly record?: (entry: HistoryEntry) => void;
}

function newConsole(datasourceId: string, name: string, sql: string, connect: boolean): ConsoleSession {
  return {
    datasourceId,
    name,
    sessionId: null,
    status: connect ? "connecting" : "disconnected",
    error: null,
    sql,
    selection: { from: 0, to: 0 },
    results: [],
    activeResult: OUTPUT_TAB,
    output: [],
    txMode: "auto",
    transactionOpen: false,
    lastRun: null,
    flash: null,
    jump: null,
    insertion: null,
  };
}

function statementCount(count: number): string {
  return `${count} ${count === 1 ? "statement" : "statements"}`;
}

export function createConsolesStore(dependencies: ConsolesDependencies) {
  /** The client each console's session lives on; not state, because nothing renders from it. */
  const clients = new Map<string, EngineClient>();
  /** Consoles whose DDL ran inside a transaction not yet ended: Commit makes it visible. */
  const pendingDdl = new Set<string>();
  const clock = dependencies.clock ?? (() => Date.now());
  const confirmDestructive = dependencies.confirmDestructive ?? (() => Promise.resolve(true));
  const confirmAnalyse = dependencies.confirmAnalyse ?? (() => Promise.resolve(true));
  const executions = dependencies.executions ?? { start: () => 0, finish: () => undefined };
  let entries = 0;
  let flashes = 0;
  let resultIds = 0;

  return create<ConsolesState>()((set, get) => {
    const windows = createResultWindows({
      client: (id) => clients.get(id),
      result: (id, resultId) => resultOf(id, resultId),
      update: (id, resultId, change) => updateResult(id, resultId, change),
      failed: (id, result, error, window) => {
        if (window) patch(id, { error });
        else logError(id, firstLine(result.sql), error);
      },
    });
    const { invalidate: invalidateWindows, forget } = windows;

    function patch(id: string, change: Partial<ConsoleSession>): void {
      const current = get().consoles[id];
      if (current === undefined) return;
      set({ consoles: { ...get().consoles, [id]: { ...current, ...change } } });
    }

    function log(id: string, entry: Omit<OutputEntry, "id" | "at" | "hint"> & { readonly hint?: string | null }): void {
      const current = get().consoles[id];
      if (current === undefined) return;
      const next: OutputEntry = { hint: null, ...entry, id: ++entries, at: clock() };
      patch(id, { output: [...current.output, next].slice(-OUTPUT_LIMIT) });
    }

    function logError(id: string, sql: string, error: EngineError): void {
      log(id, { sql, message: error.message, hint: error.hint, tone: "error" });
    }

    /** One statement on its way to the engine: Services lists it now, history once it ends. */
    function started(id: string, sql: string, label: string = firstLine(sql)): (end: ExecutionEnd) => void {
      const startedAt = clock();
      const datasourceId = get().consoles[id]?.datasourceId;
      const executionId = executions.start(id, { label, sql, startedAt });
      return (end) => {
        const durationMs = Math.max(0, Math.round(end.durationMs));
        executions.finish(id, executionId, { ...end, durationMs });
        if (datasourceId === undefined) return;
        const { outcome, rowCount, message } = end;
        dependencies.record?.({
          datasourceId,
          sql: end.sql ?? sql,
          startedAt,
          durationMs,
          outcome,
          rowCount,
          message,
          source: "console",
        });
      };
    }

    function rowsOf(executed: Pick<ExecutedStatement, "columns" | "rowCount" | "rowsAffected">): number | null {
      return executed.columns.length > 0 ? executed.rowCount : executed.rowsAffected;
    }

    function failureEnd(error: EngineError, durationMs: number): ExecutionEnd {
      const cancelled = error.code === "cancelled";
      return {
        durationMs,
        outcome: cancelled ? "cancelled" : "error",
        rowCount: null,
        message: cancelled ? null : error.message,
      };
    }

    /** Opens a session for the console; false when it could not, with the console marked failed. */
    async function openSession(id: string): Promise<boolean> {
      const current = get().consoles[id];
      if (current === undefined) return false;
      patch(id, { status: "connecting", error: null });
      try {
        const client = await dependencies.connect(current.datasourceId);
        const opened = await client.call("session.open", {});
        if (get().consoles[id] === undefined) {
          // Its tab closed while the session opened.
          void client.call("session.close", { sessionId: opened.sessionId }).catch(() => undefined);
          return false;
        }
        clients.set(id, client);
        patch(id, { sessionId: opened.sessionId, status: "ready", error: null, transactionOpen: false });
        const mode = get().consoles[id]?.txMode;
        if (mode === "manual") await applyMode(id, client, opened.sessionId, mode);
        return true;
      } catch (cause) {
        patch(id, { status: "failed", error: toError(cause) });
        return false;
      }
    }

    async function applyMode(id: string, client: EngineClient, sessionId: string, mode: TransactionMode) {
      try {
        cursorsClosed(id);
        const state = await client.call("transaction.setMode", { sessionId, mode });
        patch(id, { txMode: state.mode, transactionOpen: state.transactionOpen });
        return true;
      } catch (cause) {
        logError(id, "", toError(cause));
        return false;
      }
    }

    function release(id: string, results: readonly ConsoleTab[]): void {
      const client = clients.get(id);
      for (const result of results) {
        forget(result.id);
        if (result.kind === "rows" && client !== undefined && !result.stale) {
          void client.call("result.release", { handle: result.handle }).catch(() => undefined);
        }
      }
    }

    function tabOf(id: string, resultId: string): ConsoleTab | undefined {
      return get().consoles[id]?.results.find((result) => result.id === resultId);
    }

    function resultOf(id: string, resultId: string): ResultTab | undefined {
      const tab = tabOf(id, resultId);
      return tab?.kind === "rows" ? tab : undefined;
    }

    function planOf(id: string, planId: string): PlanTab | undefined {
      const tab = tabOf(id, planId);
      return tab?.kind === "plan" ? tab : undefined;
    }

    function updateResult(id: string, resultId: string, change: (result: ResultTab) => ResultTab): void {
      const current = get().consoles[id];
      if (current === undefined) return;
      patch(id, {
        results: current.results.map((result) => (result.id === resultId && isRows(result) ? change(result) : result)),
      });
    }

    function updatePlan(id: string, planId: string, change: (plan: PlanTab) => PlanTab): void {
      const current = get().consoles[id];
      if (current === undefined) return;
      patch(id, {
        results: current.results.map((tab) => (tab.id === planId && tab.kind === "plan" ? change(tab) : tab)),
      });
    }

    /** The engine closes a session's open cursor when the session runs anything or its transaction ends. */
    function cursorsClosed(id: string): void {
      const current = get().consoles[id];
      if (current === undefined || !current.results.some((result) => isRows(result) && result.cursorOpen)) return;
      patch(id, {
        results: current.results.map((result) => (isRows(result) ? { ...result, cursorOpen: false } : result)),
      });
    }

    /** Drops the unpinned result tabs before a run fills new ones (decision 10). */
    function replaceUnpinned(id: string): void {
      const current = get().consoles[id];
      if (current === undefined) return;
      const kept = current.results.filter((result) => result.pinned);
      release(
        id,
        current.results.filter((result) => !result.pinned),
      );
      const activeKept = kept.some((result) => result.id === current.activeResult);
      patch(id, { results: kept, activeResult: activeKept ? current.activeResult : OUTPUT_TAB });
    }

    async function resolveTarget(
      client: EngineClient,
      session: ConsoleSession,
      scope: RunScope,
    ): Promise<readonly ClassifiedStatement[]> {
      const statements = await client.call("script.split", { text: session.sql });
      const target = statementsToRun(statements, session.selection, scope);
      if (target.kind === "nothing") return [];
      if (target.kind === "statements") return target.statements;
      const pieces = await client.call("script.split", { text: session.sql.slice(target.from, target.to) });
      return pieces.map((piece) => ({ ...piece, from: piece.from + target.from, to: piece.to + target.from }));
    }

    function afterTransactionChange(id: string, datasourceId: string, open: boolean, committed: boolean): void {
      if (open || !pendingDdl.has(id)) return;
      pendingDdl.delete(id);
      if (committed) dependencies.onDdl?.(datasourceId);
    }

    /** Runs `statements` in order; the first failure skips the rest. */
    async function execute(
      id: string,
      client: EngineClient,
      sessionId: string,
      statements: readonly ClassifiedStatement[],
    ): Promise<RunOutcome> {
      for (const [index, statement] of statements.entries()) {
        const sql = firstLine(statement.sql);
        patch(id, { flash: { from: statement.from, to: statement.to, seq: ++flashes } });
        const ended = started(id, statement.sql);
        const startedAt = dependencies.now();
        try {
          cursorsClosed(id);
          const { transactionOpen, ...executed } = await client.call("statement.execute", {
            sessionId,
            sql: statement.sql,
          });
          const elapsed = dependencies.now() - startedAt;
          ended({ durationMs: elapsed, outcome: "success", rowCount: rowsOf(executed), message: null });
          log(id, { sql, message: executedText(executed, elapsed, statement.kind), tone: "success" });
          const current = get().consoles[id];
          if (current === undefined) return "cancelled";
          const datasourceId = current.datasourceId;
          if (executed.columns.length > 0) {
            const tab = resultTabOf(
              executed,
              { id: `${id}/result-${++resultIds}`, title: nextResultTitle(current.results) },
              statement.sql,
            );
            patch(id, { results: [...current.results, tab], activeResult: tab.id, transactionOpen });
          } else {
            patch(id, { transactionOpen });
          }
          if (statement.kind === "ddl") {
            if (transactionOpen) pendingDdl.add(id);
            else dependencies.onDdl?.(datasourceId);
          }
          if (statement.kind === "transaction") {
            // Whether a typed end committed is the plugin's to know (decision 008); re-reading after a
            // rollback costs a describe and shows the same tree.
            afterTransactionChange(id, datasourceId, transactionOpen, true);
          }
        } catch (cause) {
          const error = toError(cause);
          ended(failureEnd(error, dependencies.now() - startedAt));
          const cancelled = error.code === "cancelled";
          if (cancelled) log(id, { sql, message: "Cancelled", tone: "warning" });
          else logError(id, sql, error);
          const skipped = statements.length - index - 1;
          if (skipped > 0) {
            log(id, {
              sql: "",
              message: `${statementCount(skipped)} skipped after the ${cancelled ? "cancel" : "error"}.`,
              tone: "warning",
            });
          }
          patch(id, { error, activeResult: OUTPUT_TAB });
          return cancelled ? "cancelled" : "failed";
        }
      }
      return "succeeded";
    }

    async function endTransaction(id: string, method: "transaction.commit" | "transaction.rollback") {
      const current = get().consoles[id];
      const client = clients.get(id);
      if (current?.sessionId == null || client === undefined) return true;
      try {
        cursorsClosed(id);
        const state: TransactionState = await client.call(method, { sessionId: current.sessionId });
        patch(id, { transactionOpen: state.transactionOpen });
        const committed = method === "transaction.commit";
        log(id, { sql: "", message: committed ? "Committed" : "Rolled back", tone: "info" });
        afterTransactionChange(id, current.datasourceId, state.transactionOpen, committed);
        return true;
      } catch (cause) {
        logError(id, "", toError(cause));
        return false;
      }
    }

    /**
     * Runs `body` on the console's session as Run does: opening one first when it has none, marking
     * the console running, and recording the outcome as its last run.
     */
    async function onSession(
      id: string,
      body: (client: EngineClient, sessionId: string, session: ConsoleSession) => Promise<RunOutcome>,
    ): Promise<void> {
      const before = get().consoles[id];
      if (before === undefined || !canRun(before.status)) return;
      if (before.status !== "ready" && !(await openSession(id))) return;
      const current = get().consoles[id];
      const client = clients.get(id);
      if (current?.sessionId == null || current.status !== "ready" || client === undefined) return;
      const startedAt = dependencies.now();
      patch(id, { status: "running", error: null });
      let outcome: RunOutcome = "failed";
      try {
        outcome = await body(client, current.sessionId, current);
      } catch (cause) {
        const error = toError(cause);
        logError(id, "", error);
        patch(id, { error, activeResult: OUTPUT_TAB });
      }
      const latest = get().consoles[id];
      patch(id, {
        // A detach while running already said the session is gone, and why.
        status: latest?.status === "disconnected" || latest?.status === "failed" ? latest.status : "ready",
        lastRun: { durationMs: dependencies.now() - startedAt, outcome },
      });
    }

    /** Refused or declined: Output says why and nothing runs (plan 012 decision 9). */
    function notRun(id: string, sql: string, message: string): RunOutcome {
      log(id, { sql, message, tone: "warning" });
      patch(id, { activeResult: OUTPUT_TAB });
      return "cancelled";
    }

    /**
     * Explains one statement: the plugin's check, the question when Analyse writes, then the plan
     * into a new tab, or into `replacing` when a plan tab explains again.
     */
    async function explainOne(
      id: string,
      client: EngineClient,
      sessionId: string,
      statement: ClassifiedStatement,
      analyze: boolean,
      replacing: PlanTab | null,
    ): Promise<RunOutcome> {
      const sql = firstLine(statement.sql);
      const verdict = await client.call("sql.explainable", { sql: statement.sql, analyze });
      if (!verdict.ok) return notRun(id, sql, verdict.reason);
      const mode = get().consoles[id]?.txMode ?? "auto";
      if (analyze && verdict.writes && !(await confirmAnalyse({ statement, mode }))) return notRun(id, "", DECLINED);
      if (replacing === null) {
        replaceUnpinned(id);
        patch(id, { flash: { from: statement.from, to: statement.to, seq: ++flashes } });
      }
      cursorsClosed(id);
      const ended = started(id, statement.sql, explainLabel(statement.sql, analyze));
      const startedAt = dependencies.now();
      try {
        const { plan, transactionOpen } = await client.call("statement.explain", {
          sessionId,
          sql: statement.sql,
          analyze,
        });
        const elapsed = dependencies.now() - startedAt;
        ended({ durationMs: elapsed, outcome: "success", rowCount: null, message: null, sql: plan.statement });
        log(id, { sql, message: explainedText(analyze, elapsed), tone: "success" });
        const current = get().consoles[id];
        if (current === undefined) return "cancelled";
        const effect: AnalysedEffect =
          analyze && verdict.writes ? (transactionOpen ? "inTransaction" : "committed") : "none";
        if (replacing === null) {
          const tab = planTabOf(`${id}/plan-${++resultIds}`, statement.sql, plan, effect);
          patch(id, { results: [...current.results, tab], activeResult: tab.id, transactionOpen });
        } else {
          updatePlan(id, replacing.id, (latest) => ({
            ...planTabOf(latest.id, latest.sql, plan, effect),
            view: latest.view,
            pinned: latest.pinned,
          }));
          patch(id, { transactionOpen });
        }
        if (analyze && statement.kind === "ddl") {
          if (transactionOpen) pendingDdl.add(id);
          else dependencies.onDdl?.(current.datasourceId);
        }
        return "succeeded";
      } catch (cause) {
        const error = toError(cause);
        ended(failureEnd(error, dependencies.now() - startedAt));
        const cancelled = error.code === "cancelled";
        if (cancelled) log(id, { sql, message: "Cancelled", tone: "warning" });
        else logError(id, sql, error);
        patch(id, { error, activeResult: OUTPUT_TAB });
        return cancelled ? "cancelled" : "failed";
      }
    }

    return {
      consoles: {},

      async open(id, datasourceId, options = {}) {
        const connect = options.connect ?? true;
        const session = newConsole(datasourceId, options.name ?? DEFAULT_CONSOLE_NAME, options.sql ?? "", connect);
        set({ consoles: { ...get().consoles, [id]: session } });
        if (connect) await openSession(id);
      },

      close(id) {
        const closing = get().consoles[id];
        if (closing === undefined) return;
        const { [id]: _closed, ...rest } = get().consoles;
        set({ consoles: rest });
        for (const result of closing.results) forget(result.id);
        pendingDdl.delete(id);
        const client = clients.get(id);
        clients.delete(id);
        if (closing.sessionId === null || client === undefined) return;
        void client.call("session.close", { sessionId: closing.sessionId }).catch(() => undefined);
      },

      detach(datasourceId, error) {
        for (const [id, session] of Object.entries(get().consoles)) {
          if (session.datasourceId !== datasourceId) continue;
          clients.delete(id);
          pendingDdl.delete(id);
          for (const result of session.results) invalidateWindows(result.id);
          if (session.transactionOpen) {
            log(id, { sql: "", message: "The session closed; its open transaction was rolled back.", tone: "warning" });
          }
          patch(id, {
            sessionId: null,
            status: error === null ? "disconnected" : "failed",
            error: error ?? session.error,
            transactionOpen: false,
            results: session.results.map((result) =>
              isRows(result) ? { ...result, stale: true, cursorOpen: false, fetching: null } : result,
            ),
          });
        }
      },

      setSql(id, sql) {
        patch(id, { sql });
      },

      setSelection(id, selection) {
        const current = get().consoles[id];
        if (current === undefined) return;
        if (current.selection.from === selection.from && current.selection.to === selection.to) return;
        patch(id, { selection });
      },

      insert(id, text) {
        if (get().consoles[id] === undefined) return;
        flashes += 1;
        patch(id, { insertion: { text, seq: flashes } });
      },

      inserted(id, seq) {
        if (get().consoles[id]?.insertion?.seq !== seq) return;
        patch(id, { insertion: null });
      },

      jumpTo(id, span) {
        if (get().consoles[id] === undefined) return;
        flashes += 1;
        patch(id, {
          selection: { from: span.from, to: span.from },
          jump: { ...span, seq: flashes },
          flash: { ...span, seq: flashes },
        });
      },

      async run(id, scope) {
        const before = get().consoles[id];
        if (before === undefined || !canRun(before.status)) return;
        if (before.status !== "ready" && !(await openSession(id))) return;
        const current = get().consoles[id];
        const client = clients.get(id);
        if (current?.sessionId == null || current.status !== "ready" || client === undefined) return;
        const { sessionId } = current;
        const startedAt = dependencies.now();
        patch(id, { status: "running", error: null });
        let outcome: RunOutcome = "failed";
        try {
          const statements = await resolveTarget(client, current, scope);
          if (statements.length === 0) {
            log(id, { sql: "", message: "Nothing to run", tone: "info" });
            patch(id, { activeResult: OUTPUT_TAB });
            outcome = "succeeded";
          } else {
            const destructive = statements.filter((statement) => statement.destructive !== null);
            if (destructive.length > 0 && !(await confirmDestructive(destructive))) {
              log(id, { sql: "", message: "Cancelled; nothing ran.", tone: "warning" });
              patch(id, { activeResult: OUTPUT_TAB });
              outcome = "cancelled";
            } else {
              replaceUnpinned(id);
              outcome = await execute(id, client, sessionId, statements);
            }
          }
        } catch (cause) {
          const error = toError(cause);
          logError(id, "", error);
          patch(id, { error, activeResult: OUTPUT_TAB });
        }
        const latest = get().consoles[id];
        patch(id, {
          // A detach while running already said the session is gone, and why.
          status: latest?.status === "disconnected" || latest?.status === "failed" ? latest.status : "ready",
          lastRun: { durationMs: dependencies.now() - startedAt, outcome },
        });
      },

      async cancel(id) {
        const current = get().consoles[id];
        const client = clients.get(id);
        if (current?.sessionId == null || current.status !== "running" || client === undefined) return;
        try {
          await client.call("statement.cancel", { sessionId: current.sessionId });
        } catch (cause) {
          patch(id, { error: toError(cause) });
        }
      },

      ensureWindow: windows.ensureWindow,
      fetchMore: windows.fetchMore,
      stopFetch: windows.stopFetch,

      async sort(id, resultId, keys) {
        const result = resultOf(id, resultId);
        const client = clients.get(id);
        if (result === undefined) return;
        if (client === undefined || result.stale) {
          // Sorting is the engine's (decision 009); a closed connection's rows keep their order.
          return;
        }
        try {
          const state = await client.call("result.sort", { handle: result.handle, keys: [...keys] });
          invalidateWindows(resultId);
          updateResult(id, resultId, (latest) => ({ ...latest, ...state, sort: keys, windows: {}, selection: null }));
        } catch (cause) {
          logError(id, firstLine(result.sql), toError(cause));
        }
      },

      setLayout(id, resultId, layout) {
        updateResult(id, resultId, (latest) => {
          const visible = layout.hidden.filter((hidden) => !hidden).length;
          const hiddenChanged = layout.hidden.some((hidden, index) => hidden !== latest.layout.hidden[index]);
          const selection = hiddenChanged
            ? null
            : clampSelection(latest.selection, { rows: latest.rowCount, columns: visible });
          return { ...latest, layout, selection };
        });
      },

      select(id, resultId, selection) {
        updateResult(id, resultId, (latest) => (latest.selection === selection ? latest : { ...latest, selection }));
      },

      explain: (id, analyze) =>
        onSession(id, async (client, sessionId, session) => {
          const statements = await resolveTarget(client, session, "caret");
          const [statement] = statements;
          if (statement === undefined) {
            log(id, { sql: "", message: NOTHING_TO_EXPLAIN, tone: "info" });
            patch(id, { activeResult: OUTPUT_TAB });
            return "succeeded";
          }
          if (statements.length > 1) return notRun(id, "", EXPLAIN_ONE_STATEMENT);
          return explainOne(id, client, sessionId, statement, analyze, null);
        }),

      async rerun(id, resultId) {
        const plan = planOf(id, resultId);
        if (plan !== undefined) {
          await onSession(id, async (client, sessionId) => {
            const [statement] = await client.call("script.split", { text: plan.sql });
            if (statement === undefined) return notRun(id, "", NOTHING_TO_EXPLAIN);
            const latest = planOf(id, resultId);
            if (latest === undefined) return "cancelled";
            return explainOne(id, client, sessionId, statement, plan.analyzed, latest);
          });
          return;
        }
        const before = get().consoles[id];
        if (before === undefined || resultOf(id, resultId) === undefined || !canRun(before.status)) return;
        if (before.status !== "ready" && !(await openSession(id))) return;
        const current = get().consoles[id];
        const client = clients.get(id);
        const tab = resultOf(id, resultId);
        if (current?.sessionId == null || current.status !== "ready" || client === undefined || tab === undefined)
          return;
        const { sessionId } = current;
        const sql = firstLine(tab.sql);
        const startedAt = dependencies.now();
        patch(id, { status: "running", error: null });
        let outcome: RunOutcome;
        let ended: ((end: ExecutionEnd) => void) | null = null;
        let statementStartedAt = startedAt;
        try {
          const [statement] = await client.call("script.split", { text: tab.sql });
          if (statement !== undefined && statement.destructive !== null && !(await confirmDestructive([statement]))) {
            log(id, { sql: "", message: "Cancelled; nothing ran.", tone: "warning" });
            outcome = "cancelled";
          } else {
            cursorsClosed(id);
            ended = started(id, tab.sql);
            statementStartedAt = dependencies.now();
            const { transactionOpen, ...executed } = await client.call("statement.execute", {
              sessionId,
              sql: tab.sql,
            });
            const kind = statement?.kind ?? "read";
            const elapsed = dependencies.now() - statementStartedAt;
            ended({ durationMs: elapsed, outcome: "success", rowCount: rowsOf(executed), message: null });
            ended = null;
            log(id, { sql, message: executedText(executed, elapsed, kind), tone: "success" });
            const latest = resultOf(id, resultId);
            if (latest === undefined) {
              void client.call("result.release", { handle: executed.handle }).catch(() => undefined);
            } else {
              if (!latest.stale) void client.call("result.release", { handle: latest.handle }).catch(() => undefined);
              invalidateWindows(resultId);
              const fresh = resultTabOf(executed, { id: latest.id, title: latest.title }, latest.sql);
              const names = (columns: readonly Column[]) => columns.map((column) => column.name);
              const layout = carriedLayout(latest.layout, names(latest.columns), names(fresh.columns));
              const kept = layout === latest.layout;
              const sort = kept ? latest.sort : [];
              const state =
                sort.length > 0 ? await client.call("result.sort", { handle: fresh.handle, keys: [...sort] }) : fresh;
              updateResult(id, resultId, () => ({
                ...fresh,
                ...state,
                pinned: latest.pinned,
                layout,
                autoChars: kept ? latest.autoChars : fresh.autoChars,
                sort,
                windows: sort.length > 0 ? {} : fresh.windows,
              }));
            }
            patch(id, { transactionOpen });
            outcome = "succeeded";
          }
        } catch (cause) {
          const error = toError(cause);
          ended?.(failureEnd(error, dependencies.now() - statementStartedAt));
          if (error.code === "cancelled") log(id, { sql, message: "Cancelled", tone: "warning" });
          else logError(id, sql, error);
          patch(id, { error, activeResult: OUTPUT_TAB });
          outcome = error.code === "cancelled" ? "cancelled" : "failed";
        }
        const latest = get().consoles[id];
        patch(id, {
          status: latest?.status === "disconnected" || latest?.status === "failed" ? latest.status : "ready",
          lastRun: { durationMs: dependencies.now() - startedAt, outcome },
        });
      },

      extract: windows.extract,

      async exportTo(id, resultId, extractor, path, columns) {
        const exported = await windows.exportTo(id, resultId, extractor, path, columns);
        const result = resultOf(id, resultId);
        if (exported !== null && result !== undefined) {
          log(id, { sql: firstLine(result.sql), message: exportedText(exported), tone: "success" });
        }
        return exported !== null;
      },

      showResult(id, resultId) {
        const current = get().consoles[id];
        if (current === undefined) return;
        if (resultId !== OUTPUT_TAB && !current.results.some((result) => result.id === resultId)) return;
        patch(id, { activeResult: resultId });
      },

      updatePlan(id, planId, change) {
        updatePlan(id, planId, (latest) => ({ ...latest, ...change }));
      },

      togglePin(id, resultId) {
        const current = get().consoles[id];
        if (current === undefined) return;
        patch(id, {
          results: current.results.map((result) =>
            result.id === resultId ? { ...result, pinned: !result.pinned } : result,
          ),
        });
      },

      async setTransactionMode(id, mode) {
        const current = get().consoles[id];
        if (current === undefined) return false;
        const client = clients.get(id);
        if (current.sessionId === null || client === undefined || current.status !== "ready") {
          patch(id, { txMode: mode });
          return true;
        }
        return applyMode(id, client, current.sessionId, mode);
      },

      commit: (id) => endTransaction(id, "transaction.commit"),
      rollback: (id) => endTransaction(id, "transaction.rollback"),
    };
  });
}

export type ConsolesStore = ReturnType<typeof createConsolesStore>;

/** The destructive-statement confirmation (decision 9): one dialog for the whole batch. */
async function askDestructive(statements: readonly ClassifiedStatement[]): Promise<boolean> {
  const answer = await useModal.getState().ask({
    kind: "confirm",
    title:
      statements.length === 1 ? "Run a destructive statement?" : `Run ${statements.length} destructive statements?`,
    message: "These statements can change or remove data that cannot be recovered:",
    items: statements.map((statement) => ({ label: firstLine(statement.sql), detail: statement.destructive ?? "" })),
    confirm: "Execute",
    destructive: true,
  });
  return answer !== null;
}

async function askAnalyse(request: AnalyseRequest): Promise<boolean> {
  return (await useModal.getState().ask(analyseConfirmation(request))) !== null;
}

export const useConsoles = createConsolesStore({
  connect: (datasourceId) => useDatasources.getState().connect(datasourceId),
  now: () => performance.now(),
  confirmDestructive: askDestructive,
  confirmAnalyse: askAnalyse,
  onDdl: (datasourceId) => void useCatalog.getState().refreshCached(datasourceId),
  executions: {
    start: (tabId, start) => useExecutions.getState().start(tabId, start),
    finish: (tabId, executionId, end) => useExecutions.getState().finish(tabId, executionId, end),
  },
  record: (entry) => history.record(entry),
});

/** The consoles open on a datasource, by console id. */
export function consolesOf(consoles: ConsolesState["consoles"], datasourceId: string): readonly string[] {
  return Object.entries(consoles)
    .filter(([, session]) => session.datasourceId === datasourceId)
    .map(([id]) => id);
}

/** The consoles holding an open transaction, by console id. */
export function openTransactions(consoles: ConsolesState["consoles"]): readonly string[] {
  return Object.entries(consoles)
    .filter(([, session]) => session.transactionOpen)
    .map(([id]) => id);
}
