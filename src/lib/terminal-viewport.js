export function shouldFollowTerminalOutput({ viewportY, baseY }) {
  return viewportY >= baseY
}

export function terminalStatusLabel(status, readyLabel) {
  if (status === 'running') return readyLabel
  if (status === 'starting') return 'Avvio…'
  if (status === 'ended') return 'Sessione terminata'
  return 'Errore sessione'
}
