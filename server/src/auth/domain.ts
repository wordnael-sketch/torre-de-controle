export function isAllowedDomain(email: string, allowedDomain: string): boolean {
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) {
    return false;
  }
  return parts[1] === allowedDomain.toLowerCase();
}
