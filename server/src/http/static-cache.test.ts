import { describe, expect, it } from 'vitest';
import { setSpaEntryCacheHeaders, setStaticFileCacheHeaders } from './static-cache';

function createResponse() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  };
}

describe('static cache headers', () => {
  it('caches hashed assets for one year', () => {
    const response = createResponse();

    setStaticFileCacheHeaders(response, 'E:\\club-registration\\dist\\assets\\index-abc123.js');

    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable'
    );
  });

  it('does not cache the SPA entry file', () => {
    const response = createResponse();

    setStaticFileCacheHeaders(response, '/var/www/club-registration/dist/index.html');

    expect(response.headers.get('Cache-Control')).toBe(
      'no-cache, no-store, must-revalidate'
    );
  });

  it('does not cache SPA fallback responses', () => {
    const response = createResponse();

    setSpaEntryCacheHeaders(response);

    expect(response.headers.get('Cache-Control')).toBe(
      'no-cache, no-store, must-revalidate'
    );
  });
});
