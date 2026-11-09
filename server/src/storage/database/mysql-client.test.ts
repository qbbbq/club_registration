import { afterEach, describe, expect, it, vi } from 'vitest';

const createPoolMock = vi.hoisted(() => vi.fn());

vi.mock('mysql2/promise', () => ({
  default: { createPool: createPoolMock },
  createPool: createPoolMock,
}));

describe('mysql-client', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses +08:00 timezone to match the MySQL server (Hong Kong, UTC+8)', async () => {
    vi.stubEnv('MYSQL_HOST', 'localhost');
    vi.stubEnv('MYSQL_USER', 'root');
    vi.stubEnv('MYSQL_DATABASE', 'club_registration');
    createPoolMock.mockClear();

    const { getPool } = await import('./mysql-client');
    getPool();

    expect(createPoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: '+08:00' })
    );
  });

  it('bounds the pool and queue and enables connection timeouts', async () => {
    vi.stubEnv('MYSQL_HOST', 'localhost');
    vi.stubEnv('MYSQL_USER', 'root');
    vi.stubEnv('MYSQL_DATABASE', 'club_registration');
    createPoolMock.mockClear();

    const { getPool } = await import('./mysql-client');
    getPool();

    expect(createPoolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionLimit: 80,
        queueLimit: 1000,
        connectTimeout: 10000,
        maxIdle: 40,
        idleTimeout: 60000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      })
    );
  });

  it('destroys an active transaction connection when its request is aborted', async () => {
    vi.stubEnv('MYSQL_HOST', 'localhost');
    vi.stubEnv('MYSQL_USER', 'root');
    vi.stubEnv('MYSQL_DATABASE', 'club_registration');
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      destroy: vi.fn(),
    };
    createPoolMock.mockReset();
    createPoolMock.mockReturnValue({
      getConnection: vi.fn().mockResolvedValue(connection),
    });
    const controller = new AbortController();

    const { withTransaction } = await import('./mysql-client');
    const work = withTransaction(async () => {
      controller.abort();
      return 'completed';
    }, controller.signal);

    await expect(work).rejects.toThrow('Request aborted');
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('rolls back and releases the connection when transaction work throws', async () => {
    vi.stubEnv('MYSQL_HOST', 'localhost');
    vi.stubEnv('MYSQL_USER', 'root');
    vi.stubEnv('MYSQL_DATABASE', 'club_registration');
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      destroy: vi.fn(),
    };
    createPoolMock.mockReset();
    createPoolMock.mockReturnValue({
      getConnection: vi.fn().mockResolvedValue(connection),
    });

    const { withTransaction } = await import('./mysql-client');
    await expect(withTransaction(async () => {
      throw new Error('quota insert failed');
    })).rejects.toThrow('quota insert failed');

    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('throws a clear error when MYSQL_HOST is missing', async () => {
    vi.stubEnv('MYSQL_HOST', '');
    vi.stubEnv('MYSQL_USER', 'root');
    vi.stubEnv('MYSQL_DATABASE', 'club_registration');

    const { getPool } = await import('./mysql-client');

    expect(() => getPool()).toThrow('MYSQL_HOST is not set');
  });

  it('throws a clear error when MYSQL_PORT is invalid', async () => {
    vi.stubEnv('MYSQL_HOST', 'localhost');
    vi.stubEnv('MYSQL_PORT', 'not-a-number');
    vi.stubEnv('MYSQL_USER', 'root');
    vi.stubEnv('MYSQL_DATABASE', 'club_registration');

    const { getPool } = await import('./mysql-client');

    expect(() => getPool()).toThrow('MYSQL_PORT must be a positive integer');
  });
});
