# VincodeLab — report QA/Beta

Data: 20 agosto 2026
Stato: in corso

## Obiettivo

Verificare il comportamento dell'app Electron in sviluppo, con particolare
attenzione ai flussi workspace, Pi, editor, GitHub, Database e ripristino
della UI. Le prove su servizi remoti sono soltanto in lettura; nessuna issue,
Project, commit, push o dato di produzione è stato modificato durante la QA.

## Evidenze eseguite

| Area | Prova | Esito |
| --- | --- | --- |
| Qualità tecnica | `npm test` | 148 test superati |
| Qualità tecnica | `npm run lint` | superato |
| Build renderer | `npm run build` | superato |
| Avvio/ripristino | riavvio Electron dev, apertura di un workspace recente | superato |
| Terminale AI | avvio Pi, font predefinito 11 px, passaggio dalla sezione Terminale | superato |
| GitHub | lettura stato locale, grafo, issue e Project collegato al repository | superato |
| GitHub Project | selezione, collapse del selettore, gruppi per Prodotto e tabella 137 attività | superato |
| Database | lettura schema SQL Server e `SELECT 1` | superato |
| Database, errore | `SELECT FROM`, senza mutazioni | messaggio sicuro e comprensibile |
| Editor | explorer, file nascosti, stato Git per cartella e anteprima Markdown | superato |
| Impostazioni | runtime Pi e catalogo skill da pacchetti Pi in lista scorrevole | superato |
| Terminale libero | toolbar, font 11 px e sidebar dei comandi del workspace | superato |
| Packaging macOS | build, rebuild nativo, firma e apertura dell'artefatto | superato |

## Difetti individuati e corretti

### QA-001 — percorso delle skill di progetto non allineato a Pi

- **Problema:** la sezione usava `.agents/skills`, percorso del precedente
  ecosistema, e non rilevava le skill del workspace Pi.
- **Come riprodurlo:** aprire una skill in `.pi/skills` nel workspace e
  visualizzare la tab Skill progetto.
- **Comportamento attuale:** la skill non compariva e la UI indicava il
  percorso non corretto.
- **Comportamento atteso:** lettura e gestione di
  `.pi/skills/<nome>/SKILL.md` e `.pi/skills/<nome>.md`.
- **Gravità:** High.
- **Correzione proposta/applicata:** radice Pi nativa, supporto Markdown
  diretto e test di creazione, lettura e cancellazione. Commit `79e7ef9`.
- **Ritest:** suite skill dedicata, suite completa e verifica UI HMR superate.

### QA-002 — identità Git del workspace ambigua

- **Problema:** l'intestazione «Repository del workspace» mostrava il branch,
  facendo sembrare che il repository aperto fosse diverso.
- **Come riprodurlo:** aprire un workspace su un branch con nome differente
  dalla cartella/repository.
- **Comportamento attuale:** il branch veniva presentato come identità del
  repository.
- **Comportamento atteso:** dichiarare esplicitamente il branch e mantenere
  distinta l'identità remota.
- **Gravità:** Medium.
- **Correzione proposta/applicata:** intestazione «Git del workspace» e label
  «Branch attivo». Commit `fb165ce`.
- **Ritest:** test UI e lettura live dello stato Git superati.

### QA-003 — una SELECT SQL Server mostrava righe coinvolte

- **Problema:** il conteggio di `tedious` veniva esposto come righe modificate
  anche per una lettura.
- **Come riprodurlo:** eseguire `SELECT 1 AS risultato` su una connessione SQL
  Server.
- **Comportamento attuale:** il riepilogo aggiungeva «1 coinvolte».
- **Comportamento atteso:** il contatore appare solo per query mutative.
- **Gravità:** Medium.
- **Correzione proposta/applicata:** normalizzazione di `affectedRows` in base
  alla classificazione SQL. Commit `2977974`.
- **Ritest:** test unitario e query live: `1 righe · 89 ms`, senza contatore
  di mutazione.

### QA-004 — errori Database troppo generici

- **Problema:** un errore del driver non distingueva query, rete, timeout e
  autenticazione.
- **Come riprodurlo:** eseguire una query sintatticamente non valida.
- **Comportamento attuale:** «Query non eseguita dal database.».
- **Comportamento atteso:** causa operativa utile, senza dettagli del driver o
  credenziali.
- **Gravità:** Medium.
- **Correzione proposta/applicata:** classificazione sicura dei messaggi per
  query, timeout, rete e autenticazione. Commit `b3cb80f`.
- **Ritest:** test unitari e query SQL Server non mutativa superati.

### QA-005 — prefisso IPC Electron esposto nel toast Database

- **Problema:** il renderer mostrava `Error invoking remote method…` prima del
  messaggio già sicuro.
- **Come riprodurlo:** eseguire `SELECT FROM` nella UI Database.
- **Comportamento attuale:** toast con dettaglio tecnico del canale IPC.
- **Comportamento atteso:** solo il messaggio utente relativo alla query.
- **Gravità:** Medium.
- **Correzione proposta/applicata:** normalizzatore centralizzato del dettaglio
  IPC usato dal Database. Commit `6bd75ba`.
- **Ritest:** prova end-to-end e due test dedicati superati; il prefisso non è
  più presente.

## Gate di rilascio

- Nessun difetto Critical o High conosciuto al termine del ciclo.
- I flussi principali sono stati verificati manualmente o con test isolati
  riproducibili; le azioni remote mutative non sono state eseguite su GitHub o
  sul database di produzione e sono coperte da validazioni, conferme e test
  automatici.
- L'artefatto firmato è stato aperto da
  `dist/mac-arm64/VincodeLab.app`: home, workspace recente, Terminale AI e Pi
  si avviano correttamente.
- Distribuzioni generate: `dist/VincodeLab-0.1.0-arm64.dmg` e
  `dist/VincodeLab-0.1.0-arm64-mac.zip`.

Esito QA: **approvato per beta controllata**. Per un rilascio pubblico restano
raccomandati test esplorativi con utenti esterni e una prova dedicata su una
connessione database non produttiva per le mutazioni confermate.
