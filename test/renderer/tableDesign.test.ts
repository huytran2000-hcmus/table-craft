import { describe, expect, it } from "vitest";
import type { DdlScript, TableDesign } from "@table-craft/desktop/engine/protocol.js";
import {
  addColumn,
  designProblem,
  emptyDesign,
  moveColumn,
  parseList,
  removeColumn,
  scriptNotes,
  scriptText,
  setColumn,
  setPrimaryKey,
} from "@table-craft/desktop/renderer/model/tableDesign.js";

const TYPES = ["integer", "text"];

function withIndexAndKey(): TableDesign {
  const design = addColumn(emptyDesign("notes", TYPES), "text");
  return {
    ...design,
    indexes: [{ name: "notes_idx", columns: ["column_2"], unique: false, original: null }],
    foreignKeys: [
      {
        name: "notes_fk",
        columns: ["column_2"],
        target: { path: ["public"], relation: "parents", columns: ["label"] },
        onDelete: null,
        onUpdate: null,
        original: null,
      },
    ],
  };
}

describe("table design", () => {
  it("givenNewTable_whenStarted_thenOneKeyColumnOfFirstType", () => {
    const design = emptyDesign("notes", TYPES);

    expect(design.columns).toMatchObject([{ name: "id", type: "integer", nullable: false, original: null }]);
    expect(design.primaryKey).toEqual(["id"]);
    expect(designProblem(design)).toBeNull();
  });

  it("givenColumnRenamed_whenIndexAndKeyListIt_thenTheyFollow", () => {
    const design = setColumn(withIndexAndKey(), 1, { name: "label" });

    expect(design.indexes[0]?.columns).toEqual(["label"]);
    expect(design.foreignKeys[0]?.columns).toEqual(["label"]);
  });

  it("givenColumnRemoved_whenConstraintsListedOnlyIt_thenTheyGoToo", () => {
    const design = removeColumn(withIndexAndKey(), 1);

    expect(design.columns.map((column) => column.name)).toEqual(["id"]);
    expect(design.indexes).toEqual([]);
    expect(design.foreignKeys).toEqual([]);
  });

  it("givenColumnAddedToKey_whenSet_thenKeyInTableOrderAndColumnNotNull", () => {
    const design = setPrimaryKey(moveColumn(addColumn(emptyDesign("t", TYPES), "text"), 1, -1), "column_2", true);

    expect(design.primaryKey).toEqual(["column_2", "id"]);
    expect(design.columns[0]).toMatchObject({ name: "column_2", nullable: false });
  });

  it("givenDuplicateOrUntypedColumns_whenChecked_thenProblemSaysWhich", () => {
    const base = addColumn(emptyDesign("t", TYPES), "text");

    expect(designProblem(setColumn(base, 1, { name: "id" }))).toBe("Two columns are named id.");
    expect(designProblem(setColumn(base, 1, { type: " " }))).toBe("Give column_2 a type.");
    expect(designProblem({ ...base, name: "" })).toBe("Name the table.");
  });

  it("givenTypedList_whenParsed_thenTrimmedWithoutBlanks", () => {
    expect(parseList(" a, b ,,c,")).toEqual(["a", "b", "c"]);
  });

  it("givenScript_whenShown_thenEveryPartInOrderTerminatedAndTransactionNoted", () => {
    const script: DdlScript = {
      prepare: ["PRAGMA foreign_keys = OFF"],
      statements: ["CREATE TABLE t (id INTEGER)", "DROP TABLE u;"],
      verify: ["PRAGMA foreign_key_check"],
      finish: ["PRAGMA foreign_keys = ON"],
      transactional: true,
      notes: ["Rebuilds the table."],
    };

    expect(scriptText(script)).toBe(
      "PRAGMA foreign_keys = OFF;\n\nCREATE TABLE t (id INTEGER);\n\nDROP TABLE u;\n\nPRAGMA foreign_key_check;\n\nPRAGMA foreign_keys = ON;",
    );
    expect(scriptNotes(script)).toEqual([
      "Rebuilds the table.",
      "Runs in one transaction: if a statement fails, nothing is changed.",
    ]);
    expect(scriptNotes({ ...script, statements: [] })).toEqual(["Rebuilds the table."]);
  });
});
