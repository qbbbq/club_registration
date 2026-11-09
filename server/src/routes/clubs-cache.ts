let cachedJson: string | null = null;
let cachedAt = 0;
let cacheVersion = 0;

const TTL_MS = 10_000;

export function getCachedClubs(): unknown[] | null {
  if (cachedJson === null) return null;

  if (Date.now() - cachedAt > TTL_MS) {
    cachedJson = null;
    cachedAt = 0;
    return null;
  }

  return JSON.parse(cachedJson);
}

export function getClubsCacheVersion(): number {
  return cacheVersion;
}

export function setCachedClubs(clubs: unknown[], version = cacheVersion): void {
  if (version !== cacheVersion) return;

  cachedJson = JSON.stringify(clubs);
  cachedAt = Date.now();
}

export function clearClubsCache(): void {
  cacheVersion += 1;
  cachedJson = null;
  cachedAt = 0;
}
