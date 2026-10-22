export {
  byName,
  type ColumnMeta,
  type ForeignKey,
  type Index,
  type Introspector,
  type Key,
  type Namespace,
  type NamespaceCatalog,
  type Relation,
  type RelationKind,
  type Routine,
  type Sequence,
} from "./catalog.js";
export {
  COMPLETION_KINDS,
  type CompletionCatalog,
  type CompletionItem,
  type CompletionKind,
  type CompletionRequest,
  type CompletionResult,
  type CompletionScope,
  type Declaration,
  type IncomingForeignKey,
  type ResolveRequest,
} from "./completion.js";
export {
  DefinitionNotFoundError,
  isPluginError,
  PLUGIN_ERROR_CODES,
  PluginError,
  type PluginErrorCode,
} from "./errors.js";
export {
  type ExplainedPlan,
  type Explainability,
  type ExplainOptions,
  type PlanNode,
  type PlanProperty,
} from "./explain.js";
export {
  CONNECTION_FIELD_GROUPS,
  CONNECTION_FIELD_KINDS,
  connectionFieldSchema,
  MANIFEST_FILE,
  pluginManifestSchema,
  type ConnectionField,
  type ConnectionFieldGroup,
  type ConnectionFieldKind,
  type PluginManifest,
} from "./manifest.js";
export {
  CAPABILITIES,
  type Capability,
  type Column,
  type ConnectOptions,
  type DatasourcePlugin,
  type ExecuteResult,
  GENERATED_STATEMENTS,
  type GeneratedStatement,
  type Row,
  type Session,
  type SqlLanguage,
  STATEMENT_KINDS,
  type StatementClass,
  type StatementKind,
  type StatementSpan,
  TRANSACTION_MODES,
  type TransactionMode,
  type Transactions,
} from "./plugin.js";
export {
  BYTES_PREVIEW_LENGTH,
  toWireInteger,
  toWireValue,
  type BigIntValue,
  type BytesValue,
  type DateValue,
  type JsonValue,
  type WireValue,
} from "./values.js";
export { API_VERSION, isCompatible, parseVersion } from "./version.js";
/** Plugins build `connectionSchema` with the zod the contract was compiled against, not their own pick. */
export { z } from "zod";
