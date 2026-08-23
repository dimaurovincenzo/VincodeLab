export function scheduleVisibleTerminalRefit(refit, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame) {
  let innerFrame = null
  let settledFrame = null
  const outerFrame = requestFrame(() => {
    innerFrame = requestFrame(() => {
      // Una board pesante può completare il layout dopo due frame: xterm deve misurare la superficie ormai visibile.
      settledFrame = requestFrame(refit)
    })
  })

  return () => {
    cancelFrame(outerFrame)
    if (innerFrame !== null) cancelFrame(innerFrame)
    if (settledFrame !== null) cancelFrame(settledFrame)
  }
}
