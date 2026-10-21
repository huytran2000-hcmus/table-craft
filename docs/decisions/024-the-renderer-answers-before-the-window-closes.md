# 024: The renderer answers before the window closes

Status: Accepted

## Decision

Main holds every close of the window, and so every quit, until the renderer answers. On `close`
main calls `preventDefault()` and sends `window.close-requested` once; the renderer asks Commit,
Rollback or Cancel for every console with an open transaction, flushes pending console autosaves,
and invokes `window.answer-close { proceed }`. Proceed closes the window, or finishes the quit when
the close came from `before-quit`; Cancel leaves both the window and the app running. A crashed
renderer cannot answer, so main lets its window close at once (`webContents.isCrashed()`).

`main/closeGuard.ts` holds the logic behind a `GuardedWindow` slice of `BrowserWindow`, so it is
unit-tested without Electron.

## Rationale

Plan 006 lets a console hold an open transaction (manual mode, or an explicit `BEGIN` in auto), and
it autosaves console text 500 ms after the last edit. Quitting with either pending loses work
silently: the engine's sessions close and the database rolls back, and the last keystrokes never
reach disk. DataGrip asks first, and so does table-craft.

Only the renderer knows which consoles have open transactions and pending saves (decision 002: main
holds no state). The alternatives fail in practice:

- `beforeunload` in the renderer must answer synchronously, but the answer needs a dialog and
  engine round trips. Refusing the unload also aborts `app.quit()`, so the renderer would have to
  know whether a quit was under way and start it again.
- Main asking each engine for its open transactions would put main in the request path and still
  could not show the in-app dialog or flush the renderer's debounced saves.
- Letting the engines roll back on exit is what happens without the guard; it is the data loss the
  prompt exists to prevent.

## Consequences

- A renderer that hangs without crashing keeps the window open until the user force-quits. The
  guard trusts the renderer to answer; there is no timeout, because a timeout would close the
  window under an open dialog.
- Test harnesses that close the app must settle open transactions first, or close with a deadline
  and kill the process (`test/e2e/console.smoke.test.ts` does both).
- A second window, when one exists, needs its own `guard` call; the guard already keys its state by
  window.
