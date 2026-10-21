import { describe, expect, it } from "vitest";
import { createSecretStore, SECRETS_FILE, SecretStoreError } from "@table-craft/desktop/main/secrets.js";
import { fakeCipher, memoryFiles } from "../support/memoryFiles.js";

const DIRECTORY = "/profile";
const PATH = `${DIRECTORY}/${SECRETS_FILE}`;
const ID = "pg";
const KEY = "password";
const SECRET = "hunter2";

async function secrets(files = memoryFiles(), cipher = fakeCipher()) {
  return { files, cipher, store: await createSecretStore({ directory: DIRECTORY, files, cipher }) };
}

describe("secret store", () => {
  it("givenForeverSecret_whenStoreReopened_thenDecryptedFromSecretsFile", async () => {
    const { files, cipher, store } = await secrets();
    await store.set(ID, KEY, "forever", SECRET);

    const reopened = await createSecretStore({ directory: DIRECTORY, files, cipher });

    expect(files.contents.get(PATH)).not.toContain(SECRET);
    expect(reopened.get(ID, KEY, "forever")).toBe(SECRET);
  });

  it("givenUntilRestartSecret_whenStoreReopened_thenGone", async () => {
    const { files, cipher, store } = await secrets();
    await store.set(ID, KEY, "untilRestart", SECRET);

    expect(store.get(ID, KEY, "untilRestart")).toBe(SECRET);
    expect(files.contents.has(PATH)).toBe(false);
    expect((await createSecretStore({ directory: DIRECTORY, files, cipher })).get(ID, KEY, "untilRestart")).toBe(
      undefined,
    );
  });

  it("givenNeverSecret_whenSet_thenNothingKept", async () => {
    const { store } = await secrets();
    await store.set(ID, KEY, "never", SECRET);

    expect(store.get(ID, KEY, "never")).toBeUndefined();
    expect(store.get(ID, KEY, "untilRestart")).toBeUndefined();
  });

  it("givenEncryptionUnavailable_whenSavingForever_thenRefusedWithReason", async () => {
    const cipher = fakeCipher();
    cipher.available = false;
    const { files, store } = await secrets(memoryFiles(), cipher);

    await expect(store.set(ID, KEY, "forever", SECRET)).rejects.toThrow(SecretStoreError);
    expect(store.encryption()).toEqual({ available: false, reason: expect.stringContaining("keychain") as unknown });
    expect(files.contents.has(PATH)).toBe(false);
  });

  it("givenKeychainLost_whenForeverSecretRead_thenUndefinedSoUserIsAsked", async () => {
    const { store, cipher } = await secrets();
    await store.set(ID, KEY, "forever", SECRET);
    cipher.lost = true;

    expect(store.get(ID, KEY, "forever")).toBeUndefined();
  });

  it("givenForeverSecret_whenModeChangedToUntilRestart_thenMovedOutOfTheFile", async () => {
    const { files, store } = await secrets();
    await store.set(ID, KEY, "forever", SECRET);

    await store.changeMode(ID, KEY, "forever", "untilRestart");

    expect(store.get(ID, KEY, "untilRestart")).toBe(SECRET);
    expect(JSON.parse(files.contents.get(PATH) ?? "")).toEqual({ version: 1, secrets: {} });
  });

  it("givenStoredSecrets_whenClearedForDatasource_thenAllGone", async () => {
    const { store } = await secrets();
    await store.set(ID, KEY, "forever", SECRET);
    await store.set(ID, "token", "untilRestart", SECRET);

    await store.clearAll(ID);

    expect(store.get(ID, KEY, "forever")).toBeUndefined();
    expect(store.get(ID, "token", "untilRestart")).toBeUndefined();
  });
});
