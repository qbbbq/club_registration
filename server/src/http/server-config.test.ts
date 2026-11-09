import { describe, expect, it } from 'vitest';
import { configureHttpServer } from './server-config';

describe('HTTP server timeout configuration', () => {
  it('sets bounded request, header, socket, and keep-alive timeouts', () => {
    const server = {
      requestTimeout: 0,
      headersTimeout: 0,
      timeout: 0,
      keepAliveTimeout: 0,
    };

    configureHttpServer(server);

    expect(server.requestTimeout).toBe(30_000);
    expect(server.timeout).toBe(30_000);
    expect(server.headersTimeout).toBe(25_000);
    expect(server.keepAliveTimeout).toBe(5_000);
  });
});
