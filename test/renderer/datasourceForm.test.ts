import { describe, expect, it } from "vitest";
import {
  draftFromView,
  draftProblems,
  duplicateDraft,
  newDraft,
  secretPlaceholder,
  toSaveRequest,
  uniqueName,
} from "@table-craft/desktop/renderer/model/datasourceForm.js";
import { POSTGRES_PLUGIN, view } from "./datasourceViews.js";

const SAVED = view({
  id: "pg",
  name: "pg",
  folder: "Docker/Main",
  color: "red",
  config: { host: "db", port: 55432, user: "app", sslMode: "require" },
  secretModes: { password: "forever" },
  storedSecrets: ["password"],
});

describe("datasource form", () => {
  it("givenNewPostgresDraft_whenCreated_thenManifestDefaultsAndDefaultSecretMode", () => {
    const draft = newDraft("new-0", POSTGRES_PLUGIN, ["PostgreSQL"], "forever", "Local");

    expect(draft.name).toBe("PostgreSQL (2)");
    expect(draft.values).toEqual({ host: "localhost", port: "5432", database: "", user: "", sslMode: "disable" });
    expect(draft.secretModes).toEqual({ password: "forever" });
    expect(draft.folder).toBe("Local");
    expect(draft.dirty).toBe(true);
  });

  it("givenDraft_whenSaveRequestBuilt_thenNumbersParsedAndBlankOptionalFieldsDropped", () => {
    const draft = {
      ...newDraft("new-0", POSTGRES_PLUGIN, [], "never"),
      values: { host: "h", port: "6543", database: "", user: "u", sslMode: "disable" },
    };

    const request = toSaveRequest(draft, POSTGRES_PLUGIN);

    expect(request.datasource.config).toEqual({ host: "h", port: 6543, user: "u", sslMode: "disable" });
    expect(request.datasource.folder).toBeNull();
    expect(request.secrets).toEqual({ password: { action: "keep" } });
  });

  it("givenSavedDatasource_whenEdited_thenSecretBlankMeansKeepAndPlaceholderSaysSaved", () => {
    const draft = draftFromView(SAVED, POSTGRES_PLUGIN);

    expect(draft.values.port).toBe("55432");
    expect(draft.secrets).toEqual({ password: { action: "keep" } });
    expect(secretPlaceholder(draft, "password")).toBe("Saved; leave blank to keep");
    expect(toSaveRequest(draft, POSTGRES_PLUGIN).datasource.id).toBe("pg");
  });

  it("givenMissingRequiredAndBadNumber_whenChecked_thenProblemsNameTheFields", () => {
    const draft = { ...draftFromView(SAVED, POSTGRES_PLUGIN), values: { host: "", port: "abc", user: "u" } };

    expect(draftProblems(draft, POSTGRES_PLUGIN)).toEqual(["Host is required.", "Port must be a number."]);
  });

  it("givenSavedDatasource_whenDuplicated_thenNewIdlessCopyWithoutStoredSecrets", () => {
    const copy = duplicateDraft("new-1", SAVED, POSTGRES_PLUGIN, ["pg", "pg copy"], "forever");

    expect(copy.id).toBeUndefined();
    expect(copy.name).toBe("pg copy (2)");
    expect(copy.storedSecrets).toEqual([]);
    expect(copy.values.host).toBe("db");
  });

  it("givenTakenNames_whenUniqueNameAsked_thenNextFreeSuffix", () => {
    expect(uniqueName("a", [])).toBe("a");
    expect(uniqueName("a", ["a", "a (2)"])).toBe("a (3)");
  });
});
