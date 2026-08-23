# VincodeLab — trend bundle

Il bundle viene monitorato, non ottimizzato in assenza di una regressione
misurabile. I valori sono prodotti da Vite in modalità produzione; `—` indica
un dato non disponibile nella misura storica.

| Data | Commit | JavaScript principale | Raw JS | Gzip JS | CSS | Raw CSS | Gzip CSS |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: |
| 21 ago 2026 | baseline dichiarata | — | 454,20 kB | — | — | — | — |
| 21 ago 2026 | pre-migrazione | `index` | 463,98 kB | 142,48 kB | `index` | 181,17 kB | 28,04 kB |
| 21 ago 2026 | `ea47408` | `index-Dbx9D7kr.js` | 464,51 kB | 142,62 kB | `index-BGkSMlJW.css` | 187,22 kB | 27,86 kB |

## Valutazione

- JavaScript gzip: `+0,14 kB` rispetto alla misura pre-migrazione.
- CSS gzip: `-0,18 kB` rispetto alla misura pre-migrazione.
- La crescita raw del CSS riflette il nuovo contratto centralizzato di token,
  primitive, shell e viste; il trasferimento compresso non è aumentato.
- Nessun blocco percepibile o superamento della soglia concordata è emerso.
  Non viene quindi introdotta alcuna ottimizzazione speculativa del bundle.

La misura va aggiornata soltanto con build produzione confrontabili e con il
nome reale degli asset generati.
