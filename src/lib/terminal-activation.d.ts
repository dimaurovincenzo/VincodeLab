export function scheduleVisibleTerminalRefit(
  refit: () => void,
  requestFrame?: (callback: FrameRequestCallback) => number,
  cancelFrame?: (frame: number) => void,
): () => void
