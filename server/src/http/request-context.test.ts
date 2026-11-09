import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createRequestAbortContext, getRequestAbortSignal } from './request-context';

class FakeRequest extends EventEmitter {}

class FakeResponse extends EventEmitter {}

describe('request abort context', () => {
  it('aborts the request signal when the client closes before the response finishes', () => {
    const request = new FakeRequest();
    const response = new FakeResponse();
    const next = vi.fn();

    createRequestAbortContext()(request as any, response as any, next);
    const signal = getRequestAbortSignal(request as any);

    expect(next).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);

    response.emit('close');

    expect(signal?.aborted).toBe(true);
  });

  it('does not abort after a normal response finishes', () => {
    const request = new FakeRequest();
    const response = new FakeResponse();
    const next = vi.fn();

    createRequestAbortContext()(request as any, response as any, next);
    const signal = getRequestAbortSignal(request as any);

    response.emit('finish');
    response.emit('close');

    expect(signal?.aborted).toBe(false);
  });
});
