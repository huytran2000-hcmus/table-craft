import type { Column } from "@table-craft/plugin-api";
import { insertStatement, mysqlDecimal } from "@table-craft/plugin-mysql/bulk";
import { copyLine } from "@table-craft/plugin-postgres/bulk";
import { describe, expect, it } from "vitest";

const quote = (name: string): string => `\`${name}\``;

describe("postgres copyLine", () => {
  it("givenSpecialCharacters_whenEncoded_thenBackslashEscapedAndNullIsBackslashN", () => {
    const columns: Column[] = [
      { name: "a", type: "text" },
      { name: "b", type: "text" },
      { name: "c", type: "text" },
    ];

    expect(copyLine(["tab\there\\", null, "line\r\nbreak"], columns)).toBe("tab\\there\\\\\t\\N\tline\\r\\nbreak\n");
  });

  it("givenExportedBytesInByteaColumn_whenEncoded_thenServerHexForm", () => {
    expect(
      copyLine(
        ["0xdeadbeef", "0xdeadbeef"],
        [
          { name: "p", type: "bytea" },
          { name: "t", type: "text" },
        ],
      ),
    ).toBe("\\\\xdeadbeef\t0xdeadbeef\n");
  });
});

describe("mysql insertStatement", () => {
  it("givenRows_whenBuilt_thenPlaceholdersAndValuesSideBySide", () => {
    const columns: Column[] = [
      { name: "id", type: "int" },
      { name: "flag", type: "tinyint(1)" },
      { name: "payload", type: "varbinary(64)" },
    ];

    const statement = insertStatement("`t`", columns, quote, [
      ["1", "true", "0x00ff"],
      ["2", "FALSE", null],
    ]);

    expect(statement.sql).toBe("INSERT INTO `t` (`id`, `flag`, `payload`) VALUES (?, ?, ?), (?, ?, ?)");
    expect(statement.values).toEqual(["1", "1", Buffer.from([0, 255]), "2", "0", null]);
  });

  it("givenWiderTinyint_whenBuilt_thenTextKept", () => {
    expect(insertStatement("`t`", [{ name: "n", type: "tinyint(4)" }], quote, [["true"]]).values).toEqual(["true"]);
  });

  it("givenInferredDecimal_whenTyped_thenPrecisionKeepsHeadroomAndScale", () => {
    expect(mysqlDecimal({ kind: "decimal", integerDigits: 4, scale: 2 })).toBe("DECIMAL(20,2)");
    expect(mysqlDecimal({ kind: "decimal", integerDigits: 60, scale: 40 })).toBe("DECIMAL(65,30)");
  });
});
