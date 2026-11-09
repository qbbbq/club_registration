import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createConcurrencyLimiter } from './concurrency-limiter';

class FakeRequest extends EventEmitter {}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  body: unknown;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    this.emit('finish');
    return this;
  }
}

describe('API concurrency limiter', () => {
  it('returns 503 when active and queued capacity are full', () => {
    const limiter = createConcurrencyLimiter({ maxConcurrent: 1, maxQueue: 1 });
    const next = vi.fn();
    const firstResponse = new FakeResponse();
    const secondResponse = new FakeResponse();
    const thirdResponse = new FakeResponse();

    limiter(new FakeRequest() as any, firstResponse as any, next);
    limiter(new FakeRequest() as any, secondResponse as any, next);
    limiter(new FakeRequest() as any, thirdResponse as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(thirdResponse.statusCode).toBe(503);
    expect(thirdResponse.body).toEqual({
      success: false,
      message: '服务器繁忙，请稍后重试',
    });
  });

  it('starts the next queued request after the active response finishes', () => {
    const limiter = createConcurrencyLimiter({ maxConcurrent: 1, maxQueue: 1 });
    const next = vi.fn();
    const firstResponse = new FakeResponse();
    const secondResponse = new FakeResponse();

    limiter(new FakeRequest() as any, firstResponse as any, next);
    limiter(new FakeRequest() as any, secondResponse as any, next);

    expect(next).toHaveBeenCalledTimes(1);

    firstResponse.emit('finish');

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('removes an aborted queued request so it does not consume queue capacity', () => {
    const limiter = createConcurrencyLimiter({ maxConcurrent: 1, maxQueue: 1 });
    const next = vi.fn();
    const firstResponse = new FakeResponse();
    const secondRequest = new FakeRequest();
    const secondResponse = new FakeResponse();
    const thirdResponse = new FakeResponse();

    limiter(new FakeRequest() as any, firstResponse as any, next);
    limiter(secondRequest as any, secondResponse as any, next);
    secondRequest.emit('aborted');
    limiter(new FakeRequest() as any, thirdResponse as any, next);

    expect(thirdResponse.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);

    firstResponse.emit('finish');

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('keeps an aborted active slot during the grace period', () => {
    vi.useFakeTimers();
    try {
      const limiter = createConcurrencyLimiter({
        maxConcurrent: 1,
        maxQueue: 1,
        abortGraceMs: 100,
      });
      const next = vi.fn();
      const firstResponse = new FakeResponse();
      const secondResponse = new FakeResponse();

      limiter(new FakeRequest() as any, firstResponse as any, next);
      limiter(new FakeRequest() as any, secondResponse as any, next);
      firstResponse.emit('close');

      expect(next).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(99);
      expect(next).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
