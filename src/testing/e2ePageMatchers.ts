export function pagePathUrlPattern(path: string): RegExp {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const escapedPath = normalizedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:[a-z][a-z0-9+.-]*://[^/?#]+)?${escapedPath}(?:[?#].*)?$`, 'i');
}
