import { describe, it, expect } from 'vitest';
import { computeAlertLevel } from '../src/models/alertLevel';

describe('computeAlertLevel', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');

  it('returns green when changed recently', () => {
    const lastChangedAt = new Date('2026-08-18T12:00:00.000Z');
    expect(computeAlertLevel(lastChangedAt, now)).toBe('green');
  });

  it('returns yellow after 3 days without change', () => {
    const lastChangedAt = new Date('2026-08-16T11:59:00.000Z');
    expect(computeAlertLevel(lastChangedAt, now)).toBe('yellow');
  });

  it('returns red after 7 days without change', () => {
    const lastChangedAt = new Date('2026-08-12T11:59:00.000Z');
    expect(computeAlertLevel(lastChangedAt, now)).toBe('red');
  });

  it('returns red when there is no history at all', () => {
    expect(computeAlertLevel(null, now)).toBe('red');
  });
});
