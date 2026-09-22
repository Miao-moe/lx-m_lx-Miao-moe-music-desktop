export const getBufferRecoveryPosition = (current: number, duration: number, step: number): number | null => {
  if (!Number.isFinite(current) || current < 0 || !Number.isFinite(duration) || duration <= current || !Number.isFinite(step) || step <= 0) return null
  const remaining = duration - current
  // A probe must be an absolute position ahead of the current sample, and must
  // never seek to the end (which would manufacture an ended event).
  if (remaining < 0.25) return null
  return current + Math.min(step, remaining / 2)
}
