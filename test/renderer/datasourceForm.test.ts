import { describe, expect, it } from "vitest";
import {
  applyParsedUrl,
  draftFromView,
  draftProblems,
  duplicateDraft,
  newDraft,
  secretPlaceholder,
  toSaveRequest,
  uniqueName,
  withoutPassword,
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

  it("givenSavedTimeouts_whenDraftRoundTrips_thenSaveRequestCarriesThem", () => {
    const draft = draftFromView({ ...SAVED, keepAliveSeconds: 0, statementTimeoutSeconds: 45 }, POSTGRES_PLUGIN);

    expect(draft.keepAliveSeconds).toBe("0");
    expect(draft.statementTimeoutSeconds).toBe("45");
    expect(toSaveRequest(draft, POSTGRES_PLUGIN).datasource).toMatchObject({
      keepAliveSeconds: 0,
      statementTimeoutSeconds: 45,
    });
  });

  it("givenBlankTimeouts_whenSaveRequestBuilt_thenKeysAbsent", () => {
    const request = toSaveRequest(draftFromView(SAVED, POSTGRES_PLUGIN), POSTGRES_PLUGIN);

    expect(request.datasource).not.toHaveProperty("keepAliveSeconds");
    expect(request.datasource).not.toHaveProperty("statementTimeoutSeconds");
  });

  it("givenTimeoutsOutOfRange_whenChecked_thenProblems", () => {
    const draft = {
      ...draftFromView(SAVED, POSTGRES_PLUGIN),
      keepAliveSeconds: "9000",
      statementTimeoutSeconds: "1.5",
    };

    expect(draftProblems(draft, POSTGRES_PLUGIN)).toEqual([
      "The keepalive interval must be between 0 and 7,200.",
      "The statement timeout must be a whole number of seconds.",
    ]);
  });

  it("givenParsedUrl_whenApplied_thenFieldsFilledPasswordSetAndHiddenFromUrlRow", () => {
    const draft = draftFromView(SAVED, POSTGRES_PLUGIN);

    const next = applyParsedUrl(
      draft,
      POSTGRES_PLUGIN,
      {
        values: { host: "db.example.com", port: 6543, database: "sales" },
        secrets: { password: "s3cret" },
        ignored: ["target_session_attrs"],
      },
      " postgresql://alice:s3cret@db.example.com:6543/sales?target_session_attrs=any ",
    );

    expect(next.values).toMatchObject({ host: "db.example.com", port: "6543", database: "sales", user: "app" });
    expect(next.secrets).toEqual({ password: { action: "set", value: "s3cret" } });
    expect(next.url).toBe("postgresql://alice@db.example.com:6543/sales?target_session_attrs=any");
    expect(next.urlNote).toEqual({ kind: "applied", secrets: ["Password"], ignored: ["target_session_attrs"] });
    expect(next.dirty).toBe(true);
  });

  it("givenPasswordParameter_whenStripped_thenUrlKeepsTheRest", () => {
    expect(withoutPassword("postgresql://h/db?password=x&sslmode=require")).toBe("postgresql://h/db?sslmode=require");
    expect(withoutPassword("postgresql://h/db?sslmode=require&password=x")).toBe("postgresql://h/db?sslmode=require");
    expect(withoutPassword("postgresql://u:p@h/db")).toBe("postgresql://u@h/db");
  });
});
