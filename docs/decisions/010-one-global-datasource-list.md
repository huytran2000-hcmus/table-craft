# 010: One global datasource list

Status: Accepted

## Decision

There are no projects. All datasources live in one list, grouped by user folders, in one window.

| Data          | Where                                                 |
| ------------- | ----------------------------------------------------- |
| Datasources   | `<userData>/datasources.json`, no secrets             |
| Secrets       | `safeStorage`-encrypted, referenced by id             |
| Console text  | `<userData>/consoles/<datasourceId>/*.sql`, autosaved |
| Query history | `<userData>/history.sqlite`                           |
| App settings  | `<userData>/settings.json`                            |

## Rationale

DataGrip's projects add a "which project am I in" step most single users never need, and preman's
workspace-on-disk model exists because collections are shared files; datasources are not.
Folders cover prod / staging / local sorting. Consoles are scratch buffers, so autosave is what
users expect, unlike preman's explicit save.

## Consequences

- Sharing datasource definitions between machines is out of scope; an import/export file without
  secrets can layer on later.
- `datasources.json` carries a schema version and migrates forward on load.
