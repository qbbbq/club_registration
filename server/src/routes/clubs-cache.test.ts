import { afterEach, describe, expect, it } from 'vitest';

import {
  clearClubsCache,
  getCachedClubs,
  getClubsCacheVersion,
  setCachedClubs,
} from './clubs-cache';

describe('clubs cache invalidation', () => {
  afterEach(() => {
    clearClubsCache();
  });

  it('does not let an in-flight read repopulate stale data after invalidation', () => {
    const readVersion = getClubsCacheVersion();

    setCachedClubs([{ name: '旧数据' }], readVersion);
    clearClubsCache();
    setCachedClubs([{ name: '并发旧结果' }], readVersion);

    expect(getCachedClubs()).toBeNull();
  });
});
