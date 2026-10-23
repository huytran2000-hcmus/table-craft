# 041: XLSX is written in-house as a streamed ZIP

Status: Accepted

## Decision

Export writes XLSX with its own encoder in `packages/core/src/export/`: a streaming ZIP writer
(`zip.ts`) that deflates each chunk as it arrives with `zlib`'s sync flush, records sizes and CRC
(`zlib.crc32`) in data descriptors after each entry, and switches to ZIP64 fields only for an entry
or archive past 4 GiB; and a SpreadsheetML writer (`xlsx.ts`) that emits one worksheet per
1,048,576 rows (the format's limit, header included), inline strings rather than a shared-string
table, a frozen bold header, numbers as numbers when they fit Excel's 15 significant digits,
booleans as booleans, and everything else as text. Cells past 32,767 characters are cut and
counted on the task; XML-invalid characters are written as `_xHHHH_`.

## Rationale

The libraries that write XLSX (`exceljs`, `xlsx`/SheetJS) either build the workbook in memory or
stream only with a shared-string table that grows with every distinct value, which breaks the
constant-memory promise of decision 040 for a multi-gigabyte result; SheetJS's current releases
are also not on npm. The subset an export needs, one header row and typed cells, is a few hundred
lines over the ZIP and Open XML specifications, and a ZIP writer independent of any library lets
the tests read archives with their own reader (`test/support/zipReader.ts`) and with `unzip -t`.

Inline strings make files larger than shared strings for repetitive text, but keep memory flat
and need no second pass. Writing sizes in data descriptors lets each entry stream without seeking
back, which a `.part` file written once and renamed (decision 040) requires.

## Consequences

- A 6,000,000-row export is six sheets and about 290 MB, written at flat memory. Microsoft Excel
  for macOS, openpyxl and `unzip -t` read the encoder's output without a repair prompt.
- No dates or number formats: temporal values are text as the database printed them, so nothing
  is shifted by a time zone.
- Shared strings, styles beyond the header, and column widths are out of scope until someone asks;
  adding them means a second pass or a bounded string table.
