import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { defaultKeymap, history as editorHistory, historyKeymap } from '@codemirror/commands'
import { sql as sqlLanguage, MSSQL, MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql'
import { lintGutter, linter } from '@codemirror/lint'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { graphiteCodeMirrorTheme } from '@/lib/codemirror-theme'
import { sqlLintSource } from '../services/sql-lint'
import { writeVolatileDraft } from '@/lib/volatile-draft-store'
import { defaultSql, sqlDraftIdentity } from '../model/database-connections'
import type { DatabaseDriver as Driver, DatabaseSchema } from '../model/database.types'

type UseDatabaseSqlEditorOptions = {
  connectionIdRef: RefObject<string | null>
  workspace: string
}

export function useDatabaseSqlEditor({ connectionIdRef, workspace }: UseDatabaseSqlEditorOptions) {
  const [sql, setSql] = useState(defaultSql)
  const [activeSavedQueryId, setActiveSavedQueryId] = useState<string | null>(null)
  const editorHost = useRef<HTMLDivElement>(null)
  const editorView = useRef<EditorView | null>(null)
  const sqlLanguageCompartment = useRef(new Compartment())
  const workspaceRef = useRef(workspace)
  const sqlRef = useRef(sql)
  const sqlBaseline = useRef({ content: defaultSql, savedQueryId: null as string | null })
  const sqlDocumentRevision = useRef(0)
  const expectedProgrammaticSql = useRef<string | null>(null)

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

  const publishSqlBaseline = useCallback((content: string, savedQueryId: string | null) => {
    sqlBaseline.current = { content, savedQueryId }
    sqlRef.current = content
    expectedProgrammaticSql.current = content
    setActiveSavedQueryId(savedQueryId)
    setSql(content)
  }, [])

  const restoreSqlDraft = useCallback((content: string, baseline: string) => {
    sqlBaseline.current = { content: baseline, savedQueryId: null }
    sqlRef.current = content
    expectedProgrammaticSql.current = content
    setActiveSavedQueryId(null)
    setSql(content)
  }, [])

  useEffect(() => {
    if (!editorHost.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: sqlRef.current,
        extensions: [
          graphiteCodeMirrorTheme,
          lineNumbers(),
          editorHistory(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          sqlLanguageCompartment.current.of(sqlLanguage({ dialect: SQLite, schema: {} })),
          linter(sqlLintSource, { delay: 350 }),
          lintGutter(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            sqlDocumentRevision.current += 1
            const value = update.state.doc.toString()
            sqlRef.current = value
            setSql(value)
            if (expectedProgrammaticSql.current === value) {
              expectedProgrammaticSql.current = null
              return
            }
            setActiveSavedQueryId(null)
            writeVolatileDraft(sqlDraftIdentity(workspaceRef.current, connectionIdRef.current), value, sqlBaseline.current.content)
          }),
        ],
      }),
      parent: editorHost.current,
    })
    editorView.current = view
    return () => {
      view.destroy()
      editorView.current = null
    }
  }, [connectionIdRef])

  const reconfigureLanguage = useCallback((driver: Driver | undefined, schema: DatabaseSchema) => {
    const view = editorView.current
    if (!view) return
    const sqlSchema = Object.fromEntries(schema.tables.map((table) => [
      table.name,
      table.columns.map((column) => ({ label: column.name, type: 'property', detail: column.type })),
    ]))
    const dialect = driver === 'postgres' ? PostgreSQL : driver === 'mysql' ? MySQL : driver === 'mssql' ? MSSQL : SQLite
    view.dispatch({ effects: sqlLanguageCompartment.current.reconfigure(sqlLanguage({ dialect, schema: sqlSchema })) })
  }, [])

  useEffect(() => {
    sqlRef.current = sql
    const view = editorView.current
    if (!view || view.state.doc.toString() === sql) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } })
  }, [sql])

  const activeSql = useCallback(() => {
    const view = editorView.current
    const selection = view?.state.selection.main
    return selection && !selection.empty ? view.state.sliceDoc(selection.from, selection.to) : sqlRef.current
  }, [])

  const focusEditor = useCallback(() => editorView.current?.focus(), [])

  return {
    activeSavedQueryId,
    activeSql,
    editorHost,
    editorView,
    focusEditor,
    publishSqlBaseline,
    reconfigureLanguage,
    restoreSqlDraft,
    setActiveSavedQueryId,
    sql,
    sqlBaseline,
    sqlDocumentRevision,
    sqlRef,
  }
}
