/** Render historical rows defensively; migration deliberately does not rewrite them. */
export function safeBrandLink(value: string | null | undefined, mediaPath = false): string | null {
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const relative = mediaPath && /^\/(?:api\/)?media\//.test(value);
    if (!relative && !/^https?:\/\//i.test(value)) return null;
    const url = new URL(value, relative ? 'https://brand.invalid' : undefined);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password &&
      (!relative || (url.origin === 'https://brand.invalid' && /^\/(?:api\/)?media\//.test(url.pathname))) ? value : null;
  } catch { return null; }
}
