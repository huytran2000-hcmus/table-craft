const lines = (...rows: string[]): string => rows.join("\n");

/** The reference layout from plan 030, as DataGrip writes it. */
export const GOLDEN = lines(
  "EXPLAIN",
  "SELECT trans_id,",
  "       app_id,",
  "       event_code,",
  "       product_code,",
  "       JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.sources[0].asset_type'))      AS source_asset,",
  "       JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.destinations[0].asset_type')) AS dest_asset,",
  "       JSON_EXTRACT(extra_data, '$.order.order_amount')                       AS amount,",
  "       JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.order.app_trans_id'))         AS app_trans_id,",
  "       status,",
  "       trans_status,",
  "       reason_status,",
  "       JSON_EXTRACT(reason_status, '$.metadata.pe_code')                      AS pe_code,",
  "       JSON_EXTRACT(reason_status, '$.metadata.bc_code')                      AS bc_code,",
  "       JSON_EXTRACT(reason_status, '$.metadata.bc_trans_status')              AS bc_trans_status,",
  "       JSON_EXTRACT(reason_status, '$.metadata.bc_trans_id')                  AS bc_trans_id,",
  "       JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.initiator.zalopay_id'))       AS zalopay_id,",
  "       created_at,",
  "       updated_at",
  "FROM saga_context_202607 USE INDEX (saga_context_created_at_idx)",
  "WHERE created_at > '2026-07-09 03:00:00'",
  "  AND created_at < '2026-07-09 03:45:00'",
  "  AND status NOT IN ('SUCCESS')",
  "  AND (",
  "    JSON_EXTRACT(extra_data, '$.sources[0].asset_type') IN ('BDA', 'BDC', 'BIC', 'BID', 'BCO', 'BNP', 'FDA', 'MDA') OR",
  "    JSON_EXTRACT(extra_data, '$.destinations[0].asset_type') IN ('BDA', 'BDC', 'BIC', 'BID', 'NMCA', 'MDA', 'FDA'));",
);

/** The golden squashed onto one line with lower-case keywords; function names stay as written. */
export const GOLDEN_ONE_LINE =
  "explain select trans_id, app_id, event_code, product_code, " +
  "JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.sources[0].asset_type')) as source_asset, " +
  "JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.destinations[0].asset_type')) as dest_asset, " +
  "JSON_EXTRACT(extra_data, '$.order.order_amount') as amount, " +
  "JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.order.app_trans_id')) as app_trans_id, " +
  "status, trans_status, reason_status, " +
  "JSON_EXTRACT(reason_status, '$.metadata.pe_code') as pe_code, " +
  "JSON_EXTRACT(reason_status, '$.metadata.bc_code') as bc_code, " +
  "JSON_EXTRACT(reason_status, '$.metadata.bc_trans_status') as bc_trans_status, " +
  "JSON_EXTRACT(reason_status, '$.metadata.bc_trans_id') as bc_trans_id, " +
  "JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.initiator.zalopay_id')) as zalopay_id, " +
  "created_at, updated_at from saga_context_202607 use index (saga_context_created_at_idx) " +
  "where created_at > '2026-07-09 03:00:00' and created_at < '2026-07-09 03:45:00' " +
  "and status not in ('SUCCESS') and (JSON_EXTRACT(extra_data, '$.sources[0].asset_type') in " +
  "('BDA', 'BDC', 'BIC', 'BID', 'BCO', 'BNP', 'FDA', 'MDA') or " +
  "JSON_EXTRACT(extra_data, '$.destinations[0].asset_type') in ('BDA', 'BDC', 'BIC', 'BID', 'NMCA', 'MDA', 'FDA'));";

export const GOLDEN_MESSY = lines(
  "explain   select trans_id ,app_id,event_code ,  product_code,",
  "JSON_UNQUOTE( JSON_EXTRACT( extra_data,'$.sources[0].asset_type' ) ) as source_asset,",
  "  JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.destinations[0].asset_type'))   as   dest_asset,",
  "JSON_EXTRACT(extra_data, '$.order.order_amount') as amount, JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.order.app_trans_id')) as app_trans_id,",
  "status, trans_status, reason_status, JSON_EXTRACT(reason_status, '$.metadata.pe_code') as pe_code,",
  "JSON_EXTRACT(reason_status, '$.metadata.bc_code') as bc_code, JSON_EXTRACT(reason_status, '$.metadata.bc_trans_status') as bc_trans_status,",
  "JSON_EXTRACT(reason_status, '$.metadata.bc_trans_id') as bc_trans_id, JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.initiator.zalopay_id')) as zalopay_id,",
  "created_at, updated_at",
  "from saga_context_202607 use index(saga_context_created_at_idx)",
  "where created_at > '2026-07-09 03:00:00'",
  "\tand created_at < '2026-07-09 03:45:00' and status not in ( 'SUCCESS' )",
  "and ( JSON_EXTRACT(extra_data, '$.sources[0].asset_type') in ('BDA','BDC','BIC','BID','BCO','BNP','FDA','MDA')",
  "     or JSON_EXTRACT(extra_data, '$.destinations[0].asset_type') in ('BDA', 'BDC', 'BIC', 'BID', 'NMCA', 'MDA', 'FDA') ) ;",
);

/** The table the golden explains, so MySQL can plan it; columns as the golden reads them. */
export const GOLDEN_TABLE = "saga_context_202607";

export const GOLDEN_TABLE_DDL = `CREATE TABLE IF NOT EXISTS ${GOLDEN_TABLE} (
  trans_id BIGINT PRIMARY KEY,
  app_id INT,
  event_code VARCHAR(32),
  product_code VARCHAR(32),
  extra_data JSON,
  status VARCHAR(16),
  trans_status VARCHAR(16),
  reason_status JSON,
  created_at DATETIME,
  updated_at DATETIME,
  INDEX saga_context_created_at_idx (created_at)
)`;
