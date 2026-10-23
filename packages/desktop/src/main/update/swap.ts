/**
 * The macOS swap (decision 044): a detached `sh` script that waits for TableCraft to quit, moves
 * the installed bundle aside, moves the staged one in, and rolls back if the new bundle is not
 * runnable. A script and not main, because main cannot replace the bundle it is running from.
 *
 * Every path is single-quoted into the script; nothing is interpolated from the manifest except
 * through paths main built itself.
 */

export interface SwapPlan {
  /** The process to wait for: TableCraft's main. */
  readonly pid: number;
  /** The installed `TableCraft.app`. */
  readonly bundlePath: string;
  /** The verified new `TableCraft.app`, inside {@link stagingPath}. */
  readonly stagedPath: string;
  /** The staging directory beside the bundle; removed whatever happens. */
  readonly stagingPath: string;
  /** `Contents/MacOS/<name>`, relative to the bundle. */
  readonly executable: string;
  /** Where the script's lines go; main appends them to the app log on the next launch. */
  readonly logPath: string;
}

/** Long enough for the close guard's commit-or-roll-back to finish, short enough to give up visibly. */
export const QUIT_WAIT_TENTHS = 600;
export const BACKUP_SUFFIX = ".update-backup";
export const SWAP_SCRIPT_FILE = "table-craft-update-swap.sh";

/** `'…'` with every `'` closed, escaped and reopened, so any path survives the shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function swapScript(plan: SwapPlan): string {
  const backup = `${plan.bundlePath}${BACKUP_SUFFIX}`;
  return `#!/bin/sh
PID=${String(plan.pid)}
TARGET=${shellQuote(plan.bundlePath)}
STAGED=${shellQuote(plan.stagedPath)}
STAGING=${shellQuote(plan.stagingPath)}
BACKUP=${shellQuote(backup)}
EXECUTABLE=${shellQuote(plan.executable)}
exec >>${shellQuote(plan.logPath)} 2>&1
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
relaunch() { nohup "$TARGET/$EXECUTABLE" >/dev/null 2>&1 & }
give_up() { say "$1"; rm -rf "$STAGING"; relaunch; exit 1; }
say "waiting for TableCraft (pid $PID) to quit"
waited=0
while kill -0 "$PID" 2>/dev/null; do
  waited=$((waited + 1))
  if [ "$waited" -gt ${String(QUIT_WAIT_TENTHS)} ]; then
    say "TableCraft did not quit; nothing was replaced"
    rm -rf "$STAGING"
    exit 1
  fi
  sleep 0.1
done
rm -rf "$BACKUP"
mv "$TARGET" "$BACKUP" || give_up "the installed app could not be moved aside; nothing was replaced"
if ! mv "$STAGED" "$TARGET"; then
  mv "$BACKUP" "$TARGET"
  give_up "the new app could not be moved in; the installed app was restored"
fi
if [ ! -x "$TARGET/$EXECUTABLE" ]; then
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
  give_up "the new app has no executable; the installed app was restored"
fi
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
rm -rf "$BACKUP" "$STAGING"
say "replaced; relaunching"
relaunch
exit 0
`;
}
