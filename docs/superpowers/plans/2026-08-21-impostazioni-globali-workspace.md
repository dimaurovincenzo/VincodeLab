# Impostazioni globali e workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestire preferenze globali e override del workspace con origine visibile, reset e applicazione immediata alle sezioni operative.

**Architecture:** Un catalogo allowlist definisce tipo, default e limiti. SQLite salva solo valori espliciti; il main compone il DTO effettivo e il renderer lo distribuisce tramite un hook condiviso.

**Tech Stack:** Electron, Node.js CommonJS, better-sqlite3, React 19, TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-08-21-impostazioni-globali-workspace-design.md`

## Global Constraints

- Valore effettivo: override workspace, poi globale, poi default applicativo.
- Nessun percorso workspace accettato dal renderer.
- Chiavi e valori validati nel main process.
- Nessuna credenziale o comando nelle preferenze.

---

### Task 1: Catalogo e persistenza

**Files:**
- Create: `electron/app-preferences.cjs`
- Modify: `electron/workspace-store.cjs`
- Test: `test/app-preferences.test.cjs`

- [ ] Scrivere test fallenti per default, override, reset, isolamento e valori invalidi.
- [ ] Eseguire `node --test test/app-preferences.test.cjs` e verificare il fallimento atteso.
- [ ] Implementare catalogo, schema SQLite e composizione effettiva.
- [ ] Rieseguire test mirato e suite completa.
- [ ] Commit con messaggio italiano descrittivo.

### Task 2: IPC e stato renderer

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Create: `src/lib/app-preferences.ts`
- Modify: `test/preload-surface.test.cjs`

- [ ] Scrivere test fallenti della superficie preload e della verifica sender.
- [ ] Eseguire i test mirati e verificare il fallimento atteso.
- [ ] Implementare IPC per il workspace attivo e hook renderer con evento di aggiornamento.
- [ ] Rieseguire test mirati e suite completa.
- [ ] Commit con messaggio italiano descrittivo.

### Task 3: Impostazioni Generali

**Files:**
- Modify: `src/components/settings.tsx`
- Modify: `src/settings.css`
- Modify: `test/settings-ui.test.cjs`

- [ ] Scrivere test fallenti per ambito, origine, reset e stato senza workspace.
- [ ] Eseguire il test mirato e verificare il fallimento atteso.
- [ ] Implementare i quattro gruppi usando i componenti e token esistenti.
- [ ] Rieseguire test, lint e build.
- [ ] Commit con messaggio italiano descrittivo.

### Task 4: Consumo nelle sezioni operative

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/free-terminal.tsx`
- Modify: `src/components/project-editor.tsx`
- Modify: `src/components/github-workspace.tsx`
- Modify: `src/components/database-workspace.tsx`
- Modify: `src/lib/use-resizable-panel.ts`
- Test: `test/ui-design-system.test.cjs`
- Test: `test/panel-resize.test.mjs`

- [ ] Scrivere test fallenti che collegano ogni sezione ai valori effettivi.
- [ ] Eseguire i test mirati e verificare il fallimento atteso.
- [ ] Applicare preferenze visuali e limiti alle operazioni successive.
- [ ] Rieseguire suite completa, lint, build e controllo whitespace.
- [ ] Commit con messaggio italiano descrittivo.
