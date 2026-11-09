"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequestAbortContext = createRequestAbortContext;
exports.getRequestAbortSignal = getRequestAbortSignal;
const requestAbortSignalKey = Symbol.for('club-registration.request-abort-signal');
function createRequestAbortContext(options = {}) {
    const timeoutMs = options.timeoutMs ?? 25_000;
    return (request, response, next) => {
        const controller = new AbortController();
        request[requestAbortSignalKey] = controller.signal;
        let finished = false;
        const cleanup = () => {
            clearTimeout(timeout);
            request.removeListener('aborted', abort);
            response.removeListener('finish', finish);
            response.removeListener('close', abort);
        };
        const abort = () => {
            if (!finished)
                controller.abort();
            cleanup();
        };
        const finish = () => {
            finished = true;
            cleanup();
        };
        const timeout = setTimeout(() => {
            if (finished || controller.signal.aborted)
                return;
            controller.abort();
            if (!response.headersSent) {
                response.status(504).json({
                    success: false,
                    message: '请求超时，请稍后重试',
                });
            }
        }, timeoutMs);
        timeout.unref?.();
        request.once('aborted', abort);
        response.once('finish', finish);
        response.once('close', abort);
        next();
    };
}
function getRequestAbortSignal(request) {
    return request[requestAbortSignalKey];
}
