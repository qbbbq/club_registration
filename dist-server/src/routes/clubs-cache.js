"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedClubs = getCachedClubs;
exports.getClubsCacheVersion = getClubsCacheVersion;
exports.setCachedClubs = setCachedClubs;
exports.clearClubsCache = clearClubsCache;
let cachedJson = null;
let cachedAt = 0;
let cacheVersion = 0;
const TTL_MS = 10_000;
function getCachedClubs() {
    if (cachedJson === null)
        return null;
    if (Date.now() - cachedAt > TTL_MS) {
        cachedJson = null;
        cachedAt = 0;
        return null;
    }
    return JSON.parse(cachedJson);
}
function getClubsCacheVersion() {
    return cacheVersion;
}
function setCachedClubs(clubs, version = cacheVersion) {
    if (version !== cacheVersion)
        return;
    cachedJson = JSON.stringify(clubs);
    cachedAt = Date.now();
}
function clearClubsCache() {
    cacheVersion += 1;
    cachedJson = null;
    cachedAt = 0;
}
