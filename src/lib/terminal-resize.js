export function createAnimationFrameResizeScheduler(run, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame) {
  let frame = null

  return {
    schedule() {
      if (frame !== null) return
      frame = requestFrame(() => {
        frame = null
        run()
      })
    },
    cancel() {
      if (frame === null) return
      cancelFrame(frame)
      frame = null
    },
  }
}
