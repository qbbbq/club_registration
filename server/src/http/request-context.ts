import type { Request, RequestHandler, Response } from 'express';

const requestAbortSignalKey = Symbol.for('club-registration.request-abort-signal');

type RequestWithAbortSignal = Request & {
  [requestAbortSignalKey]?: AbortSignal;
};

interface RequestAbortContextOptions {
  timeoutMs?: number;
}

export function createRequestAbortContext(
  options: RequestAbortContextOptions = {}
): RequestHandler {
  const timeoutMs = options.timeoutMs ?? 25_000;

  return (request, response, next) => {
    const controller = new AbortController();
    (request as RequestWithAbortSignal)[requestAbortSignalKey] = controller.signal;
    let finished = false;

    const cleanup = () => {
      clearTimeout(timeout);
      request.removeListener('aborted', abort);
      response.removeListener('finish', finish);
      response.removeListener('close', abort);
    };

    const abort = () => {
      if (!finished) controller.abort();
      cleanup();
    };

    const finish = () => {
      finished = true;
      cleanup();
    };

    const timeout = setTimeout(() => {
      if (finished || controller.signal.aborted) return;

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

export function getRequestAbortSignal(request: Request): AbortSignal | undefined {
  return (request as RequestWithAbortSignal)[requestAbortSignalKey];
}
