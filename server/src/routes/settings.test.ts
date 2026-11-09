import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
}));

describe('settings route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function createApp() {
    const { default: settingsRouter } = await import('./settings');
    const app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);
    return app;
  }

  it('GET returns null when no open time is set', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([] as any);
    const app = await createApp();

    const response = await request(app).get('/api/settings/registration-open-time');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { openAt: null } });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      ['registration_open_at']
    );
  });

  it('GET returns the stored open time', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([{ value: '2026-09-01T08:00:00+08:00' }] as any);
    const app = await createApp();

    const response = await request(app).get('/api/settings/registration-open-time');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { openAt: '2026-09-01T08:00:00+08:00' } });
  });

  it('PUT saves a valid open time', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-open-time')
      .send({ openAt: '2026-09-01T08:00:00+08:00' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: '报名开放时间设置成功' });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      ['registration_open_at', '2026-09-01T08:00:00+08:00']
    );
  });

  it('PUT rejects an invalid date', async () => {
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-open-time')
      .send({ openAt: 'not-a-date' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: '开放时间格式不正确' });
  });

  it('PUT with null clears the setting', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-open-time')
      .send({ openAt: null });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: '已清除报名开放时间，学生可随时报名' });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'DELETE FROM settings WHERE `key` = ?',
      ['registration_open_at']
    );
  });

  it('GET returns the default registration title when no title is set', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([] as any);
    const app = await createApp();

    const response = await request(app).get('/api/settings/registration-title');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { title: '社团报名系统' },
    });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT `value` FROM settings WHERE `key` = ? LIMIT 1',
      ['registration_title']
    );
  });

  it('GET returns the stored registration title', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([{ value: '2026 秋季社团报名' }] as any);
    const app = await createApp();

    const response = await request(app).get('/api/settings/registration-title');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { title: '2026 秋季社团报名' },
    });
  });

  it('PUT saves a trimmed registration title', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-title')
      .send({ title: '  2026 秋季社团报名  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: '报名入口标题设置成功',
      data: { title: '2026 秋季社团报名' },
    });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      ['registration_title', '2026 秋季社团报名']
    );
  });

  it('PUT with an empty title clears the setting and restores the default', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue({ affectedRows: 1 } as any);
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-title')
      .send({ title: '   ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: '已恢复默认报名入口标题',
      data: { title: '社团报名系统' },
    });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'DELETE FROM settings WHERE `key` = ?',
      ['registration_title']
    );
  });

  it('PUT rejects a registration title longer than 30 characters', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const app = await createApp();

    const response = await request(app)
      .put('/api/settings/registration-title')
      .send({ title: '一'.repeat(31) });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: '报名入口标题不能超过30个字符',
    });
    expect(mysqlClient.query).not.toHaveBeenCalled();
  });
});
