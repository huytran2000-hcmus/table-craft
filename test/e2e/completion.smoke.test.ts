/**
 * Plan 009's live test: completion and navigation in the SQL console against PostgreSQL, MySQL and
 * SQLite, from the `test/db/compose.yml` databases and seeded SQLite files. Gated, because it needs
 * a display, a fresh build and the containers:
 *
 *   TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/009 bun run test:smoke:db
 *
 * Nothing here writes to the shared databases.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { MYSQL_CONFIG, POSTGRES_CONFIG } from "../support/databases.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";
import {
  activeEditorTab,
  DATABASES_ENABLED,
  enginePids,
  EVIDENCE_WINDOW,
  evidenceFor,
  LAUNCH_TIMEOUT_MS,
  launchApp,
  pressChord,
  SCENARIO_TIMEOUT_MS,
  setWindowSize,
  sqlEditor,
  toolWindow,
  treeNode,
  waitUntilReady,
  type Datasource,
  type RunningApp,
} from "./harness.js";

const captureWindow = evidenceFor("009");

const POSTGRES: Datasource = { id: "pg", pluginId: "postgres", config: POSTGRES_CONFIG };
const MYSQL: Datasource = { id: "mysql", pluginId: "mysql", config: MYSQL_CONFIG };

function sqlite(path = seededSqliteFile()): Datasource {
  return { id: "lite", pluginId: "sqlite", config: { path } };
}

/** How long `app.close()` may take before the scenario kills the app. */
const CLOSE_DEADLINE_MS = 10_000;
const HOOK_TIMEOUT_MS = CLOSE_DEADLINE_MS * 2;
const TABLES_GROUP = "tables 6";
const WIDE_TABLES = 500;
const WIDE_COLUMNS = 30;
/** Plan 009 decision 19: completion over a 500-table schema answers within this. */
const WIDE_COMPLETION_BUDGET_MS = 100;
/**
 * CodeMirror ignores Enter for its `interactionDelay` (75 ms) after the popup opens, so a keystroke
 * already in flight cannot pick an option; a person never beats it, Playwright does.
 */
const ACCEPT_AFTER_MS = 150;
/** Basic Completion, CodeMirror's `Ctrl-Space` on every platform. */
const BASIC_COMPLETION = "Control+Space";

/** Where the console's caret sits in its first line, read from the DOM selection CodeMirror keeps in sync. */
const CARET_OFFSET = `(() => {
  const selection = document.getSelection();
  const line = document.querySelector('[data-testid="sql-editor"] .cm-line');
  if (!selection || !line || selection.anchorNode === null) return -1;
  const range = document.createRange();
  range.setStart(line, 0);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
})()`;

/**
 * Times Basic Completion from the keystroke to the first option in the DOM: an upper bound on the
 * engine's share, which also pays the port round trip and CodeMirror's render.
 */
const ARM_COMPLETION_TIMER = `(() => {
  window.__completionMs = null;
  const armed = (event) => {
    if (!(event.ctrlKey && event.code === 'Space')) return;
    document.removeEventListener('keydown', armed, { capture: true });
    const started = performance.now();
    const observer = new MutationObserver(() => {
      if (document.querySelector('.cm-tooltip-autocomplete [role="option"]') === null) return;
      window.__completionMs = performance.now() - started;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  document.addEventListener('keydown', armed, { capture: true });
})()`;
const COMPLETION_MS = "window.__completionMs";

/** A file database with `WIDE_TABLES` tables of `WIDE_COLUMNS` integer columns each. */
function wideSqliteFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "table-craft-wide-")), "wide.sqlite");
  const database = new DatabaseSync(path);
  const columns = Array.from({ length: WIDE_COLUMNS }, (_, index) => `c${String(index + 1)} INTEGER`).join(", ");
  try {
    for (let table = 1; table <= WIDE_TABLES; table++) {
      database.exec(`CREATE TABLE t${String(table).padStart(3, "0")} (${columns})`);
    }
  } finally {
    database.close();
  }
  return path;
}

function popup(page: Page) {
  return page.locator(".cm-tooltip-autocomplete");
}

function options(page: Page) {
  return popup(page).getByRole("option");
}

async function optionLabels(page: Page): Promise<string[]> {
  return popup(page).locator(".cm-completionLabel").allTextContents();
}

