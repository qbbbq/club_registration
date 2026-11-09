"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConcurrencyLimiter = createConcurrencyLimiter;
function createConcurrencyLimiter(options) {
    if (!Number.isInteger(options.maxConcurrent) ||
        options.maxConcurrent < 1 ||
        !Number.isInteger(options.maxQueue) ||
        options.maxQueue < 0 ||
        (options.abortGraceMs !== undefined &&
            (!Number.isInteger(options.abortGraceMs) || options.abortGraceMs < 0))) {
        throw new Error('Concurrency limiter limits must be valid integers');
    }
    const abortGraceMs = options.abortGraceMs ?? 30_000;
    let active = 0;
    const queue = [];
    const startRequest = (pending) => {
        pending.cleanup?.();
        active += 1;
        let released = false;
        let abortTimer;
        const releaseOnce = () => {
            if (released)
                return;
            released = true;
            if (abortTimer)
                clearTimeout(abortTimer);
            active -= 1;
            while (active < options.maxConcurrent && queue.length > 0) {
                const nextPending = queue.shift();
                if (!nextPending || nextPending.cancelled)
                    continue;
                startRequest(nextPending);
            }
        };
        let finished = false;
        pending.response.once('finish', () => {
            finished = true;
            releaseOnce();
        });
        pending.response.once('close', () => {
            if (finished)
                return;
            // Client disconnects do not cancel an async handler or a MySQL query.
            // Keep the slot for a bounded grace period instead of releasing it
            // immediately and allowing abandoned work to exceed the limit.
            abortTimer = setTimeout(releaseOnce, abortGraceMs);
            abortTimer.unref?.();
        });
        pending.next();
    };
    return (request, response, next) => {
        if (active < options.maxConcurrent) {
            startRequest({ request, response, next, cancelled: false });
            return;
        }
        if (queue.length >= options.maxQueue) {
            response.status(503).json({
                success: false,
                message: '服务器繁忙，请稍后重试',
            });
            return;
        }
        const pending = {
            request,
            response,
            next,
            cancelled: false,
        };
        const cancel = () => {
            const index = queue.indexOf(pending);
            if (index >= 0)
                queue.splice(index, 1);
            pending.cancelled = true;
        };
        request.once('aborted', cancel);
        response.once('close', cancel);
        pending.cleanup = () => {
            request.removeListener('aborted', cancel);
            response.removeListener('close', cancel);
        };
        queue.push(pending);
    };
}
