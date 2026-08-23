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
| Pi Coding Agent | Terminale AI, configurazione e pacchetti Pi | Home, Editor, Terminale locale, Git, GitHub, Database, Redis e Impostazioni |
| Node.js/npm di sistema | Alcune installazioni di Pi e operazioni sui pacchetti Pi | Avvio dell'app e tutte le funzioni che non richiedono quella specifica operazione |
| Git | Stato e operazioni Git locali | Editor, terminali, AI e Database |
| GitHub CLI | Issue, Projects e operazioni account GitHub | Git locale e tutte le altre aree |
| OpenSSH/SFTP | Connessioni e file remoti | File locali e Terminale locale |

Un'assenza opzionale è uno stato previsto, non un incidente fatal. L'interfaccia non avvia retry automatici infiniti, non mostra stack trace e non duplica lo stesso problema in più notifiche.

## Feedback e recovery

Apri **Impostazioni → Compatibilità** e seleziona **Aggiorna** dopo aver installato uno strumento. La pagina usa tre stati:

- **Disponibile:** componente pronto;
- **Non installato:** strumento opzionale assente, con impatto confinato;
- **Da riparare:** componente incluso assente o incompatibile, con reinstallazione del bundle come recovery.

Quando Pi non è presente, il workspace viene comunque aperto. Il Terminale AI mostra «Pi Coding Agent non installato», conserva lo stato locale e porta direttamente alla sezione Runtime Pi delle Impostazioni. Le liste dei pacchetti Pi non vengono interrogate finché Pi non risulta disponibile.

Per database e Redis remoti, errori di rete, autenticazione, TLS, timeout e permessi restano distinti da un driver interno mancante. Per SQLite vengono distinti file non trovato, file non valido e destinazione in sola lettura; query e bozze restano disponibili per il retry. Redis conserva chiavi e risultati parziali durante la riconnessione e non richiede `redis-cli`.

## Verifica per contributori

I percorsi senza dipendenze esterne sono coperti da fault injection e test componenti:

```bash
node --test \
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
