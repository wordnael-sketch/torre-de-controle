export type AlertLevel = 'green' | 'yellow' | 'red';

const YELLOW_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const RED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function computeAlertLevel(lastChangedAt: Date | null, now: Date): AlertLevel {
  if (!lastChangedAt) {
    return 'red';
  }

  const elapsedMs = now.getTime() - lastChangedAt.getTime();

  if (elapsedMs >= RED_THRESHOLD_MS) {
    return 'red';
  }
  if (elapsedMs >= YELLOW_THRESHOLD_MS) {
    return 'yellow';
  }
  return 'green';
}
