const assert = require('node:assert/strict')
const test = require('node:test')

test('genera TOP per l anteprima di una tabella SQL Server', () => {
  return import('../src/features/database/model/database-query.js').then(({ schemaTablePreviewSql }) => {
    assert.equal(schemaTablePreviewSql('mssql', 'dbo.users'), 'SELECT TOP 100 * FROM dbo.users')
  })
})

test('mantiene LIMIT per i driver che lo supportano', () => {
  return import('../src/features/database/model/database-query.js').then(({ schemaTablePreviewSql }) => {
    assert.equal(schemaTablePreviewSql('postgres', 'public.users'), 'SELECT * FROM public.users LIMIT 100')
  })
})
