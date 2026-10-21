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
export { isPluginError, PLUGIN_ERROR_CODES, PluginError, type PluginErrorCode } from "./errors.js";
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
  type Row,
  type Session,
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
