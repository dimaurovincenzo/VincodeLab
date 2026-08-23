# UX/UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere ogni schermata di VincodeLab coerente, lineare e pronta per una presentazione commerciale.

**Architecture:** I token semantici centralizzati sostituiscono i valori visuali ripetuti. I fogli per pagina usano esclusivamente token e pattern condivisi per controlli, pannelli, tab, toolbar, stati e tema scuro.

**Tech Stack:** React, CSS, Tailwind/shadcn base, Electron macOS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-ux-ui-redesign-design.md`

## Global Constraints

- Tema chiaro e scuro mantengono identica semantica dei token.
- Primary, secondary, ghost e destructive hanno stati hover, active, focus, disabled e loading coerenti.
- Conservare focus visibile, `prefers-reduced-motion` e target interattivi di almeno 28px.
- Nessun dato di prodotto fittizio nelle pagine, loading o stati vuoti.

---

### Task 1: Fondazioni visive e controlli condivisi

**Files:**
- Modify: `src/index.css`, `src/App.css`, `src/dark-theme.css`
- Test: `test/ui-design-system.test.cjs`

- [ ] Scrivere un test statico che richieda token `--surface-*`, `--text-*`, `--space-*`, `--radius-*` e `:focus-visible`.
- [ ] Eseguire `node --test test/ui-design-system.test.cjs` e verificarne il fallimento.
- [ ] Definire token chiaro/scuro e una base per button, input, select, textarea, badge, pannelli, modali, toast, skeleton e stati disabled.
- [ ] Eseguire il test statico e `npm run build`.

### Task 2: Navigazione, Home e feedback

**Files:**
- Modify: `src/App.css`, `src/components/confirmation-dialog.tsx`, `src/components/empty-state.tsx`
- Test: `test/ui-design-system.test.cjs`

- [ ] Estendere il test con presenza di focus e reduced motion nelle superfici condivise.
- [ ] Eseguire il test e verificarne il fallimento.
- [ ] Ridisegnare toolbar, tab principali, sidebar, ricerca, card recenti, empty/error state e dialog di conferma secondo token e gerarchie.
- [ ] Eseguire test e build.

### Task 3: AI, Editor e Terminale

**Files:**
- Modify: `src/skills.css`, `src/editor.css`, `src/terminal.css`, `src/persistent-tabs.css`
- Test: `test/ui-design-system.test.cjs`

- [ ] Aggiungere asserzioni statiche contro colori hard-coded nei fogli rivisti.
- [ ] Eseguire il test e verificarne il fallimento.
- [ ] Uniformare tab, explorer, toolbar, editor, terminale, form skill, istruzioni, loading e stati vuoti.
- [ ] Eseguire test, lint e build.

### Task 4: GitHub e Impostazioni

**Files:**
- Modify: `src/github.css`, `src/settings.css`, `src/components/settings.tsx`
- Test: `test/ui-design-system.test.cjs`

- [ ] Aggiungere asserzioni per token e CTA coerenti nelle due superfici.
- [ ] Eseguire il test e verificarne il fallimento.
- [ ] Sostituire l'estetica GitHub isolata con pannelli, tab, issue, board, filtri, card e form coerenti; rendere Impostazioni più leggibile e meno densa.
- [ ] Eseguire test, lint e build.

### Task 5: Audit di runtime e packaging

**Files:**
- Modify: `docs/PRD/VincodeLab_Fase1_PRD.md`

- [ ] Aprire la build nella modalità chiara e ispezionare Home, AI, Editor, Terminale, GitHub e Impostazioni.
- [ ] Ripetere l'ispezione in modalità scura, incluso focus, loading, empty/error state e dialog.
- [ ] Eseguire `npm test && npm run lint && npm run build && git diff --check && npm run package`.
- [ ] Verificare firma con `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/VincodeLab.app`.
