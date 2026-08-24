function safeKillPty(ptyProcess) {
  if (!ptyProcess || typeof ptyProcess.kill !== 'function') return false
  try {
    ptyProcess.kill()
    return true
  } catch {
    // node-pty può notificare exit e rilasciare il processo fra il controllo e kill().
    return false
  }
}

module.exports = { safeKillPty }
