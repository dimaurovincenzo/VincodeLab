const crypto = require('node:crypto')
const path = require('node:path')
const { assertRemoteRoot, assertSshDestination } = require('../../domains/workspace/workspace-command-model.cjs')
const { getDatabase } = require('./workspace.repository.cjs')

function ensureSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS workspace_command_categories (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_command_categories_workspace_order
      ON workspace_command_categories(workspace_path, sort_order, created_at);
    CREATE TABLE IF NOT EXISTS workspace_commands (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES workspace_command_categories(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'shell',
      command TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      ssh_destination TEXT NOT NULL DEFAULT '',
      remote_root TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_commands_category_order
      ON workspace_commands(workspace_path, category_id, sort_order, created_at);
  `)
  ensureColumn('workspace_commands', 'kind', "TEXT NOT NULL DEFAULT 'shell'")
  ensureColumn('workspace_commands', 'ssh_destination', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('workspace_commands', 'remote_root', "TEXT NOT NULL DEFAULT ''")
}

function ensureColumn(table, name, definition) {
  const database = getDatabase()
  const columns = database.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((column) => column.name === name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

function assertWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || workspacePath.length > 4_096) {
    throw new Error('Workspace non valido.')
  }
  return workspacePath
}

function assertId(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} non valido.`)
  }
  return value
}

function assertText(value, label, maxLength, { required = true } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || (required && !value.trim())) throw new Error(`${label} non valido.`)
  return value
}

function categoryForWorkspace(workspacePath, categoryId) {
  return getDatabase().prepare(`
    SELECT id, name FROM workspace_command_categories
    WHERE workspace_path = ? AND id = ?
  `).get(workspacePath, assertId(categoryId, 'Categoria'))
}

function commandForWorkspace(workspacePath, commandId) {
  return getDatabase().prepare(`
    SELECT id, category_id AS categoryId, title, kind, command, note,
      ssh_destination AS sshDestination, remote_root AS remoteRoot
    FROM workspace_commands
    WHERE workspace_path = ? AND id = ?
  `).get(workspacePath, assertId(commandId, 'Comando')) ?? null
}

