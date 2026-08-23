# Pacchetti Pi: sorgenti npm, Git e locali — Design

## Obiettivo

Allineare VincodeLab al modello nativo dei pacchetti Pi. La gestione globale non deve descrivere ogni installazione come una "estensione": un pacchetto Pi puo' distribuire insieme skill, estensioni, prompt e temi. Le sorgenti supportate da Pi sono npm (catalogo `pi.dev/packages`), Git e percorsi locali.

Le skill create o modificate dall'utente restano risorse manuali in `~/.pi/agent/skills`. I pacchetti installati rimangono invece gestiti da Pi tramite `~/.pi/agent/settings.json`, `~/.pi/agent/npm/` e `~/.pi/agent/git/`; VincodeLab non deve copiarne o alterarne il contenuto.

VincodeLab legge esclusivamente risorse dichiarate o installate per Pi. Eventuali percorsi Codex presenti temporaneamente nella configurazione locale di Pi non sono una sorgente dell'app, non vengono importati e non compaiono nel catalogo. La loro rimozione avviene alla conclusione della migrazione, senza coinvolgere il codice o i dati di VincodeLab.

## Stato attuale e problema

La tab **Estensioni Pi** accetta gia' una stringa inoltrata a `pi install`, ma comunica un modello limitato: il placeholder cita solo GitHub/Git e l'elenco tratta ogni elemento come estensione. Questo nasconde sia il catalogo npm di Pi sia la natura multi-risorsa di un pacchetto.

`pi list` e' al momento la fonte installata esposta dall'app. Il suo output testuale non e' un contratto sufficiente per classificare con affidabilita' le risorse contenute in ogni pacchetto; la UI non deve inventare tipi non verificati.

## Decisioni confermate

- La nuova tab si chiama **Pacchetti Pi**.
- Tutte le operazioni restano globali di sistema: non dipendono dal workspace aperto.
- Le sorgenti installabili sono esattamente quelle native di Pi:
  - **Catalogo Pi / npm**, con specifica `npm:<pacchetto>` opzionalmente versionata;
  - **Git**, con `git:<host>/<owner>/<repo>`, URL HTTPS o SSH e ref opzionale;
  - **Locale**, con percorso assoluto o relativo a un pacchetto gia' presente sul computer.
- L'app conserva e passa la specifica Pi senza convertirla in URL GitHub, percorso Codex o formato proprietario.
- Il catalogo skill dell'app riunisce le sole risorse Pi in due gruppi: **manuali** da `~/.pi/agent/skills` e **da pacchetti Pi** dichiarati in `~/.pi/agent/settings.json`. I percorsi esterni configurati direttamente nel file impostazioni non vengono usati come fallback.
- Un pacchetto e' rappresentato come **Pacchetto Pi**. La UI indica che puo' contenere skill, estensioni, prompt e temi, senza dichiarare quali risorse abbia finche' Pi non espone un dato strutturato attendibile.
- Installazione, aggiornamento e rimozione richiedono sempre conferma esplicita perche' un pacchetto puo' eseguire codice con privilegi dell'utente.
- Il catalogo e' una fonte npm pubblicata su `pi.dev`; VincodeLab non implementa scraping o un indice duplicato, perche' il catalogo non espone in questa fase un'API stabile documentata. La ricerca resta l'inserimento diretto della specifica `npm:`. Un'apertura del catalogo puo' essere aggiunta in una fase successiva come vista remota non privilegiata.

## Architettura

```text
Renderer: Impostazioni > Pacchetti Pi
  -> selettore sorgente + campo specifica + conferma
  -> preload: piSystem.{list,install,update,remove}
  -> main Electron: sender verificato
  -> pi-system-service: validazione sintattica + execFile(pi, args)
  -> Pi: ~/.pi/agent/settings.json e directory native dei pacchetti
```

Il renderer costruisce solo una specifica valida per la sorgente selezionata. Il main process continua a usare `execFile`, mai shell interpolation. Il servizio accetta una stringa gia' normalizzata e limita lunghezza, caratteri di controllo e argomenti a un unico valore.

