# Compatibilità runtime e installazione pulita

Questa guida descrive il comportamento del pacchetto macOS installato. I requisiti per compilare il progetto dal sorgente restano in [development.md](development.md).

## Cosa include il bundle

| Componente | Incluso | Requisiti esterni |
| --- | --- | --- |
| Electron e runtime Node interno | Sì | Nessuno; Node.js di sistema non è richiesto |
| Terminale PTY | Sì | Una shell macOS valida |
| SQLite | Sì | File locale e permessi di lettura/scrittura |
| PostgreSQL | Sì, driver `pg` | Server raggiungibile e credenziali; `psql`/`libpq` non richiesti |
| MySQL | Sì, driver `mysql2` | Server raggiungibile e credenziali; client `mysql` non richiesto |
| SQL Server | Sì, driver `tedious` | Server raggiungibile e credenziali; ODBC/`sqlcmd` non richiesti |
| Redis Standalone/Sentinel | Sì, client `node-redis` | Istanza o nodo Sentinel raggiungibile, nome master e credenziali data node/Sentinel quando richieste; `redis-cli`, Node.js e npm non richiesti |

Se uno di questi componenti inclusi manca o non è compatibile con l'architettura del Mac, l'installazione è incompleta: installare strumenti di sistema non la ripara. VincodeLab mostra un messaggio sanitizzato e indica di reinstallare il pacchetto corretto.

## Strumenti opzionali

| Strumento | Funzione interessata quando manca | Funzioni che restano disponibili |
| --- | --- | --- |
| Herdr | Gestione multipane e multi-agente del Terminale AI; viene usato Pi diretto come fallback | Home, Editor, Terminale locale, Git, GitHub, Database, Redis, Impostazioni e Terminale AI con Pi quando disponibile |
| Pi Coding Agent | Fallback diretto del Terminale AI, configurazione e pacchetti Pi; una fleet Herdr già valida può comunque essere aperta | Home, Editor, Terminale locale, Git, GitHub, Database, Redis e Impostazioni |
| Node.js/npm di sistema | Alcune installazioni di Pi e operazioni sui pacchetti Pi | Avvio dell'app e tutte le funzioni che non richiedono quella specifica operazione |
| Git | Stato e operazioni Git locali | Editor, terminali, AI e Database |
| GitHub CLI | Issue, Projects e operazioni account GitHub | Git locale e tutte le altre aree |
| OpenSSH/SFTP | Connessioni e file remoti | File locali e Terminale locale |

Un'assenza opzionale è uno stato previsto, non un incidente fatal. L'interfaccia non avvia retry automatici infiniti, non mostra stack trace e non duplica lo stesso problema in più notifiche.

### Homebrew e applicazioni avviate da Finder

macOS non garantisce che un'app avviata da Finder erediti il `PATH` configurato nella shell. VincodeLab rileva quindi Homebrew nei prefissi standard `/opt/homebrew` e `/usr/local`, oppure nel prefisso assoluto indicato da `HOMEBREW_PREFIX`. Il prefisso viene accettato soltanto se esiste e contiene `bin/brew` come file eseguibile; in quel caso `bin` e `sbin` vengono aggiunti una sola volta all'ambiente dei subprocess.

La rilevazione non esegue `.zshrc`, `.zprofile`, altri profili utente o `brew shellenv`, e non interpreta output di shell. Gli strumenti installati con Homebrew diventano così disponibili al Terminale locale e alle integrazioni Git, GitHub, Pi e npm senza rendere Homebrew un requisito per avviare l'app. I driver Database e Redis inclusi nel bundle continuano a non dipendere da formule Homebrew.

### Terminale AI: Herdr e fallback Pi

Il Terminale AI verifica prima il client `herdr`. Se l'eseguibile è valido e il preflight di versione risponde, VincodeLab apre il client nella sessione predefinita di Herdr. La sessione è persistente e condivisa: non viene creata automaticamente una fleet per il workspace VincodeLab, e due finestre possono quindi collegarsi alla stessa sessione. Il percorso del workspace mostrato nell'interfaccia è il contesto dal quale il client è stato avviato, non una garanzia di isolamento dei pane.

VincodeLab controlla soltanto il processo client ospitato nel proprio PTY. Stop, cambio workspace, chiusura della finestra e quit dell'app non eseguono `herdr server stop`, non chiudono pane e non eliminano sessioni. “Ricollega client Herdr” riapre il client; non riavvia Pi, gli altri agenti o il server. Un detach normale lascia la fleet attiva. Un arresto completo del server è diverso: termina i processi originali e ripristina soltanto struttura e stato salvato; la conversazione Pi può essere ripresa automaticamente solo se una versione corrente dell'integrazione ufficiale Herdr per Pi aveva registrato la relativa identità di sessione.