function nextOrder(table, workspacePath, categoryId) {
  const condition = categoryId === undefined ? 'workspace_path = ?' : 'workspace_path = ? AND category_id = ?'
  const params = categoryId === undefined ? [workspacePath] : [workspacePath, categoryId]
  return getDatabase().prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM ${table} WHERE ${condition}`).get(...params).nextOrder
}

function listWorkspaceCommands(workspacePath) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  const database = getDatabase()
  const categories = database.prepare(`
    SELECT id, name FROM workspace_command_categories
    WHERE workspace_path = ? ORDER BY sort_order, created_at
  `).all(workspacePath).map((category) => ({ ...category, commands: [] }))
  const byId = new Map(categories.map((category) => [category.id, category]))
  const commands = database.prepare(`
    SELECT id, category_id AS categoryId, title, kind, command, note,
      ssh_destination AS sshDestination, remote_root AS remoteRoot
    FROM workspace_commands
    WHERE workspace_path = ? ORDER BY sort_order, created_at
  `).all(workspacePath)
  commands.forEach((command) => byId.get(command.categoryId)?.commands.push(command))
  return { categories }
}

function createCommandCategory(workspacePath, name) {
  workspacePath = assertWorkspacePath(workspacePath)
  name = assertText(name, 'Nome categoria', 128).trim()
  ensureSchema()
  const category = { id: crypto.randomUUID(), name }
  const now = Date.now()
  getDatabase().prepare(`
    INSERT INTO workspace_command_categories (id, workspace_path, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(category.id, workspacePath, category.name, nextOrder('workspace_command_categories', workspacePath), now, now)
  return category
}

function updateCommandCategory(workspacePath, categoryId, name) {
  workspacePath = assertWorkspacePath(workspacePath)
  categoryId = assertId(categoryId, 'Categoria')
  name = assertText(name, 'Nome categoria', 128).trim()
  ensureSchema()
  const result = getDatabase().prepare(`
    UPDATE workspace_command_categories SET name = ?, updated_at = ?
    WHERE workspace_path = ? AND id = ?
  `).run(name, Date.now(), workspacePath, categoryId)
  if (result.changes === 0) throw new Error('Categoria del workspace non trovata.')
  return { id: categoryId, name }
}

function deleteCommandCategory(workspacePath, categoryId) {
  workspacePath = assertWorkspacePath(workspacePath)
  categoryId = assertId(categoryId, 'Categoria')
  ensureSchema()
  const result = getDatabase().prepare('DELETE FROM workspace_command_categories WHERE workspace_path = ? AND id = ?').run(workspacePath, categoryId)
  if (result.changes === 0) throw new Error('Categoria del workspace non trovata.')
}

function assertCommandInput(workspacePath, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Comando non valido.')
  const categoryId = assertId(input.categoryId, 'Categoria')
  if (!categoryForWorkspace(workspacePath, categoryId)) throw new Error('Categoria del workspace non trovata.')
  const kind = input.kind ?? 'shell'
  if (kind !== 'shell' && kind !== 'ssh') throw new Error('Tipo comando non valido.')
  const command = kind === 'shell'
    ? assertText(input.command, 'Testo comando', 65_536)
    : assertText(input.command ?? '', 'Testo comando', 65_536, { required: false })
  const sshDestination = kind === 'ssh' ? assertSshDestination(input.sshDestination) : ''
  const remoteRoot = kind === 'ssh' ? assertRemoteRoot(input.remoteRoot) : ''
  return {
    categoryId,
    title: assertText(input.title, 'Titolo comando', 256).trim(),
    kind,
    command,
    note: assertText(input.note ?? '', 'Nota comando', 65_536, { required: false }),
    sshDestination,
    remoteRoot,
  }
}

function createWorkspaceCommand(workspacePath, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  const command = { id: crypto.randomUUID(), ...assertCommandInput(workspacePath, input) }
  const now = Date.now()
  getDatabase().prepare(`
    INSERT INTO workspace_commands (id, workspace_path, category_id, title, kind, command, note, ssh_destination, remote_root, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(command.id, workspacePath, command.categoryId, command.title, command.kind, command.command, command.note, command.sshDestination, command.remoteRoot, nextOrder('workspace_commands', workspacePath, command.categoryId), now, now)
  return command
}

function updateWorkspaceCommand(workspacePath, commandId, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  commandId = assertId(commandId, 'Comando')
  ensureSchema()
  if (!commandForWorkspace(workspacePath, commandId)) throw new Error('Comando del workspace non trovato.')
  const command = assertCommandInput(workspacePath, input)
  getDatabase().prepare(`
    UPDATE workspace_commands SET category_id = ?, title = ?, kind = ?, command = ?, note = ?, ssh_destination = ?, remote_root = ?, updated_at = ?
    WHERE workspace_path = ? AND id = ?
  `).run(command.categoryId, command.title, command.kind, command.command, command.note, command.sshDestination, command.remoteRoot, Date.now(), workspacePath, commandId)
  return { id: commandId, ...command }
}

function moveWorkspaceCommand(workspacePath, commandId, categoryId) {
  workspacePath = assertWorkspacePath(workspacePath)
  commandId = assertId(commandId, 'Comando')
  categoryId = assertId(categoryId, 'Categoria')
  ensureSchema()
  if (!commandForWorkspace(workspacePath, commandId)) throw new Error('Comando del workspace non trovato.')
  if (!categoryForWorkspace(workspacePath, categoryId)) throw new Error('Categoria del workspace non trovata.')
  getDatabase().prepare(`
    UPDATE workspace_commands SET category_id = ?, sort_order = ?, updated_at = ?
    WHERE workspace_path = ? AND id = ?
  `).run(categoryId, nextOrder('workspace_commands', workspacePath, categoryId), Date.now(), workspacePath, commandId)
}

function deleteWorkspaceCommand(workspacePath, commandId) {
  workspacePath = assertWorkspacePath(workspacePath)
  commandId = assertId(commandId, 'Comando')
  ensureSchema()
  const result = getDatabase().prepare('DELETE FROM workspace_commands WHERE workspace_path = ? AND id = ?').run(workspacePath, commandId)
  if (result.changes === 0) throw new Error('Comando del workspace non trovato.')
}

function getWorkspaceCommand(workspacePath, commandId) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  return commandForWorkspace(workspacePath, commandId)
}

module.exports = {
  assertRemoteRoot,
  assertSshDestination,
  createCommandCategory,
  createWorkspaceCommand,
  deleteCommandCategory,
  deleteWorkspaceCommand,
  getWorkspaceCommand,
  listWorkspaceCommands,
  moveWorkspaceCommand,
  updateCommandCategory,
  updateWorkspaceCommand,
}
