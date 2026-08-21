import type { AlertLevel } from '../api/client';

// Cada fase tem duas variantes: -marcador (cor cheia, para bolinhas/tarjas/
// barras — elemento não textual, só precisa 3:1 de contraste) e -texto
// (clareada onde precisava, para texto — precisa 4,5:1 contra --bg-panel).
// Ver web/src/styles/tokens.css para a origem e os valores exatos.
const PHASE_MARKER_COLOR_VARS: Record<number, string> = {
  1: 'var(--fase-1-marcador)',
  2: 'var(--fase-2-marcador)',
  3: 'var(--fase-3-marcador)',
  4: 'var(--fase-4-marcador)',
  5: 'var(--fase-5-marcador)',
  6: 'var(--fase-6-marcador)',
};

const PHASE_TEXT_COLOR_VARS: Record<number, string> = {
  1: 'var(--fase-1-texto)',
  2: 'var(--fase-2-texto)',
  3: 'var(--fase-3-texto)',
  4: 'var(--fase-4-texto)',
  5: 'var(--fase-5-texto)',
  6: 'var(--fase-6-texto)',
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

/** Para bolinhas, tarjas e barras — elemento não textual. */
export function phaseMarkerColor(order: number | undefined | null): string {
  if (!order || !(order in PHASE_MARKER_COLOR_VARS)) {
    return 'var(--border)';
  }
  return PHASE_MARKER_COLOR_VARS[order];
}

/** Para texto (nome da fase, "F{n} · Nome"). */
export function phaseTextColor(order: number | undefined | null): string {
  if (!order || !(order in PHASE_TEXT_COLOR_VARS)) {
    return 'var(--text-secondary)';
  }
  return PHASE_TEXT_COLOR_VARS[order];
}
