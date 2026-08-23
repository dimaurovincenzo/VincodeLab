export interface AnimationFrameResizeScheduler {
  schedule(): void
  cancel(): void
}

export function createAnimationFrameResizeScheduler(
  run: () => void,
  requestFrame?: (callback: FrameRequestCallback) => number,
  cancelFrame?: (handle: number) => void,
): AnimationFrameResizeScheduler
