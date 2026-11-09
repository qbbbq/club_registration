import dotenv from 'dotenv';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

dotenv.config();

let pool: Pool | null = null;

export class RequestAbortedError extends Error {
  constructor() {
    super('Request aborted');
    this.name = 'RequestAbortedError';
  }
}

interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getMysqlConfig(): MysqlConfig {
  const portValue = process.env.MYSQL_PORT || '3306';
  const port = Number(portValue);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('MYSQL_PORT must be a positive integer');
  }

  return {
    host: requireEnv('MYSQL_HOST'),
    port,
    user: requireEnv('MYSQL_USER'),
    password: process.env.MYSQL_PASSWORD || '',
    database: requireEnv('MYSQL_DATABASE'),
  };
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function getPool(): Pool {
  if (!pool) {
    const config = getMysqlConfig();
    const connectionLimit = readPositiveInteger('MYSQL_CONNECTION_LIMIT', 80);
    const maxIdle = readPositiveInteger('MYSQL_MAX_IDLE', 40);
    if (maxIdle > connectionLimit) {
      throw new Error('MYSQL_MAX_IDLE cannot exceed MYSQL_CONNECTION_LIMIT');
    }
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit,
      queueLimit: readPositiveInteger('MYSQL_QUEUE_LIMIT', 1000),
      connectTimeout: readPositiveInteger('MYSQL_CONNECT_TIMEOUT_MS', 10000),
      maxIdle,
      idleTimeout: readPositiveInteger('MYSQL_IDLE_TIMEOUT_MS', 60000),
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      namedPlaceholders: false,
      charset: 'utf8mb4',
      // MySQL 服务器（香港）的会话时区为 +08:00，必须保持一致，
      // 否则 mysql2 会把服务器返回的本地时间误当作 UTC 解析，导致时间快 8 小时。
      timezone: '+08:00',
    });
  }

  return pool;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RequestAbortedError();
}

async function getConnection(signal?: AbortSignal): Promise<PoolConnection> {
  throwIfAborted(signal);
  if (!signal) return getPool().getConnection();

  return new Promise<PoolConnection>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(new RequestAbortedError());
    };

    signal.addEventListener('abort', abort, { once: true });
    getPool().getConnection().then(
      (connection) => {
        if (settled || signal.aborted) {
          connection.release();
          return;
        }

        settled = true;
        signal.removeEventListener('abort', abort);
        resolve(connection);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}

function attachAbortHandler(connection: PoolConnection, signal?: AbortSignal): {
  destroyed: () => boolean;
  detach: () => void;
} {
  let wasDestroyed = false;
  const abort = () => {
    if (wasDestroyed) return;
    wasDestroyed = true;
    connection.destroy();
  };

  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  return {
    destroyed: () => wasDestroyed,
    detach: () => signal?.removeEventListener('abort', abort),
  };
}

export async function query<T extends RowDataPacket[] | ResultSetHeader>(
  sql: string,
  params: any[] = [],
  signal?: AbortSignal
): Promise<T> {
  const connection = await getConnection(signal);
  const abortHandler = attachAbortHandler(connection, signal);

  try {
    throwIfAborted(signal);
    const [rows] = await connection.execute<T>(sql, params);
    throwIfAborted(signal);
    return rows;
  } catch (error) {
    if (signal?.aborted) throw new RequestAbortedError();
    throw error;
  } finally {
    abortHandler.detach();
    if (!abortHandler.destroyed()) connection.release();
  }
}

export async function withTransaction<T>(
  callback: (connection: PoolConnection) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const connection = await getConnection(signal);
  const abortHandler = attachAbortHandler(connection, signal);

  try {
    throwIfAborted(signal);
    await connection.beginTransaction();
    throwIfAborted(signal);
    const result = await callback(connection);
    throwIfAborted(signal);
    await connection.commit();
    return result;
  } catch (error) {
    if (!abortHandler.destroyed()) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        if (!signal?.aborted) throw rollbackError;
      }
    }

    if (signal?.aborted) throw new RequestAbortedError();
    throw error;
  } finally {
    abortHandler.detach();
    if (!abortHandler.destroyed()) connection.release();
  }
}
