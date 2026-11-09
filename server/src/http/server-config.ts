interface HttpServer {
  requestTimeout: number;
  headersTimeout: number;
  timeout: number;
  keepAliveTimeout: number;
}

export function configureHttpServer(server: HttpServer): void {
  server.requestTimeout = 30_000;
  server.timeout = 30_000;
  server.headersTimeout = 25_000;
  server.keepAliveTimeout = 5_000;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function getApiConcurrencyLimits(): { maxConcurrent: number; maxQueue: number } {
  return {
    maxConcurrent: readPositiveInteger('API_MAX_CONCURRENT', 200),
    maxQueue: readPositiveInteger('API_MAX_QUEUE', 1000),
  };
}
