# VincodeLab — Impostazioni di sistema e risorse Pi

## Obiettivo

Aggiungere una sezione principale **Impostazioni** per amministrare preferenze dell'app, diagnostica Pi, skill globali e pacchetti/estensioni Pi senza confondere tali risorse con quelle del workspace aperto.

## Confini

- Le risorse del workspace restano in **AI → Skill progetto** e **AI → Istruzioni progetto**.
- Le risorse di sistema hanno effetto su tutti i workspace e devono indicarlo esplicitamente.
- VincodeLab non legge, salva o mostra credenziali, token OAuth o chiavi API di Pi.
- Provider, modello e opzioni non supportate restano gestiti dalla TUI/configurazione nativa Pi; l'app mostra soltanto diagnostica non sensibile.

## Navigazione

La barra principale ottiene una quinta sezione: **Impostazioni**. È disponibile anche senza workspace aperto, perché riguarda il profilo macOS dell'utente e non una cartella di lavoro.

Al suo interno:

1. **Generali**: aspetto, versione dell'app e percorso locale di log diagnostici.
2. **Pi**: percorso dell'eseguibile rilevato, versione e disponibilità; azione per aprire la configurazione nativa Pi in un terminale embedded dedicato, senza tentare di duplicarne tutte le opzioni.
3. **Skill di sistema**: elenco delle sole skill in `~/.agents/skills`, con stato di validità e apertura/modifica esplicita di `SKILL.md`.
4. **Estensioni**: fonti realmente installate, ottenute da `pi list`; installazione da sorgente indicata dall'utente, aggiornamento e rimozione.

## Operazioni e sicurezza

### Skill di sistema

- La scansione è limitata a `~/.agents/skills/<nome>/SKILL.md` e non segue symlink.
- Nome, dimensione e contenuto sono validati con gli stessi limiti applicati alle skill di progetto.
- Creazione, modifica ed eliminazione richiedono una conferma esplicita; l'eliminazione chiarisce che l'effetto è globale.
- Per rendere disponibili le modifiche a Pi, l'utente usa **Ricarica Pi**; se non esiste una sessione attiva viene mostrato un errore esplicito.

### Estensioni Pi

- L'inventario è ottenuto dal comando `pi list`, senza interpretare direttamente file di configurazione non documentati.
- L'installazione usa `pi install <sorgente>` solo dopo una finestra di conferma che mostra sorgente e ambito globale.
- L'aggiornamento usa `pi update <sorgente>` con conferma.
- La rimozione usa `pi remove <sorgente>` con conferma distruttiva.
- L'output è convertito in esito sintetico e messaggio tecnico; non vengono visualizzati né registrati segreti o variabili d'ambiente.
- Le estensioni non sono abilitate/disabilitate tramite scrittura diretta di `settings.json`: l'azione **Configura in Pi** avvia la TUI nativa `pi config` in un PTY embedded separato, proprietaria di tale semantica.

## Architettura

Il main process aggiunge un servizio dedicato `pi-system-service` che:

- risolve Pi mediante il resolver esistente;
- esegue solo un allowlist di sottocomandi (`--version`, `list`, `install`, `update`, `remove`);
- impone limiti a sorgenti e output, timeout e nessuna interpolazione shell;
- espone risultati tipizzati via IPC ristretto.

Il main process mantiene inoltre un PTY distinto per `pi config`. Il renderer può avviarlo, inviare input, ridimensionarlo e chiuderlo tramite una superficie IPC dedicata; non può scegliere l'eseguibile, gli argomenti o la directory di lavoro. La chiusura della finestra termina anche tale PTY.

Un servizio `system-skills` riusa la validazione delle skill progetto, ma applica un percorso radice distinto e immutabile. Preload espone due superfici tipizzate, senza accesso filesystem o `child_process` dal renderer.

Il renderer usa componenti dedicati all'interno di Impostazioni. Le azioni mutanti seguono sempre: form/azione → dialog di conferma → IPC → refresh inventario → toast di esito.

## Errori e casi limite

- Pi assente o non eseguibile: inventario e azioni Pi restano disabilitati con istruzione chiara; le skill sistema restano utilizzabili.
- Processo Pi fallito o timeout: nessuna modifica locale è assunta; l'inventario viene ricaricato prima di comunicare l'esito.
- Sorgente vuota, oltre il limite o contenente caratteri di controllo: rifiutata prima dell'IPC.
- Una skill malformata resta leggibile per consentirne la correzione, ma è marcata non valida.
- Se Pi o l'elenco delle skill cambia esternamente, il pulsante Aggiorna rilegge la fonte di verità.

## Verifica

- Test di servizio: validazione sorgente, allowlist, gestione errore/timeout e parsing `pi list`.
- Test skill sistema: confinamento del percorso, blocco traversal/symlink e validazione di `SKILL.md`.
- Test IPC/preload: sole API previste sono esposte.
- Build, lint e test completi.
- Verifica manuale nella build confezionata: Impostazioni accessibile con e senza workspace; operazioni mutanti richiedono conferma; nessun token appare nell'interfaccia o nei log.

## Impatto e rollback

L'impatto è limitato al profilo locale macOS. Le operazioni su estensioni possono alterare il comportamento di Pi in tutti i workspace: per questo non sono automatiche e richiedono conferma. Il rollback è la rimozione dell'estensione oppure la modifica/rimozione della skill globale dalla stessa interfaccia.