Herdr può ospitare Pi, Codex, Claude o una shell. Per evitare di inviare dati al pane sbagliato, in modalità Herdr VincodeLab disattiva allegati, contesto automatico e `/reload` programmatico. Digitazione e incolla manuale restano disponibili nel pane scelto dall'utente. Dopo una modifica a skill o istruzioni, seleziona il pane Pi corretto ed esegui `/reload` manualmente.

Se Herdr manca, non supera il preflight o termina durante la finestra di avvio prima di produrre qualsiasi output, VincodeLab avvia una sola istanza Pi diretta quando disponibile e mostra il motivo del fallback. Dopo che Herdr ha prodotto output, oppure una volta completata la finestra di avvio, non viene mai avviato automaticamente un secondo agente: un eventuale errore offre la recovery esplicita **Avvia Pi diretto**. Quando VincodeLab viene avviato dentro Herdr evita inoltre un client annidato e rimuove l’identità `HERDR_*` dal processo Pi diretto.

VincodeLab non installa né configura automaticamente Herdr, `pi-herdr` o l'integrazione Pi ufficiale di Herdr. Sono tre componenti distinti. `pi-herdr` consente a Pi di delegare alla fleet, mentre l'integrazione ufficiale fornisce reporting del lifecycle e identità necessaria al ripristino nativo dopo un restart del server; nessuna delle due è necessaria per aprire il client Herdr nel Terminale AI. La versione collaudata durante lo sviluppo è Herdr `0.8.2`.

Il client rende nel Terminale AI i pane della sessione condivisa, che possono contenere prompt, cronologia, output di comandi e altri dati privati. VincodeLab non include il contenuto dei pane nella diagnostica esportata e disabilita Herdr nelle modalità automatiche di screenshot, benchmark e fault injection. Le eventuali funzioni di history persistente abilitate nella configurazione Herdr restano però responsabilità dell'utente e vanno trattate come una cronologia terminale sensibile.

Un server Herdr già attivo conserva l'ambiente con cui è stato avviato. L'arricchimento `PATH` eseguito da VincodeLab vale per il client e per un nuovo server, ma non modifica retroattivamente un server esistente e non lo riavvia. Se un agente non è visibile nei pane, correggi l'ambiente del server e riavvialo esplicitamente fuori da VincodeLab.

## Feedback e recovery

Apri **Impostazioni → Compatibilità** e seleziona **Aggiorna** dopo aver installato uno strumento. La pagina usa tre stati:

- **Disponibile:** componente pronto;
- **Non installato:** strumento opzionale assente, con impatto confinato;
- **Da riparare:** componente incluso assente o incompatibile, con reinstallazione del bundle come recovery.

Quando Herdr e Pi non sono presenti, il workspace viene comunque aperto. Il Terminale AI confina il problema, conserva lo stato locale e indica come installare almeno uno dei runtime compatibili. Se Herdr è presente, la fleet può essere aperta anche senza un eseguibile Pi locale; le funzioni specifiche di configurazione e gestione pacchetti Pi restano però non disponibili. Le liste dei pacchetti Pi non vengono interrogate finché Pi non risulta disponibile.

Per database e Redis remoti, errori di rete, autenticazione, TLS, timeout e permessi restano distinti da un driver interno mancante. Per SQLite vengono distinti file non trovato, file non valido e destinazione in sola lettura; query e bozze restano disponibili per il retry. Redis conserva chiavi e risultati parziali durante la riconnessione e non richiede `redis-cli`.

## Verifica per contributori

I percorsi senza dipendenze esterne sono coperti da fault injection e test componenti:

```bash
node --test \
  test/application-process-environment.test.cjs \
  test/startup-bootstrap.test.cjs \
  test/runtime-capabilities.test.cjs \
  test/pty-runtime.test.cjs \
  test/pi-system-service.test.cjs \
  test/database-service.test.cjs \
  test/sqlite-worker-session.test.cjs

npx vitest run --config vitest.config.ts \
  test/components/settings-clean-machine.test.tsx
```

Prima di una release esegui comunque il gate completo e lo smoke del bundle descritti in [testing.md](testing.md) e [release.md](release.md). I test con driver simulati non certificano un server PostgreSQL, MySQL o SQL Server reale.
