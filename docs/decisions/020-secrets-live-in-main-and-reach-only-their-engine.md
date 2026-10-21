# 020: Secrets live in main and reach only their engine

Status: Accepted

## Decision

- Each secret field of a datasource has a save mode, as in DataGrip: **Forever** (encrypted with
  `safeStorage` into `<userData>/secrets.json`), **Until restart** (kept in main's memory) or
  **Never** (asked for in a dialog on every connect, then forgotten once the engine has it).
- `datasources.json` never holds a secret value, only its save mode.
- Main decrypts a secret only to put it in that datasource's `engine.boot`. It never sends a
  secret to a renderer. The form shows a saved secret as a placeholder; leaving it blank keeps it,
  and "Clear" removes it.
- When `safeStorage.isEncryptionAvailable()` is false, Forever is disabled in the form with the
  reason, and the other two modes still work. There is no plaintext fallback.

## Rationale

Decision 002 makes main the owner of `safeStorage`, and decision 006 makes plugins trusted only
inside the engine of the datasource they serve. Keeping secrets out of the renderer means a
renderer bug or a devtools session cannot read a stored password. The three modes match what
DataGrip users expect, and Never is how people connect to production without storing a password.

## Consequences

- Test Connection on an edited datasource merges the stored secret in main, so the renderer still
  never sees it.
- The smoke harness launches Electron with `--use-mock-keychain` on macOS so tests never touch the
  real login keychain.
- Losing the OS keychain makes Forever secrets unreadable; such a datasource behaves as Never
  until the user saves the secret again.