/** The option whose label is exactly `label`, with its detail. */
function option(page: Page, label: string) {
  return options(page).filter({
    has: page.locator(".cm-completionLabel", { hasText: new RegExp(`^${escape(label)}$`) }),
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function editorText(page: Page): Promise<string> {
  return (await page.locator('[data-testid="sql-editor"] .cm-line').allTextContents()).join("\n");
}

/** Replaces the console's text with `sql` and puts the caret at `caret` (default: the end). */
async function typeAt(page: Page, sql: string, caret = sql.length): Promise<void> {
  const editor = sqlEditor(page);
  await editor.fill(sql);
  await expect.poll(() => editorText(page)).toBe(sql);
  // Filling can open a typing popup; close it so the explicit request below is the one shown.
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  for (let step = sql.length; step > caret; step--) await page.keyboard.press("ArrowLeft");
  await expect.poll(() => page.evaluate<number>(CARET_OFFSET)).toBe(caret);
}

async function completeAt(page: Page, sql: string, caret = sql.length): Promise<void> {
  await typeAt(page, sql, caret);
  await page.keyboard.press(BASIC_COMPLETION);
  await options(page).first().waitFor({ timeout: LAUNCH_TIMEOUT_MS });
}

async function acceptCompletion(page: Page): Promise<void> {
  await new Promise((settle) => setTimeout(settle, ACCEPT_AFTER_MS));
  await page.keyboard.press("Enter");
}

function explorer(page: Page) {
  return toolWindow(page, "Database");
}

function treeRow(page: Page, name: string) {
  return explorer(page).getByRole("treeitem", { name, exact: true });
}

describe.runIf(DATABASES_ENABLED)("completion and navigation live test", () => {
  let running: RunningApp | null = null;

  async function closeApp(): Promise<void> {
    const current = running;
    running = null;
    if (current === null) return;
    const closed = current.app.close().then(() => true);
    const late = new Promise<false>((settle) => setTimeout(() => settle(false), CLOSE_DEADLINE_MS));
    if (!(await Promise.race([closed, late]))) current.app.process().kill();
  }

  afterEach(closeApp, HOOK_TIMEOUT_MS);

  /** Launches on `datasource` and waits for its current namespace to be described in the tree. */
  async function launch(datasource: Datasource, tables = TABLES_GROUP): Promise<Page> {
    running = await launchApp(datasource);
    await setWindowSize(running.app, EVIDENCE_WINDOW);
    await waitUntilReady(running.page);
    await treeRow(running.page, tables).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
    return running.page;
  }

  it(
    "givenPostgresConsole_whenBasicCompletionAfterFrom_thenTablesAndViewsWithGlyphs",
    async () => {
      const page = await launch(POSTGRES);

      await completeAt(page, "SELECT * FROM ");

      const labels = await optionLabels(page);
      expect(labels).toEqual(
        expect.arrayContaining(["customers", "orders", "Line Items", "customer_totals", "archive"]),
      );
      expect(labels.indexOf("orders")).toBeLessThan(labels.indexOf("archive"));
      const shown = await options(page).count();
      expect(await popup(page).locator(".cm-tc-glyph svg").count()).toBe(shown);
      await captureWindow(page, "from-relations");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenMysqlAliasDot_whenBasicCompletion_thenOrdersColumnsWithTypes",
    async () => {
      const page = await launch(MYSQL);
      const sql = "SELECT o. FROM orders o";

      await completeAt(page, sql, "SELECT o.".length);

      await expect.poll(() => optionLabels(page)).toEqual(["id", "customer_id", "total", "placed_at"]);
      const details = await popup(page).locator(".cm-completionDetail").allTextContents();
      expect(details).toHaveLength(4);
      for (const detail of details) expect(detail).not.toBe("");
      await captureWindow(page, "alias-columns");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenSqliteCte_whenBasicCompletionAfterItsName_thenItsSelectListColumns",
    async () => {
      const page = await launch(sqlite());

      await completeAt(page, "WITH t AS (SELECT id, name FROM customers) SELECT t.");

      await expect.poll(() => optionLabels(page)).toEqual(["id", "name"]);
      await captureWindow(page, "cte-columns");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenPostgresJoinAfterOrders_whenCompletingAndAccepting_thenCustomersJoinWithOnIsInserted",
    async () => {
      const page = await launch(POSTGRES);
      const sql = "SELECT * FROM orders o JOIN ";

      await completeAt(page, sql);

      const join = "customers c ON c.id = o.customer_id";
      await expect.poll(async () => (await optionLabels(page))[0]).toBe(join);
      await captureWindow(page, "join-on");
      await acceptCompletion(page);
      await expect.poll(() => editorText(page)).toBe(`${sql}${join}`);
      await expect.poll(() => popup(page).count()).toBe(0);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenLineItemsOnEachDatabase_whenCompletingLi_thenTheDialectQuotesIt",
    async () => {
      const expected: readonly [Datasource, string][] = [
        [POSTGRES, '"Line Items"'],
        [MYSQL, "`Line Items`"],
        [sqlite(), '"Line Items"'],
      ];
      for (const [datasource, quoted] of expected) {
        const page = await launch(datasource);

        await completeAt(page, "SELECT * FROM Li");

        await expect.poll(async () => (await optionLabels(page))[0]).toBe("Line Items");
        await acceptCompletion(page);
        await expect.poll(() => editorText(page)).toBe(`SELECT * FROM ${quoted}`);
        // MySQL's backticks are the case the other two cannot show.
        if (datasource.pluginId === "mysql") await captureWindow(page, "quoted-identifier");
        await closeApp();
      }
    },
    SCENARIO_TIMEOUT_MS * 3,
  );

  it(
    "givenPostgresArchiveSchemaNotYetDescribed_whenCompletingItsDot_thenOldOrdersIsOffered",
    async () => {
      const page = await launch(POSTGRES);
      expect(await treeRow(page, "archive").getAttribute("aria-expanded")).not.toBe("true");

      await completeAt(page, "SELECT * FROM archive.");

      await expect.poll(() => optionLabels(page)).toEqual(["old_orders"]);
      await captureWindow(page, "other-schema");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenOrdersTableEditor_whenTypingInTheWhereBar_thenCustomerIdIsOffered",
    async () => {
      const page = await launch(POSTGRES);
      const group = treeRow(page, TABLES_GROUP);
      await group.click();
      if ((await group.getAttribute("aria-expanded")) !== "true") await page.keyboard.press("ArrowRight");
      await treeRow(page, "orders").click();
      await page.keyboard.press("F4");
      await expect.poll(() => activeEditorTab(page).textContent()).toBe("orders [pg]");
      const where = page.getByTestId("table-editor").getByTestId("filter-where").locator(".cm-content");

      await where.click();
      await page.keyboard.type("cust");

      await option(page, "customer_id").waitFor({ timeout: LAUNCH_TIMEOUT_MS });
      await captureWindow(page, "where-bar");
      await acceptCompletion(page);
      await expect.poll(() => where.textContent()).toBe("customer_id");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenCaretOnAliasO_whenGoToDeclaration_thenCaretMovesToOrdersO",
    async () => {
      const page = await launch(POSTGRES);
      const sql = "SELECT o.total FROM orders o";

      await typeAt(page, sql, "SELECT ".length);
      await pressChord(page, "B");

      await expect.poll(() => page.evaluate<number>(CARET_OFFSET)).toBe(sql.indexOf("orders o"));
      await expect.poll(() => page.locator(".tc-statement-flash").allTextContents()).toEqual(["orders o"]);
      await captureWindow(page, "goto-alias");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    // A column, because Go to Declaration on a relation opens its DDL instead (plan 010).
    "givenMysqlCaretOnCustomersEmail_whenGoToDeclaration_thenTheDatabasePaneSelectsIt",
    async () => {
      const page = await launch(MYSQL);
      const email = explorer(page).getByRole("treeitem", { name: /^email / });
      expect(await email.count()).toBe(0);

      await typeAt(page, "SELECT email FROM customers", "SELECT em".length);
      await pressChord(page, "B");

      await expect.poll(() => email.getAttribute("aria-selected")).toBe("true");
      await expect
        .poll(() => page.evaluate("document.activeElement?.closest('[aria-label=\"Database\"]') != null"))
        .toBe(true);
      await captureWindow(page, "goto-relation");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenCaretOnOrders_whenF4InTheConsole_thenOrdersDataOpens",
    async () => {
      const page = await launch(POSTGRES);

      await typeAt(page, "SELECT * FROM orders WHERE total > 10", "SELECT * FROM ord".length);
      await page.keyboard.press("F4");

      await expect.poll(() => activeEditorTab(page).textContent()).toBe("orders [pg]");
      await page.getByTestId("table-editor").getByRole("gridcell").first().waitFor({ timeout: LAUNCH_TIMEOUT_MS });
      await captureWindow(page, "open-data");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenDisconnectedSqliteConsole_whenBasicCompletion_thenKeywordsAndNoEngineStarts",
    async () => {
      const page = await launch(sqlite());
      const app = (running as RunningApp).app;
      await sqlEditor(page).click();
      await pressChord(page, "F2");
      await expect.poll(() => treeNode(page, "lite").getAttribute("data-state")).toBe("disconnected");
      await expect.poll(() => enginePids(app), { timeout: LAUNCH_TIMEOUT_MS }).toHaveLength(0);

      await completeAt(page, "SELECT * FROM orders WH");

      await expect.poll(() => optionLabels(page)).toContain("WHERE");
      expect(await optionLabels(page)).not.toContain("orders");
      expect(await enginePids(app)).toHaveLength(0);
      expect(await treeNode(page, "lite").getAttribute("data-state")).toBe("disconnected");
      await captureWindow(page, "disconnected-keywords");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenWideSqliteSchema_whenBasicCompletionAfterFrom_thenAnswersWithinBudget",
    async () => {
      const page = await launch(sqlite(wideSqliteFile()), `tables ${String(WIDE_TABLES)}`);
      await typeAt(page, "SELECT * FROM ");

      await page.evaluate(ARM_COMPLETION_TIMER);
      await page.keyboard.press(BASIC_COMPLETION);
      await options(page).first().waitFor({ timeout: LAUNCH_TIMEOUT_MS });

      const elapsed = await page.evaluate<number | null>(COMPLETION_MS);
      // Straight to stderr: Vitest keeps a passing test's console output to itself.
      process.stderr.write(
        `completion after FROM over ${String(WIDE_TABLES)} tables: ${elapsed === null ? "none" : elapsed.toFixed(1)} ms\n`,
      );
      expect(elapsed).not.toBeNull();
      expect(elapsed ?? Number.POSITIVE_INFINITY).toBeLessThan(WIDE_COMPLETION_BUDGET_MS);
      expect((await optionLabels(page)).slice(0, 2)).toEqual(["t001", "t002"]);
      await captureWindow(page, "wide-schema");
    },
    SCENARIO_TIMEOUT_MS,
  );
});
