import assert from 'node:assert/strict'
import test from 'node:test'

import { createSqlFormatChange, formatSqlText } from '../src/features/database/services/sql-format.ts'

test('formatta SQL Server con il dialetto Transact-SQL della connessione', async () => {
  assert.equal(
    await formatSqlText("select top 10 [Id],[Name] from [dbo].[Users] where [Active]=1 and [Role]='admin'", 'mssql'),
    "SELECT\n  TOP 10 [Id],\n  [Name]\nFROM\n  [dbo].[Users]\nWHERE\n  [Active] = 1\n  AND [Role] = 'admin'",
  )
})

test('formatta PostgreSQL senza applicare la grammatica SQL Server', async () => {
  assert.equal(
    await formatSqlText('select id,name from public.users where active=true limit 10', 'postgres'),
    'SELECT\n  id,\n  name\nFROM\n  public.users\nWHERE\n  active = TRUE\nLIMIT\n  10',
  )
})

test('non modifica un buffer SQL vuoto', async () => {
  assert.equal(await formatSqlText('   \n', 'sqlite'), '   \n')
})

test('formatta soltanto la selezione e mantiene selezionato il risultato', async () => {
  const document = 'select id,name from users;\nselect count(*) from users;'
  const selectionEnd = document.indexOf('\n')

  assert.deepEqual(
    await createSqlFormatChange(document, { from: 0, to: selectionEnd }, 'sqlite'),
    {
      from: 0,
      to: 26,
      insert: 'SELECT\n  id,\n  name\nFROM\n  users;',
      anchor: 0,
      head: 33,
    },
  )
})

test('senza selezione formatta il documento in una singola sostituzione', async () => {
  assert.deepEqual(
    await createSqlFormatChange('select id from users', { from: 7, to: 7 }, 'mysql'),
    {
      from: 0,
      to: 20,
      insert: 'SELECT\n  id\nFROM\n  users',
      anchor: 7,
      head: 7,
    },
  )
})
