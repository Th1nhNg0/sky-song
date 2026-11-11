/**
 * Builds a voice's `stop`: a fade short enough to sound immediate and smooth enough not to
 * click, applied at most once. `release` then stops or disconnects what the voice holds.
 */
export function createVoiceStop(
  ctx: BaseAudioContext,
  gain: GainNode,
  release: (at: number) => void,
): (when?: number) => void {
  let stopped = false;
  return (when) => {
    if (stopped) return;
    stopped = true;
    const at = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    try {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0.0001, at, 0.012);
    } catch {
      gain.gain.value = 0;
    }
    release(at);
  };
}
