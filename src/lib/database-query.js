export function schemaTablePreviewSql(driver, tableName) {
  return driver === 'mssql'
    ? `SELECT TOP 100 * FROM ${tableName}`
    : `SELECT * FROM ${tableName} LIMIT 100`
}

export function isMutativeSql(value) {
  const isReadOnlySelect = /^(?:\s|\/\*[\s\S]*?\*\/|--[^\n]*\n)*select\b/i.test(value) && !/\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|exec(?:ute)?|into)\b/i.test(value)
  return !isReadOnlySelect
}
