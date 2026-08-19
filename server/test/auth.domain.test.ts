import { describe, it, expect } from 'vitest';
import { isAllowedDomain } from '../src/auth/domain';

describe('isAllowedDomain', () => {
  it('accepts an email on the allowed domain', () => {
    expect(isAllowedDomain('wilka@ilhacrossmidia.com.br', 'ilhacrossmidia.com.br')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAllowedDomain('Wilka@IlhaCrossmidia.com.br', 'ilhacrossmidia.com.br')).toBe(true);
  });

  it('rejects an email on a different domain', () => {
    expect(isAllowedDomain('wilka@gmail.com', 'ilhacrossmidia.com.br')).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(isAllowedDomain('not-an-email', 'ilhacrossmidia.com.br')).toBe(false);
  });
});
