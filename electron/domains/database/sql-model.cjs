function validateConnectionConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Configurazione database non valida.')
  if (config.driver === 'sqlite') return { driver: 'sqlite', sqlitePath: config.sqlitePath }
  if (!['postgres', 'mysql', 'mssql'].includes(config.driver)) throw new Error('Driver database non valido.')
  if (typeof config.host !== 'string' || !config.host.trim() || config.host.length > 255) throw new Error('Host non valido.')
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw new Error('Porta non valida.')
  for (const field of ['database', 'user', 'password']) {
    if (typeof config[field] !== 'string' || !config[field]) throw new Error(`${field === 'user' ? 'Utente' : field === 'database' ? 'Database' : 'Password'} non valido.`)
  }
  return { driver: config.driver, host: config.host.trim(), port: config.port, database: config.database, user: config.user, password: config.password }
}

function buildDriverConfig(config) {
  return validateConnectionConfig(config)
}

function sessionKey(workspacePath, connectionId) {
  return `${workspacePath}\u0000${connectionId}`
}

function stripLeadingComments(sql) {
  return sql.replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*\s*/u, '')
}

function classifySql(sql) {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 65_536) throw new Error('SQL non valido.')
  const statement = stripLeadingComments(sql)
  const keyword = statement.match(/^([a-z]+)/iu)?.[1]?.toUpperCase() ?? ''
  const isReadOnlySelect = keyword === 'SELECT' && !/\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|exec(?:ute)?|into)\b/iu.test(statement)
  // Le query non riconosciute come SELECT senza effetti collaterali chiedono
  // sempre conferma: una CTE può introdurre DELETE o UPDATE dopo WITH.
  return { keyword, mutative: !isReadOnlySelect }
}

function normalizeAffectedRows(affectedRows, mutative) {
  return mutative ? affectedRows : null
}

function isEditableColumn(column) {
  const type = String(column.type ?? '').toLowerCase()
  return !/blob|binary|varbinary|image|xml|json|geometry|geography/iu.test(type)
}

function makeTableSchema(name, columns) {
  const primaryKey = columns.filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
    .map((column) => column.name)
  return { name, primaryKey, columns: columns.map((column) => ({ ...column, editable: primaryKey.length > 0 && !primaryKey.includes(column.name) && isEditableColumn(column) })) }
}

function routineMetadataSql(driver) {
  if (driver === 'sqlite') return null
  // Lo schema trasporta soltanto metadati leggeri. Le definizioni possono essere
  // molto grandi e vengono lette separatamente quando l'utente apre la routine.
  if (driver === 'postgres') return "SELECT routine_schema AS schema_name, routine_name, CASE WHEN routine_type = 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS routine_type FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog','information_schema') ORDER BY routine_schema, routine_type, routine_name"
  if (driver === 'mysql') return "SELECT routine_schema AS schema_name, routine_name, CASE WHEN routine_type = 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS routine_type FROM information_schema.routines WHERE routine_schema = DATABASE() ORDER BY routine_type, routine_name"
  return "SELECT s.name AS schema_name, o.name AS routine_name, CASE WHEN o.type = 'P' THEN 'procedure' ELSE 'function' END AS routine_type FROM sys.objects o INNER JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped = 0 ORDER BY s.name, routine_type, o.name"
}

function quoteIdentifier(driver, identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/u.test(identifier)) throw new Error('Identificatore database non valido.')
  if (driver === 'mssql') return `[${identifier}]`
  if (driver === 'mysql') return `\`${identifier}\``
  return `"${identifier}"`
}

function quoteTableIdentifier(driver, tableName) {
  if (typeof tableName !== 'string' || !tableName.trim()) throw new Error('Identificatore tabella non valido.')
  return tableName.split('.').map((part) => quoteIdentifier(driver, part)).join('.')
}

function remoteParameterMarker(driver, index) {
  if (driver === 'postgres') return `$${index + 1}`
  if (driver === 'mssql') return `@p${index}`
  return '?'
}

function tableFilterExpression(driver, column, marker) {
  if (driver === 'mssql') return `CONVERT(nvarchar(max), ${column}) LIKE ${marker}`
  if (driver === 'mysql') return `CAST(${column} AS CHAR) LIKE ${marker}`
  return `CAST(${column} AS TEXT) LIKE ${marker}`
}

function tablePageParameters(driver, limit, offset) {
  // SQL Server dichiara prima OFFSET e poi FETCH NEXT; PostgreSQL/MySQL
  // dichiarano invece LIMIT e OFFSET. L'ordine deve seguire la query generata.
  return driver === 'mssql' ? [offset, limit + 1] : [limit + 1, offset]
}

module.exports = {
  buildDriverConfig,
  classifySql,
  isEditableColumn,
  makeTableSchema,
  normalizeAffectedRows,
  quoteIdentifier,
  quoteTableIdentifier,
  remoteParameterMarker,
  routineMetadataSql,
  sessionKey,
  tableFilterExpression,
  tablePageParameters,
  validateConnectionConfig,
}
