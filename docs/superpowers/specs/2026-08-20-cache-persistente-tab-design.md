# Cache persistente per le tab operative

## Obiettivo

Rendere immediata l'apertura delle tab GitHub e Git del workspace, anche senza rete, mantenendo un'indicazione esplicita della freschezza del dato. Il refresh manuale deve restare autorevole e forzare sempre la lettura remota.

## Ambito

Prima versione:

- stato Git: TTL 10 secondi;
- issue e Project GitHub: TTL 60 secondi;
- grafo Git: TTL 5 minuti.

Sono esclusi il terminale Pi, che è una sessione PTY viva, e i file dell'editor, che restano letture dirette del workspace.

## Architettura

Il processo Electron principale resta l'unico proprietario della cache. `workspace-store.cjs`, che usa già `vincodelab.sqlite` in modalità WAL, espone un modulo interno per leggere, scrivere, invalidare e pulire voci cache. Il renderer usa esclusivamente IPC tipizzate e non legge SQLite né decide scadenze.

La tabella `workspace_cache` contiene:

- `workspace_path`;
- `resource_key`;
- `payload_json`;
- `fetched_at`;
- `expires_at`.

La chiave primaria composta da `workspace_path` e `resource_key` isola rigorosamente i dati tra workspace. Il payload ha un limite massimo e le voci obsolete vengono eliminate periodicamente.

## Flusso dati

1. La tab richiede una risorsa tramite IPC.
2. Il main process restituisce immediatamente la cache valida, oppure la cache scaduta marcata come tale.
3. Se la risorsa è scaduta, il renderer avvia un refresh in background.
4. La risposta remota aggiorna SQLite e la UI.
5. Se il refresh fallisce ma esiste cache, la UI conserva il dato e mostra l'ora dell'ultima sincronizzazione.
6. Se non esiste cache, è mostrato l'errore operativo attuale.

Ogni risposta cache-aware espone `fetchedAt`, `expiresAt` e `stale`; non espone dettagli SQL.

## Invalidazione

- commit, staging, unstage, push, pull, fetch, cambio o creazione branch: invalidano stato Git e grafo;
- modifica di issue o Project, stato attività, archiviazione, creazione/chiusura Project: invalidano issue e board del Project interessato;
- il pulsante `Aggiorna` ignora TTL e aggiorna la risorsa richiesta dal remoto.

L'invalidazione è per chiave, non globale, per non rallentare tab indipendenti.

## UX

Il contenuto cache viene reso senza spinner bloccante. La toolbar indica in modo discreto “Aggiornato ora”, “Aggiornato X min fa” oppure “Dati non aggiornati” quando il refresh remoto non riesce. Non viene mai simulata freschezza: un dato scaduto resta esplicitamente marcato.

## Sicurezza e limiti

I dati rimangono sotto la cartella dati privata dell'app, con i permessi già usati per SQLite. Non vengono memorizzati token, credenziali o output del terminale. I payload JSON sono serializzati e validati al confine main/renderer.

## Verifica

- TTL e chiave composta isolano cache di workspace diversi;
- il fallback offline conserva l'ultimo dato valido e il relativo timestamp;
- le mutazioni invalidano solo le risorse dipendenti;
- il refresh manuale bypassa TTL;
- cache corrotta o payload oltre limite vengono ignorati in sicurezza;
- test di integrazione IPC e regressione delle tab GitHub/Git.
