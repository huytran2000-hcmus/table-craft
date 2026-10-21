import type { Row } from "@table-craft/plugin-api";

/**
 * `SELECT * FROM type_probe ORDER BY id` as wire values. Identical for every database: the schemas
 * under `test/db/schema/` seed the same row, and the value rules (decision 017) make it cross the
 * wire the same way.
 */
export const TYPE_PROBE_EXPECTED: readonly Row[] = [
  [
    1,
    42,
    { kind: "bigint", value: "9007199254740993" },
    "1234567890123456.7890",
    "héllo, 世界 🌍",
    true,
    { kind: "json", text: '{"a": 1, "b": [true, null]}' },
    { kind: "bytes", preview: "deadbeef", length: 4 },
    "2024-02-29",
    "2024-02-29 13:45:30",
  ],
  [2, null, null, null, null, null, null, null, null, null],
];
