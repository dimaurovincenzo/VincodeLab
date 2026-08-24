// Identità persistente della risorsa GitHub, indipendente dal canale IPC che la
// espone. È un contratto interno tra il caso d'uso e l'adapter della cache.
const GITHUB_DATA_CACHE_KEY = 'github-data-snapshot'

module.exports = { GITHUB_DATA_CACHE_KEY }
