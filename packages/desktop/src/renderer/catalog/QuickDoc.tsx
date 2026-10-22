import type { ReactNode } from "react";
import {
  quickDocOf,
  RELATION_KIND_LABELS,
  type ColumnDoc,
  type DocColumn,
  type DocForeignKey,
  type RelationDoc,
} from "@table-craft/desktop/renderer/model/quickDoc.js";
import { useCatalog } from "@table-craft/desktop/renderer/state/catalog.js";
import { useQuickDoc } from "@table-craft/desktop/renderer/state/quickDoc.js";
import { ColumnIcon, KeyIcon, NotNullIcon, TableIcon } from "@table-craft/desktop/renderer/ui/icons.js";
import { Popover } from "@table-craft/desktop/renderer/ui/Popover.js";

const NOT_IN_CATALOG = "Not in the catalog yet; synchronize the data source.";

function list(names: readonly string[]): string {
  return names.join(", ");
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 px-cell py-1">
      <h3 className="text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

function Header({
  kind,
  name,
  comment,
}: {
  readonly kind: string;
  readonly name: string;
  readonly comment: string | null;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-1 border-b border-line px-cell py-1">
      <div className="flex items-center gap-1">
        <span className="text-ink-muted">{kind}</span>
        <span data-testid="quick-doc-name" className="truncate font-grid text-grid">
          {name}
        </span>
      </div>
      {comment === null ? null : (
        <p data-testid="quick-doc-comment" className="break-words text-ink">
          {comment}
        </p>
      )}
    </header>
  );
}

function ColumnRow({ column }: { readonly column: DocColumn }) {
  return (
    <tr data-testid="quick-doc-column">
      <td className="pr-gap align-top">
        <span className="flex items-center gap-1">
          {column.marks.includes("primary") ? (
            <KeyIcon aria-label="primary key" weight="fill" className="size-icon shrink-0 text-key-icon" />
          ) : column.marks.includes("foreign") ? (
            <KeyIcon aria-label="foreign key" className="size-icon shrink-0 text-key-icon" />
          ) : (
            <ColumnIcon aria-hidden className="size-icon shrink-0 text-ink-muted" />
          )}
          {column.name}
        </span>
      </td>
      <td className="pr-gap align-top text-ink-muted">{column.type}</td>
      <td className="pr-gap align-top text-ink-muted">{column.nullable ? "" : "NOT NULL"}</td>
      <td className="align-top text-ink-muted">{column.default ?? ""}</td>
    </tr>
  );
}

function ForeignKeys({
  title,
  keys,
  arrow,
}: {
  readonly title: string;
  readonly keys: readonly DocForeignKey[];
  readonly arrow: string;
}) {
  if (keys.length === 0) return null;
  return (
    <Section title={title}>
      {keys.map((key) => (
        <p
          key={`${key.other}.${key.name}`}
          data-testid="quick-doc-foreign-key"
          className="font-grid text-grid break-words"
        >
          {key.name}: ({list(key.columns)}) {arrow} {key.other}({list(key.otherColumns)})
        </p>
      ))}
    </Section>
  );
}

function RelationBody({ doc }: { readonly doc: RelationDoc }) {
  return (
    <>
      <Header kind={RELATION_KIND_LABELS[doc.relationKind]} name={doc.qualifiedName} comment={doc.comment} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Section title="Columns">
          <table className="font-grid text-grid">
            <tbody>
              {doc.columns.map((column) => (
                <ColumnRow key={column.name} column={column} />
              ))}
            </tbody>
          </table>
        </Section>
        {doc.primaryKey === null ? null : (
          <Section title="Primary key">
            <p className="font-grid text-grid">
              {doc.primaryKey.name} ({list(doc.primaryKey.columns)})
            </p>
          </Section>
        )}
        <ForeignKeys title="Foreign keys" keys={doc.outgoing} arrow="→" />
        <ForeignKeys title="Referenced by" keys={doc.incoming} arrow="←" />
        {doc.indexes.length === 0 ? null : (
          <Section title="Indexes">
            {doc.indexes.map((index) => (
              <p key={index.name} className="font-grid text-grid">
                {index.name} ({list(index.columns)}){index.unique ? " UNIQUE" : ""}
              </p>
            ))}
          </Section>
        )}
      </div>
    </>
  );
}

function ColumnBody({ doc }: { readonly doc: ColumnDoc }) {
  const { column } = doc;
  return (
    <>
      <Header kind="Column" name={doc.qualifiedName} comment={column.comment} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Section title="Type">
          <p data-testid="quick-doc-type" className="flex items-center gap-1 font-grid text-grid">
            {column.type}
            {column.nullable ? (
              <span className="text-ink-muted">NULL</span>
            ) : (
              <span className="flex items-center gap-1 text-ink-muted">
                <NotNullIcon aria-hidden className="size-icon" /> NOT NULL
              </span>
            )}
          </p>
        </Section>
        {column.default === null ? null : (
          <Section title="Default">
            <p className="font-grid text-grid">{column.default}</p>
          </Section>
        )}
        {doc.keys.length === 0 ? null : (
          <Section title="Keys and indexes">
            <p className="font-grid text-grid">{list(doc.keys)}</p>
          </Section>
        )}
      </div>
    </>
  );
}

/** Quick Documentation (F1): what the renderer's catalog knows of a relation or column (plan 010). */
export function QuickDoc() {
  const shown = useQuickDoc((state) => state.shown);
  const catalog = useCatalog((state) => (shown === null ? undefined : state.catalogs[shown.target.datasourceId]));
  if (shown === null) return null;
  const doc = quickDocOf(catalog, shown.target);
  return (
    <Popover
      anchor={shown.anchor}
      label="Quick Documentation"
      testId="quick-doc"
      onClose={() => useQuickDoc.getState().close()}
    >
      {doc === null ? (
        <p className="flex items-center gap-1 px-cell py-1 text-ink-muted">
          <TableIcon aria-hidden className="size-icon" />
          {shown.target.relation}: {NOT_IN_CATALOG}
        </p>
      ) : doc.kind === "relation" ? (
        <RelationBody doc={doc} />
      ) : (
        <ColumnBody doc={doc} />
      )}
    </Popover>
  );
}
