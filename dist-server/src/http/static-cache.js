"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setStaticFileCacheHeaders = setStaticFileCacheHeaders;
exports.setSpaEntryCacheHeaders = setSpaEntryCacheHeaders;
const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ENTRY_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';
function setStaticFileCacheHeaders(response, filePath) {
    const normalizedPath = filePath.replaceAll('\\', '/');
    if (normalizedPath.includes('/assets/')) {
        response.setHeader('Cache-Control', ASSET_CACHE_CONTROL);
        return;
    }
    if (normalizedPath.endsWith('/index.html') || normalizedPath === 'index.html') {
        setSpaEntryCacheHeaders(response);
    }
}
function setSpaEntryCacheHeaders(response) {
    response.setHeader('Cache-Control', ENTRY_CACHE_CONTROL);
}
