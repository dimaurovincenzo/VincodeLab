const assert = require('node:assert/strict')
const test = require('node:test')

test('la UI richiede conferma anche per EXECUTE SQL Server', () => {
  return import('../src/lib/database-query.js').then(({ isMutativeSql }) => {
    assert.equal(isMutativeSql('EXECUTE dbo.aggiorna_riepilogo'), true)
    assert.equal(isMutativeSql('WITH target AS (SELECT 1) DELETE FROM users'), true)
  })
})
