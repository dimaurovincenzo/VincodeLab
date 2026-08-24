export type SqlFormatterDriver = 'sqlite' | 'postgres' | 'mysql' | 'mssql'
type SqlSelection = { from: number; to: number }
export type SqlFormatChange = { from: number; to: number; insert: string; anchor: number; head: number }

export async function formatSqlText(sqlText: string, driver: SqlFormatterDriver): Promise<string> {
  if (!sqlText.trim()) return sqlText

  // Il formatter è usato solo su richiesta: il caricamento differito evita di
  // aumentare il costo iniziale della vista Database.
  const formatter = await import('sql-formatter')
  const dialect = {
    sqlite: formatter.sqlite,
    postgres: formatter.postgresql,
    mysql: formatter.mysql,
    mssql: formatter.transactsql,
  }[driver]

  return formatter.formatDialect(sqlText, {
    dialect,
    keywordCase: 'upper',
    tabWidth: 2,
  })
}

export async function createSqlFormatChange(document: string, selection: SqlSelection, driver: SqlFormatterDriver): Promise<SqlFormatChange> {
  const hasSelection = selection.from !== selection.to
  const from = hasSelection ? selection.from : 0
  const to = hasSelection ? selection.to : document.length
  const insert = await formatSqlText(document.slice(from, to), driver)

  return {
    from,
    to,
    insert,
    anchor: hasSelection ? from : Math.min(selection.from, insert.length),
    head: hasSelection ? from + insert.length : Math.min(selection.to, insert.length),
  }
}
