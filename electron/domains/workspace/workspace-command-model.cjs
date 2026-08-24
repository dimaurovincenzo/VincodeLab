function assertSshDestination(value) {
  const allowedCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:@[]-'
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || value.startsWith('-') || [...value].some((character) => !allowedCharacters.includes(character))) {
    throw new Error('Destinazione SSH non valida.')
  }
  return value
}

function assertRemoteRoot(value) {
  if (typeof value !== 'string' || value.length > 4_096 || /[\0\r\n]/.test(value) || (!value.startsWith('/') && value !== '~' && !value.startsWith('~/'))) {
    throw new Error('Percorso remoto non valido.')
  }
  return value
}

module.exports = { assertRemoteRoot, assertSshDestination }
