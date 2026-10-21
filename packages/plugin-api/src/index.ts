export { MANIFEST_FILE, pluginManifestSchema, type PluginManifest } from "./manifest.js";
export {
  CAPABILITIES,
  type Capability,
  type Column,
  type DatasourcePlugin,
  type ExecuteResult,
  type Row,
  type Session,
} from "./plugin.js";
export {
  BYTES_PREVIEW_LENGTH,
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
