# Aggiornamenti di Skill, estensioni e runtime Pi — Design

## Obiettivo

Consentire a VincodeLab di rilevare, scaricare e attivare in sicurezza gli aggiornamenti delle risorse Pi con una provenienza GitHub verificabile, senza controlli manuali sui repository e senza sostituire risorse in uso. Le skill globali manuali risiedono in `~/.pi/agent/skills`; `~/.agents/skills` non fa parte della migrazione a Pi. L'aggiornamento automatico e' facoltativo per ogni elemento e disattivato di default; comprende anche versioni major.

## Decisioni confermate

- I tre canali sono indipendenti: `skill`, `pi-extension`, `pi-runtime`.
- Le sorgenti installate da repository GitHub sono controllate confrontando commit, tag o release remota con la versione registrata localmente.
- L'aggiornamento automatico scarica in staging, ma non attiva mai la nuova versione nella sessione corrente: l'app richiede un riavvio.
- Anche gli aggiornamenti major possono essere automatici.
- Per ogni aggiornamento viene mantenuta una versione precedente ripristinabile; dopo un health check fallito il rollback e' automatico.
- URL, proprietario GitHub, branch/tag e canale di origine non vengono mai sostituiti automaticamente.
- La gestione resta globale di sistema: non appartiene al workspace aperto e non entra nel repository Git dell'utente.
- I pacchetti GitHub restituiti da `pi list` vengono iscritti automaticamente solo quando root, manifesto, commit e ref sono verificabili dentro `~/.pi/agent`.
- Pacchetti npm, percorsi locali, skill manuali e runtime Pi restano sul canale nativo Pi finche' non esiste un lifecycle atomico equivalente. L'app non inventa un'origine e non promette rollback per risorse che Pi non espone con metadati sufficienti.

## Architettura

```text
Renderer Impostazioni
  └─ preload: updates.* (DTO, nessun Node)
       └─ main Electron: sender verificato + orchestrazione lifecycle
            ├─ update-store: stato, versioni e policy locali
            ├─ update-checker: GitHub / Pi metadata, cache e rate limit
            ├─ update-downloader: staging, verifica e backup
            └─ pi-system-service: ispezione e health check Pi
```

Il renderer visualizza esclusivamente DTO serializzabili e richiede azioni per ID. Il main process legge il record installato, verifica la sorgente approvata, effettua controlli e download, e registra l'esito. Nessun token GitHub, percorso interno sensibile o comando di installazione viene esposto al renderer.

## Modello dati locale

Una tabella `managed_updates` conserva per ogni risorsa:

- `id`, `kind`, `name`, `source_type`, `source_url`, `owner`, `repository`, `ref` e `channel`;
- versione/commit attivi e ultima versione funzionante;
- versione/commit disponibile e relativo changelog;
- policy `manual|automatic`, stato del download e flag `restart_required`;
- data dell'ultimo controllo, errore normalizzato e timestamp di attivazione;
- metadati di staging e backup strettamente necessari al main process.

Le informazioni di autenticazione necessarie al controllo GitHub restano nel meccanismo locale gia' previsto per GitHub e non vengono duplicate nella tabella. I pacchetti scaricati risiedono in staging fuori dalle directory attive; i backup sono associati al record e possono essere rimossi solo dopo una successiva attivazione riuscita.

## Flusso operativo

```text
Controllo remoto
  -> confronto con commit/versione attiva
  -> aggiornamento disponibile
  -> download in staging
  -> verifica integrita'
  -> aggiornamento pronto, riavvio richiesto
  -> avvio successivo: attivazione atomica
  -> health check
  -> conferma nuova versione | rollback automatico
```

Il controllo automatico all'avvio avviene solo se l'ultimo controllo ha piu' di 24 ore. Il comando manuale ignora questa cache. I download automatici sono serializzati e non interrompono una sessione Pi attiva. Le dipendenze runtime dichiarate da un pacchetto GitHub vengono preparate in staging con lifecycle script disabilitati.

Un controllo remoto non scarica ne' esegue codice. Per GitHub verifica il commit del ref consentito o la release/tag compatibile con il canale. Errori di rete, rate limit, repository non raggiungibile o integrita' non verificata mantengono invariata la versione attiva.

## Esperienza utente

La sezione Impostazioni aggiunge una vista **Aggiornamenti** coerente con le tab esistenti:

- badge con numero di aggiornamenti disponibili o pronti;
- filtri predisposti per Skill, estensioni Pi e runtime Pi; la lista contiene solo risorse realmente iscritte e verificabili;
- per ogni elemento: versione attiva, versione disponibile, sorgente, data ultimo controllo e stato;
- azioni: verifica ora, scarica aggiornamento, abilita/disabilita automatico, apri changelog e ripristina versione precedente;
- azione globale **Scarica tutti gli aggiornamenti** per gli elementi idonei;
- banner persistente **Aggiornamenti pronti — riavvia per attivarli**.

Il ripristino usa una conferma esplicita. Le operazioni non disponibili spiegano il prerequisito (ad esempio runtime Pi attivo o nessun backup presente). Messaggi e toast sono in italiano e non includono credenziali, URL completi riservati o output di installazione non filtrato.

## Attivazione e rollback

All'avvio il main process rileva i record `restart_required` e attiva un solo aggiornamento alla volta. L'attivazione deve essere atomica: la versione precedente resta disponibile finche' il nuovo elemento non supera il proprio health check.

- Skill Pi gestita: struttura e manifesto validi e caricabili.
- Pacchetto GitHub Pi: manifesto valido, commit uguale a quello verificato e dipendenze preparate senza lifecycle script.
- Runtime e pacchetti npm: gestione nativa nelle rispettive tab, fuori dal lifecycle di rollback gestito.

Un health check fallito ripristina automaticamente la versione precedente, salva un errore normalizzato e lascia disponibile un retry manuale. Il rollback manuale ripete lo stesso processo con conferma dell'utente.

## Vincoli di sicurezza e affidabilita'

- Ogni azione IPC usa `assertTrustedSender` e una superficie preload minimale.
- Il downloader accetta solo la sorgente gia' registrata e valida; non segue redirect verso proprietari o repository differenti senza una nuova installazione esplicita.
- Il controllo non esegue hook, script o contenuto del repository.
- Download incompleti o checksum non validi vengono eliminati dallo staging e non diventano attivabili.
- Al massimo una nuova versione e una versione di rollback sono conservate per elemento, per limitare spazio e complessita'.
- Non viene effettuato packaging macOS durante lo sviluppo; i controlli avvengono con hot reload.

## Verifica

- Store: policy per elemento, persistenza dello stato, isolamento dei canali e selezione del backup.
- Checker: commit/release invariati, nuovo commit, rate limit, repository irraggiungibile e sorgente non autorizzata.
- Downloader/attivatore: download interrotto, integrita' fallita, attivazione atomica, riavvio richiesto, health check e rollback automatico.
- IPC/preload: nessun accesso Node nel renderer e nessun dato sensibile nei DTO.
- UI: badge, filtri, prerequisiti disabilitati, conferma rollback, stato di riavvio e layout senza overflow.
- Collaudo manuale: almeno un pacchetto Pi GitHub verificabile, con controllo, staging, banner di riavvio e conferma di ripristino; i canali nativi Pi vengono verificati separatamente.
