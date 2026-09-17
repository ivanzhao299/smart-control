/** Only allow an in-app absolute path after login. */
export function normalizeClientRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/\p{Cc}/u.test(value)) return '/';
  return value;
}
