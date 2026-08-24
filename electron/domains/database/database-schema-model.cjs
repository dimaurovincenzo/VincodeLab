const {
  makeTableSchema,
  remoteParameterMarker,
  routineMetadataSql,
} = require('./sql-model.cjs')

const DEFAULT_SCHEMA_PAGE_LIMIT = 50
const MAX_SCHEMA_PAGE_LIMIT = 100

function normalizeSchemaPageOptions(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new Error('Opzioni schema database non valide.')
  const offset = options.offset ?? 0
  const limit = options.limit ?? DEFAULT_SCHEMA_PAGE_LIMIT
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Offset schema database non valido.')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SCHEMA_PAGE_LIMIT) throw new Error('Limite schema database non valido.')
  return { force: options.force === true, offset, limit }
}

function schemaPageCacheKey({ offset, limit }) {
  return `${offset}:${limit}`
}

function remoteTableColumnsPageSql(driver, { offset, limit }) {
  const pageSize = limit + 1
  if (driver === 'postgres') {
    return `SELECT c.table_schema AS schema_name, c.table_name, c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
INNER JOIN (
  SELECT table_schema, table_name
  FROM information_schema.columns
  WHERE table_schema NOT IN ('pg_catalog','information_schema')
  GROUP BY table_schema, table_name
  ORDER BY table_schema, table_name
  LIMIT ${pageSize} OFFSET ${offset}
) selected_tables ON selected_tables.table_schema = c.table_schema AND selected_tables.table_name = c.table_name
ORDER BY c.table_schema, c.table_name, c.ordinal_position`
  }
  if (driver === 'mysql') {
    return `SELECT c.table_schema AS schema_name, c.table_name, c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
INNER JOIN (
  SELECT table_schema, table_name
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
  GROUP BY table_schema, table_name
  ORDER BY table_schema, table_name
  LIMIT ${pageSize} OFFSET ${offset}
) selected_tables ON selected_tables.table_schema = c.table_schema AND selected_tables.table_name = c.table_name
ORDER BY c.table_name, c.ordinal_position`
  }
  return `SELECT c.TABLE_SCHEMA AS schema_name, c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable
FROM INFORMATION_SCHEMA.COLUMNS c
INNER JOIN (
  SELECT TABLE_SCHEMA, TABLE_NAME
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA NOT IN ('sys','INFORMATION_SCHEMA')
  GROUP BY TABLE_SCHEMA, TABLE_NAME
  ORDER BY TABLE_SCHEMA, TABLE_NAME
  OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
) selected_tables ON selected_tables.TABLE_SCHEMA = c.TABLE_SCHEMA AND selected_tables.TABLE_NAME = c.TABLE_NAME
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
}

function parseRemoteTableName(tableName) {
  if (typeof tableName !== 'string') throw new Error('Identificatore tabella non valido.')
  const separator = tableName.indexOf('.')
  if (separator < 1 || separator === tableName.length - 1 || tableName.indexOf('.', separator + 1) !== -1) throw new Error('Identificatore tabella non valido.')
  return { schemaName: tableName.slice(0, separator), tableName: tableName.slice(separator + 1) }
}

function remoteTableColumnsExactQuery(driver, qualifiedTableName) {
  const { schemaName, tableName } = parseRemoteTableName(qualifiedTableName)
  const schemaMarker = remoteParameterMarker(driver, 0)
  const tableMarker = remoteParameterMarker(driver, 1)
  if (driver === 'mssql') {
    return {
      sql: `SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ${schemaMarker} AND TABLE_NAME = ${tableMarker} ORDER BY ORDINAL_POSITION`,
      parameters: [schemaName, tableName],
    }
  }
  return {
    sql: `SELECT table_schema AS schema_name, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = ${schemaMarker} AND table_name = ${tableMarker} ORDER BY ordinal_position`,
    parameters: [schemaName, tableName],
  }
}

function normalizeRemoteIdentity(row) {
  const schemaName = row.schema_name ?? row.SCHEMA_NAME ?? 'dbo'
  const tableName = row.table_name ?? row.TABLE_NAME
  return { key: `${schemaName}.${tableName}`, schemaName, tableName }
}

function uniqueRemoteTableIdentities(rows, limit = Number.POSITIVE_INFINITY) {
  const identities = []
  const seen = new Set()
  for (const row of rows) {
    const identity = normalizeRemoteIdentity(row)
    if (seen.has(identity.key)) continue
    seen.add(identity.key)
    identities.push(identity)
    if (identities.length >= limit) break
  }
  return identities
}

function remotePrimaryKeyQuery(driver, identities) {
  if (!identities.length) return null
  const parameters = []
  const predicates = identities.map(({ schemaName, tableName }) => {
    const schemaMarker = remoteParameterMarker(driver, parameters.length)
    parameters.push(schemaName)
    const tableMarker = remoteParameterMarker(driver, parameters.length)
    parameters.push(tableName)
    const schemaColumn = driver === 'mssql' ? 'tc.TABLE_SCHEMA' : 'tc.table_schema'
    const tableColumn = driver === 'mssql' ? 'tc.TABLE_NAME' : 'tc.table_name'
    return `(${schemaColumn} = ${schemaMarker} AND ${tableColumn} = ${tableMarker})`
  })
  const selection = predicates.join(' OR ')
  if (driver === 'mssql') {
    return {
      sql: `SELECT tc.TABLE_SCHEMA AS schema_name, tc.TABLE_NAME AS table_name, kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS primary_key_position FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND (${selection})`,
      parameters,
    }
  }
  return {
    sql: `SELECT tc.table_schema AS schema_name, tc.table_name, kcu.column_name, kcu.ordinal_position AS primary_key_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND (${selection})`,
    parameters,
  }
}

function mapRemoteTables(columnRows, primaryKeyRows, limit = Number.POSITIVE_INFINITY) {
  const primaryKeys = new Map(primaryKeyRows.map((row) => {
    const identity = normalizeRemoteIdentity(row)
    const columnName = row.column_name ?? row.COLUMN_NAME
    return [`${identity.key}.${columnName}`, Number(row.primary_key_position ?? row.PRIMARY_KEY_POSITION ?? 0)]
  }))
  const grouped = new Map()
  for (const row of columnRows) {
    const identity = normalizeRemoteIdentity(row)
    if (!grouped.has(identity.key)) {
      if (grouped.size >= limit) continue
      grouped.set(identity.key, { name: identity.key, columns: [] })
    }
    const columnName = row.column_name ?? row.COLUMN_NAME
    grouped.get(identity.key).columns.push({
      name: columnName,
      type: row.data_type ?? row.DATA_TYPE,
      nullable: (row.is_nullable ?? row.IS_NULLABLE) === 'YES',
      primaryKeyPosition: primaryKeys.get(`${identity.key}.${columnName}`) ?? 0,
    })
  }
  return [...grouped.values()].map((table) => makeTableSchema(table.name, table.columns))
}

function remoteRoutinePageSql(driver, { offset, limit }) {
  const sql = routineMetadataSql(driver)
  if (!sql) return null
  const pageSize = limit + 1
  return driver === 'mssql'
    ? `${sql} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`
    : `${sql} LIMIT ${pageSize} OFFSET ${offset}`
}

function mapRemoteRoutines(rows, limit = Number.POSITIVE_INFINITY) {
  return rows.slice(0, limit).map((row) => {
    const schemaName = row.schema_name ?? row.SCHEMA_NAME ?? 'dbo'
    const routineName = row.routine_name ?? row.ROUTINE_NAME
    const kind = String(row.routine_type ?? row.ROUTINE_TYPE).toLowerCase() === 'procedure' ? 'procedure' : 'function'
    return { name: `${schemaName}.${routineName}`, kind, definition: row.definition ?? row.DEFINITION ?? null }
  })
}

module.exports = {
  DEFAULT_SCHEMA_PAGE_LIMIT,
  MAX_SCHEMA_PAGE_LIMIT,
  mapRemoteRoutines,
  mapRemoteTables,
  normalizeSchemaPageOptions,
  remotePrimaryKeyQuery,
  remoteRoutinePageSql,
  remoteTableColumnsExactQuery,
  remoteTableColumnsPageSql,
  schemaPageCacheKey,
  uniqueRemoteTableIdentities,
}
