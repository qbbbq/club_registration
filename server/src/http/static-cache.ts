interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ENTRY_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

export function setStaticFileCacheHeaders(response: HeaderResponse, filePath: string): void {
  const normalizedPath = filePath.replaceAll('\\', '/');

  if (normalizedPath.includes('/assets/')) {
    response.setHeader('Cache-Control', ASSET_CACHE_CONTROL);
    return;
  }

  if (normalizedPath.endsWith('/index.html') || normalizedPath === 'index.html') {
    setSpaEntryCacheHeaders(response);
  }
}

export function setSpaEntryCacheHeaders(response: HeaderResponse): void {
  response.setHeader('Cache-Control', ENTRY_CACHE_CONTROL);
}
