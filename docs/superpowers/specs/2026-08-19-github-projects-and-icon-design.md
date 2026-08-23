# GitHub Projects per workspace e identità applicativa

## Obiettivo

Trasformare la sezione GitHub in una console locale per il repository del workspace aperto: Git operativo, grafico commit, issue e GitHub Projects collegati a quel repository. L'utente non deve aprire il sito GitHub per operazioni ordinarie.

## Confine del workspace

- Ogni caricamento risolve `owner/repo` con `gh repo view` dal `cwd` del workspace.
- Sono mostrati esclusivamente i Projects collegati a quel repository, non tutti i Projects dell'owner.
- La verifica del collegamento avviene nel main process tramite GitHub GraphQL/`gh api graphql`; il renderer non riceve token, comandi raw o accesso a processi.
- Se `gh` non è autenticato o manca lo scope `project`, la UI mostra una diagnosi e il comando da copiare; non tenta login automatici né conserva credenziali.

## Git locale

- La tab Git mostra branch, upstream, ahead/behind, staged, unstaged e un grafo commit locale di `HEAD` e riferimenti raggiungibili.
- Staging, unstage, commit, push, pull/rebase, switch/create branch e revert usano argomenti validati nel main process.
- Prima di commit, push, pull/rebase, switch con modifiche o revert, il renderer mostra un riepilogo dell'operazione e richiede conferma esplicita.
- Nessun comando viene composto dal testo libero dell'utente; messaggio commit, branch, SHA e path passano validazione con limiti e allowlist.

## GitHub Projects

### Elenco e selezione

- La tab Projects mostra il solo elenco dei Projects collegati a `owner/repo`: stato, titolo, descrizione e numero.
- La selezione di un Project carica campi e item fino al limite esplicitamente comunicato; filtri e ricerca restano locali al dataset caricato.

### Board

- La board raggruppa gli item sul campo `Status` se presente; altrimenti usa una lista ordinata, senza inventare colonne.
- Ogni card espone titolo, tipo (issue/PR/draft), stato, assignee, label e valori dei campi configurati disponibili.
- La modifica di un campo invia una sola mutazione `gh project item-edit` per volta, aggiorna il dataset e mostra il risultato. Il drag-and-drop non viene introdotto nella prima versione: evita mutazioni implicite e ambiguità fra campi non compatibili.

### Mutazioni

- L'utente può aggiungere issue/PR del repository, creare draft, cambiare valori compatibili, archiviare/ripristinare item e aggiornare titolo/descrizione Project.
- Può creare un Project e collegarlo immediatamente al repository aperto.
- Chiudere, riaprire, scollegare o eliminare Project/item/campo è un'azione distruttiva: preview del target e conferma nominativa immediatamente prima dell'esecuzione. La cancellazione non ha undo.
- Creazione/eliminazione di campi viene separata dalla modifica item per rendere evidenti impatto e rollback.

## Architettura

- `electron/github-service.cjs` diventa il solo adapter Git/GitHub: comandi `git`, comandi `gh project` e query GraphQL, parsing JSON e validazione input.
- `electron/main.cjs` espone IPC granulari, trusted-sender-only; `preload.cjs` espone API tipizzate minime; `src/vincode-lab.d.ts` definisce DTO senza dettagli di shell.
- `src/components/github-workspace.tsx` viene suddiviso in componenti per Git, elenco Projects e dettaglio board, con stato di caricamento e errore indipendente.
- Nessun token entra in SQLite, config di progetto, renderer, log applicativi o commit.

## Icona

- L'immagine sorgente fornita dall'utente viene mantenuta nel progetto come asset attribuito all'app.
- Viene derivato un `.icns` macOS multi-risoluzione e configurato in `electron-builder`; il logo appare anche nella barra applicativa, senza usare PNG scalato come icona di packaging.

## Sicurezza e operatività

- Timeout, buffer massimo e messaggi errore sanitizzati restano centralizzati nell'adapter.
- Il refresh è read-only; mutazioni non vengono eseguite durante un refresh o retry automatico.
- Errori di autenticazione, permessi, repository non GitHub, branch senza upstream e Project non collegati sono stati espliciti della UI, non errori silenziosi.

## Validazione

1. Test Node per parsing grafo Git, validazione argomenti e mapping Project/field/item.
2. Build e lint TypeScript.
3. Test Electron con repository senza remote, repository GitHub senza scope `project`, Project vuoto e Project con campi Status/Priority.
4. Test mutazioni con dati di test: preview, conferma, aggiornamento UI e refresh; nessuna mutazione viene inviata dopo annullamento.
5. Build macOS con verifica presenza `.icns` nel bundle e visualizzazione asset nella finestra.

## Rollback

Le modifiche locali Git seguono le regole Git esistenti. Le mutazioni GitHub non sono automaticamente reversibili: la UI espone revert solo dove il provider lo supporta e richiede conferma prima delle azioni distruttive. L'icona può essere ripristinata rimuovendo il riferimento `build.icon`.
