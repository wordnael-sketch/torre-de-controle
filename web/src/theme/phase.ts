import type { AlertLevel } from '../api/client';

export const PHASE_COLOR_VARS: Record<number, string> = {
  1: 'var(--fase-1)',
  2: 'var(--fase-2)',
  3: 'var(--fase-3)',
  4: 'var(--fase-4)',
  5: 'var(--fase-5)',
  6: 'var(--fase-6)',
};

export const FAROL_COLOR_VARS: Record<AlertLevel, string> = {
  red: 'var(--farol-travado)',
  yellow: 'var(--farol-atencao)',
  green: 'var(--farol-fluindo)',
};

export const FAROL_LABELS: Record<AlertLevel, string> = {
  red: 'Travado',
  yellow: 'Atenção',
  green: 'Fluindo',
};

export function phaseColor(order: number | undefined | null): string {
  if (!order || !(order in PHASE_COLOR_VARS)) {
    return 'var(--border)';
  }
  return PHASE_COLOR_VARS[order];
}
