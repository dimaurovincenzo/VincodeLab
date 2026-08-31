---
name: vincodelab-data-workspaces
description: Implementa e verifica le aree Database, Redis, SSH, SFTP e file remoti di VincodeLab. Usala per connessioni, explorer, schema o chiavi grandi, query, ricerca payload, streaming, paginazione, cancellazione, credenziali e recovery di sessione.
---

# Integrazioni dati e remote

## Invarianti di lifecycle

- Entrare nella sezione, montare la vista, cambiare profilo o ripristinare una selezione non deve aprire rete, file database o sessioni remote.
- Solo **Connetti** autorizza l'apertura; quando connesso deve essere disponibile **Disconnetti**.
- Disconnetti annulla il lavoro progressivo, chiude in modo bounded e conserva quanto è utile mantenere nell'interfaccia.
- Navigando altrove e tornando, non avviare una connessione implicita e non distruggere query, risultati, filtri, selezione o layout recuperabili.

## Dati grandi

1. Pagina o streamma nel driver prima di accumulare i dati.
2. Carica automaticamente e progressivamente i cataloghi che devono diventare completi, mostrando avanzamento; non usare un generico “Carica altre risorse”.
3. Valida `offset`, `limit`, `hasMore` e `nextOffset`; unisci e deduplica le pagine.
4. Se una pagina successiva fallisce, conserva le pagine già ricevute e mostra retry soltanto dopo l'interruzione.
5. Mantieni limiti IPC, preview e preflight per payload grandi. Non trasferire interi valori soltanto per calcolare un'anteprima.

## Regole per area

- Database: normalizza i driver supportati senza perdere il dettaglio tecnico nella diagnostica; preserva query e risultati in caso di disconnessione.
- Redis: usa il client applicativo incluso, non richiedere `redis-cli`; mantieni l'explorer read-only salvo nuova autorizzazione di prodotto; usa `SCAN`, concorrenza limitata e ricerca cancellabile.
- SSH/SFTP: usa profili espliciti, cache locale e confronto hash; non sovrascrivere conflitti locali o remoti senza decisione dell'utente.
- Credenziali: affidale ai contratti esistenti e a `safeStorage`; non inserirle in log, test, screenshot, fixture o messaggi UI.

## Verifica

Copri zero chiamate remote al mount/selezione, single-flight su Connetti, progressione, annullamento, disconnessione, failure intermedio e recovery. Esegui test mirati dell'area, poi:

```bash
npm run check:architecture
npm test
npm run build
git diff --check
```

I test automatici non devono contattare servizi reali. Un collaudo reale usa solo risorse autorizzate e non registra host, chiavi, payload o credenziali.
