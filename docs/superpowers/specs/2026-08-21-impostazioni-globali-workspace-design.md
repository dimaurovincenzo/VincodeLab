# Impostazioni globali e override workspace — Design

## Obiettivo

Centralizzare le preferenze interne di VincodeLab in Impostazioni, mantenendo valori globali validi per ogni progetto e override facoltativi per il workspace aperto. L’utente deve capire sempre se un valore è ereditato o personalizzato e deve poter rimuovere l’override senza ricopiare il default.

## Decisioni approvate

- Il valore effettivo è `override workspace ?? valore globale ?? default applicativo`.
- Le preferenze globali sono disponibili anche senza workspace aperto.
- Gli override sono salvati per percorso canonico del workspace e non entrano nel repository Git.
- Ogni controllo mostra `Globale` o `Personalizzato`; il ripristino elimina il solo override.
- Renderer e preload scambiano un DTO tipizzato e non accedono direttamente a SQLite o Node.
- I valori sono validati nel main process tramite una allowlist; chiavi o valori sconosciuti sono rifiutati.

## Modello delle preferenze

Le chiavi iniziali coprono i controlli realmente consumati dall’app:

- `editor.fontSize`, `editor.tabSize`, `editor.wordWrap`, `editor.autoSave`, `editor.explorerWidth`;
- `terminal.fontSize`, `terminal.fontFamily`, `terminal.cursorStyle`, `terminal.scrollback`, `terminal.commandsWidth`;
- `git.autoRefreshSeconds`, `git.historyLimit`, `git.confirmRemoteActions`, `git.projectSelectorWidth`;
- `database.rowLimit`, `database.queryTimeoutMs`, `database.confirmMutations`, `database.explorerWidth`, `database.sqlPanelPercent`.

I default applicativi sono definiti in un solo modulo condiviso. SQLite conserva soltanto valori esplicitamente scelti, non copie dell’intero schema.

## Persistenza e API

`app_preferences` continua a contenere le preferenze globali. Una nuova tabella `workspace_preferences` usa `(workspace_path, key)` come chiave primaria e cascata logica alla rimozione del workspace recente.

Il preload espone:

- `preferences.get()` → schema, globali, override ed effettive;
- `preferences.setGlobal(key, value)`;
- `preferences.setWorkspace(key, value)`;
- `preferences.clearWorkspace(key)`;
- `preferences.clearAllWorkspace()`.

Il main determina il workspace attivo: il renderer non può indicare arbitrariamente un percorso.

## Esperienza utente

La tab Generali mantiene il tema e aggiunge quattro gruppi compatti: Editor, Terminale, Git e Database. Un selettore `Valori globali / Workspace aperto` cambia l’ambito di modifica. Nell’ambito workspace ogni riga indica l’origine del valore e offre `Usa globale` quando esiste un override. Un’azione unica rimuove tutte le personalizzazioni del workspace con conferma.

I cambiamenti visuali vengono propagati alle sezioni montate senza ricaricare l’app. Le impostazioni che influenzano nuove operazioni (limiti Git/Database) valgono dalla richiesta successiva.

## Sicurezza e affidabilità

- Valori numerici hanno limiti minimi e massimi nel main process.
- Le stringhe sono scelte da enum o hanno lunghezza limitata.
- Nessuna preferenza può contenere comandi, percorsi arbitrari o credenziali.
- Una preferenza corrotta viene ignorata e sostituita dal default, senza bloccare l’avvio.
- Gli aggiornamenti sono atomici e restituiscono sempre il nuovo DTO effettivo.

## Verifica

- Store: default, globale, override, cancellazione, isolamento workspace e input invalidi.
- IPC/preload: sender verificato, nessun percorso renderer, DTO tipizzato.
- UI: ambito, origine, reset, assenza workspace e layout responsivo.
- Integrazione: almeno Terminale, Editor, Git e Database consumano i valori effettivi.
- Regressione: test completi, lint, build e controllo whitespace.
