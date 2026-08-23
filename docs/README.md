# Documentazione di VincodeLab

Questa directory raccoglie le guide operative del progetto e le evidenze pubbliche di qualità.

## Guide correnti

| Documento | Contenuto |
| --- | --- |
| [Architettura](architecture.md) | Processi Electron, confini IPC, domini e persistenza |
| [Sviluppo](development.md) | Setup locale, struttura del repository e comandi utili |
| [Test](testing.md) | Gate automatici, verifiche mirate e collaudo manuale |
| [Build e release](release.md) | Packaging macOS, smoke test e requisiti per una distribuzione pubblica |
| [Compatibilità runtime](runtime-compatibility.md) | Mac pulito, componenti inclusi, strumenti opzionali e recovery |
| [Screenshot](screenshots.md) | Workspace dimostrativo, privacy e convenzioni delle immagini |
| [Contribuire](../CONTRIBUTING.md) | Convenzioni per codice, test e pull request |
| [Sicurezza](../SECURITY.md) | Ambito e canale privato per le vulnerabilità |

## Altri documenti

- `qa/` conserva audit, baseline e risultati di verifiche eseguite in specifici momenti dello sviluppo.
- `assets/screenshots/` contiene gli screenshot pubblici e le baseline visuali storiche.

I documenti di audit sono **evidenze storiche**: possono citare branch, architetture o decisioni superate. Per conoscere il comportamento attuale, l'ordine delle fonti è:

1. codice e test della revisione corrente;
2. `package.json` e configurazioni versionate;
3. guide correnti elencate sopra;
4. audit storici.

Quando una modifica rende una guida corrente inesatta, aggiornala nella stessa pull request.