### Normalizzazione lato renderer

| Sorgente | Input utente | Specifica inviata a Pi |
| --- | --- | --- |
| Catalogo Pi / npm | `@autore/pacchetto@1.2.0` oppure `pacchetto` | `npm:@autore/pacchetto@1.2.0` oppure `npm:pacchetto` |
| Git | specifica gia' `git:` o URL Git HTTPS/SSH | invariata |
| Locale | percorso assoluto o relativo | invariato |

Il renderer non deve accettare input npm con `npm:` duplicato. La validazione server-side mantiene comunque la responsabilita' definitiva e restituisce errori normalizzati, senza includere segreti o output di installazione non filtrato.

## Esperienza utente

La tab mantiene il design system esistente e sostituisce la vecchia tab:

- titolo **Pacchetti Pi** e descrizione esplicita delle quattro classi di risorse;
- controllo segmentato `Catalogo Pi (npm) | Git | Locale`, con placeholder ed esempio appropriati;
- callout di sicurezza: skill ed estensioni di terze parti possono istruire Pi o eseguire codice; l'utente deve verificare la sorgente prima dell'installazione;
- lista dei pacchetti installati con la loro specifica nativa e le sole azioni affidabili: aggiorna, rimuovi;
- conferme nominate **Installa pacchetto Pi**, **Aggiorna pacchetto Pi**, **Rimuovi pacchetto Pi**;
- messaggi di stato in italiano e refresh della lista dopo ogni operazione riuscita.

La tab **Skill Pi** rimane separata e usa tutto lo spazio disponibile:

- il gruppo **Manuali** elenca e modifica solamente `~/.pi/agent/skills`;
- il gruppo **Da pacchetti Pi** legge in sola lettura le skill esposte dal manifest `pi.skills` o dalle directory convenzionali di ciascun pacchetto Pi installato, indicando sempre la relativa sorgente;
- i contenuti di un pacchetto non vengono modificati dall'app: l'azione corretta e' aprire o gestire il pacchetto nella tab **Pacchetti Pi**.

## Sicurezza e affidabilita'

- Nessun `child_process`, filesystem o impostazione Pi e' esposto al renderer.
- Tutti gli handler IPC continuano a verificare il sender attendibile.
- Un'operazione riceve un solo argomento sorgente, mai una riga di comando libera.
- Un pacchetto proveniente da Git o npm non viene mai scaricato, eseguito o aggiornato senza conferma.
- Le specifiche versionate npm e i ref Git restano pinning intenzionali: VincodeLab non li modifica durante `update`.
- Gli errori Pi non espongono token, credenziali SSH, contenuti di file o variabili d'ambiente.

## Impatto e compatibilita'

- Nessuna migrazione di file: la tab esistente usa gia' i comandi Pi e le installazioni restano in `~/.pi/agent`.
- Cambia il linguaggio UX da "estensione" a "pacchetto"; gli IPC possono restare compatibili internamente nella prima iterazione, ma i tipi e i test vengono rinominati per evitare nuovo debito semantico.
- Il catalogo npm non e' duplicato localmente: non viene introdotto cache, telemetria o una dipendenza di rete permanente.
- Non viene creato alcun pacchetto macOS; il collaudo avviene nell'app Electron in sviluppo.

## Verifica

- Unit: normalizzazione npm, Git e locale; rifiuto di specifiche vuote, doppio prefisso e caratteri di controllo.
- Service: `execFile` riceve `install|update|remove` e una sola specifica Pi; output ed errori restano normalizzati.
- Preload/IPC: solo la superficie minima prevista e sender verificato.
- UI: cambio sorgente, placeholder, specifica inviata, conferme, elenco e stato vuoto.
- Catalogo skill: separazione manuali/pacchetti, lettura di `pi.skills`, deduplicazione e assenza di qualunque fallback Codex.
- Manuale: installazione controllata di un pacchetto npm innocuo in ambiente di sviluppo, refresh, rimozione e verifica che le skill manuali in `~/.pi/agent/skills` restino indipendenti.
