"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureHttpServer = configureHttpServer;
exports.getApiConcurrencyLimits = getApiConcurrencyLimits;
function configureHttpServer(server) {
    server.requestTimeout = 30_000;
    server.timeout = 30_000;
    server.headersTimeout = 25_000;
    server.keepAliveTimeout = 5_000;
}
function readPositiveInteger(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}
function getApiConcurrencyLimits() {
    return {
        maxConcurrent: readPositiveInteger('API_MAX_CONCURRENT', 200),
        maxQueue: readPositiveInteger('API_MAX_QUEUE', 1000),
    };
}
