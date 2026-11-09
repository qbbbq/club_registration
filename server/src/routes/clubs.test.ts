import express from 'express';
import request from 'supertest';
import * as xlsx from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

describe('clubs route', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    const { clearClubsCache } = await import('./clubs-cache');
    clearClubsCache();
  });

  async function createApp() {
    const { default: clubsRouter } = await import('./clubs');
    const app = express();
    app.use(express.json());
    app.use('/api/clubs', clubsRouter);
    return app;
  }

  it('lists clubs from MySQL ordered by id', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([{ id: 1, name: '编程社' }] as any);
    const app = await createApp();

    const response = await request(app).get('/api/clubs');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1, name: '编程社', grade: null, grades: [] }]);
    expect(mysqlClient.query).toHaveBeenCalledWith('SELECT * FROM clubs ORDER BY id');
  });

  it('serves repeated GETs from cache without hitting MySQL again', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([{ id: 1, name: '编程社' }] as any);
    const app = await createApp();

    const first = await request(app).get('/api/clubs');
    const second = await request(app).get('/api/clubs');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual([{ id: 1, name: '编程社', grade: null, grades: [] }]);
    expect(mysqlClient.query).toHaveBeenCalledTimes(1);
  });

  it('clears the club cache after creating a club', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([{ id: 1, name: '编程社' }] as any) // GET1 查库
      .mockResolvedValueOnce([] as any) // POST 查重：无同名
      .mockResolvedValueOnce({ insertId: 7 } as any) // POST INSERT
      .mockResolvedValueOnce([{ id: 7, name: '机器人社', total_quota: 30, remaining_quota: 30 }] as any) // POST 查记录
      .mockResolvedValueOnce([{ id: 1, name: '编程社' }, { id: 7, name: '机器人社' }] as any); // 缓存失效后的 GET
    const app = await createApp();

    await request(app).get('/api/clubs'); // 查库，写入缓存
    await request(app).get('/api/clubs'); // 命中缓存，不查库
    await request(app).post('/api/clubs').send({
      name: '机器人社',
      description: '机器人活动',
      grade: '初一',
      total_quota: 30,
      manager: '李老师',
      manager_contact: '13800000000',
    });
    await request(app).get('/api/clubs'); // 缓存已清，重新查库

    expect(mysqlClient.query).toHaveBeenCalledTimes(5);
    expect(mysqlClient.query).toHaveBeenNthCalledWith(5, 'SELECT * FROM clubs ORDER BY id');
  });

  it('creates a club with remaining quota equal to total quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ insertId: 7 } as any)
      .mockResolvedValueOnce([{ id: 7, name: '机器人社', total_quota: 30, remaining_quota: 30 }] as any);
    const app = await createApp();

    const response = await request(app).post('/api/clubs').send({
      name: '机器人社',
      description: '机器人活动',
      grade: '初一',
      total_quota: 30,
      manager: '李老师',
      manager_contact: '13800000000',
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO clubs'),
      ['机器人社', '机器人活动', '初一', 30, 30, '李老师', '13800000000']
    );
  });

  it('clears the club cache when creation succeeds but the follow-up read fails', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const databaseError = new Error('database unavailable');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([{ id: 1, name: '旧社团' }] as any) // GET 写入缓存
      .mockResolvedValueOnce([] as any) // POST 查重
      .mockResolvedValueOnce({ insertId: 8 } as any) // INSERT 成功
      .mockRejectedValueOnce(databaseError) // POST 查记录失败
      .mockResolvedValueOnce([{ id: 8, name: '新社团', grade: '初一' }] as any); // 清缓存后的 GET
    const app = await createApp();

    await request(app).get('/api/clubs');
    const createResponse = await request(app).post('/api/clubs').send({
      name: '新社团',
      grade: '初一',
      total_quota: 30,
    });

    expect(createResponse.status).toBe(500);
    const clubsResponse = await request(app).get('/api/clubs');

    expect(clubsResponse.body).toEqual([{ id: 8, name: '新社团', grade: '初一', grades: ['初一'] }]);
    expect(mysqlClient.query).toHaveBeenCalledTimes(5);
  });

  it('rejects a club with an invalid grade', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const app = await createApp();

    const response = await request(app).post('/api/clubs').send({
      name: '机器人社',
      description: '机器人活动',
      grade: '高一',
      total_quota: 30,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('年级');
    expect(mysqlClient.query).not.toHaveBeenCalled();
  });

  it('updates a club grade without changing registered quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[{
        id: 1,
        name: '编程社',
        grade: '初一',
        total_quota: 30,
        remaining_quota: 28,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    vi.mocked(mysqlClient.withTransaction).mockImplementation(async (callback) =>
      callback({ execute } as any)
    );
    const app = await createApp();

    const response = await request(app).put('/api/clubs/1').send({
      grade: '初二',
      total_quota: 30,
      manager: '李老师',
      manager_contact: '13800000000',
    });

    expect(response.status).toBe(200);
    expect(mysqlClient.withTransaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      [1]
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE clubs'),
      ['初二', 30, 28, '李老师', '13800000000', 1]
    );
  });

  it('imports a new club from CSV', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ insertId: 7, affectedRows: 1 } as any);
    const app = await createApp();
    const file = Buffer.from(
      '社团名称,社团描述,年级,最大报名人数,社团负责人,负责人联系方式\n机器人社,机器人活动,初一,30,李老师,13800000000',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/clubs/import')
      .attach('file', file, 'clubs.csv');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { createdCount: 1, updatedCount: 0, skipCount: 0 },
    });
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO clubs'),
      ['机器人社', '机器人活动', '初一', 30, 30, '李老师', '13800000000']
    );
  });

  it('updates an existing club from CSV while preserving registered quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValueOnce([{
      id: 1,
      total_quota: 30,
      remaining_quota: 28,
    }] as any);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{
        id: 1,
        total_quota: 30,
        remaining_quota: 28,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    vi.mocked(mysqlClient.withTransaction).mockImplementation(async (callback) =>
      callback({ execute } as any)
    );
    const app = await createApp();
    const file = Buffer.from(
      '社团名称,社团描述,年级,最大报名人数,社团负责人,负责人联系方式\n编程社,新描述,初二,30,王老师,13900000000',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/clubs/import')
      .attach('file', file, 'clubs.csv');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ createdCount: 0, updatedCount: 1, skipCount: 0 });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      [1]
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE clubs'),
      ['新描述', '初二', 30, 28, '王老师', '13900000000', 1]
    );
  });

  it('skips an import row when the new quota is below registered count', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValueOnce([{
      id: 1,
      total_quota: 30,
      remaining_quota: 28,
    }] as any);
    const execute = vi.fn().mockResolvedValueOnce([[{
      id: 1,
      total_quota: 30,
      remaining_quota: 28,
    }]]);
    vi.mocked(mysqlClient.withTransaction).mockImplementation(async (callback) =>
      callback({ execute } as any)
    );
    const app = await createApp();
    const file = Buffer.from(
      '社团名称,社团描述,年级,最大报名人数,社团负责人,负责人联系方式\n编程社,新描述,初二,1,王老师,13900000000',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/clubs/import')
      .attach('file', file, 'clubs.csv');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ createdCount: 0, updatedCount: 0, skipCount: 1 });
    expect(response.body.data.errors[0]).toContain('最大报名人数不能小于已报名人数');
    expect(mysqlClient.query).toHaveBeenCalledTimes(1);
  });

  it('exports clubs as an Excel workbook with grade columns', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([{
      name: '编程社',
      description: '编程活动',
      grade: '初一',
      total_quota: 30,
      remaining_quota: 28,
      manager: '李老师',
      manager_contact: '13800000000',
      created_at: new Date('2026-09-05T00:00:00.000Z'),
      updated_at: null,
    }] as any);
    const app = await createApp();

    const response = await request(app)
      .get('/api/clubs/export')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(response.headers['content-disposition']).toContain('.xlsx');

    const workbook = xlsx.read(response.body, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    expect(rows[0]).toMatchObject({ 社团名称: '编程社', 年级: '初一', 最大报名人数: 30 });
  });

  it('creates a club with multiple grades and returns both grade formats', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ insertId: 7 } as any)
      .mockResolvedValueOnce([{
        id: 7,
        name: '机器人社',
        grade: '初一,初三',
        total_quota: 30,
        remaining_quota: 30,
      }] as any);
    const app = await createApp();

    const response = await request(app).post('/api/clubs').send({
      name: '机器人社',
      description: '机器人活动',
      grades: ['初三', '初一'],
      total_quota: 30,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      grade: '初一,初三',
      grades: ['初一', '初三'],
    });
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO clubs'),
      ['机器人社', '机器人活动', '初一,初三', 30, 30, null, null]
    );
  });

  it('rejects conflicting grade and grades request fields', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const app = await createApp();

    const response = await request(app).post('/api/clubs').send({
      name: '机器人社',
      grade: '初一',
      grades: ['初二'],
      total_quota: 30,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('年级');
    expect(mysqlClient.query).not.toHaveBeenCalled();
  });

  it('imports multiple grades from Chinese delimiters', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ insertId: 7, affectedRows: 1 } as any);
    const app = await createApp();
    const file = Buffer.from(
      '社团名称,社团描述,年级,最大报名人数,社团负责人,负责人联系方式\n机器人社,机器人活动,初一、初二,30,李老师,13800000000',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/clubs/import')
      .attach('file', file, 'clubs.csv');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ createdCount: 1, updatedCount: 0, skipCount: 0 });
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO clubs'),
      ['机器人社', '机器人活动', '初一,初二', 30, 30, '李老师', '13800000000']
    );
  });

  it('accepts the readable import column name for multiple grades', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ insertId: 8, affectedRows: 1 } as any);
    const app = await createApp();
    const file = Buffer.from(
      '社团名称,社团描述,可报名年级,最大报名人数\n机器人社,机器人活动,初一、初二,30',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/clubs/import')
      .attach('file', file, 'clubs.csv');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ createdCount: 1, skipCount: 0 });
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO clubs'),
      ['机器人社', '机器人活动', '初一,初二', 30, 30, null, null]
    );
  });

  it('rejects conflicting grade aliases in an imported row', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValueOnce([] as any);
    const app = await createApp();
    const file = Buffer.from(
      '社团名称,年级,可报名年级,最大报名人数\n机器人社,初一,初二,30',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/clubs/import')
      .attach('file', file, 'clubs.csv');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ createdCount: 0, updatedCount: 0, skipCount: 1 });
    expect(response.body.data.errors[0]).toContain('年级');
    expect(mysqlClient.query).not.toHaveBeenCalled();
  });

  it('clears the club cache when an import fails after an earlier row was written', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const databaseError = new Error('database unavailable');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([{ id: 1, name: '旧社团' }] as any) // GET 写入缓存
      .mockResolvedValueOnce([] as any) // 第一行查重
      .mockResolvedValueOnce({ insertId: 8 } as any) // 第一行 INSERT
      .mockRejectedValueOnce(databaseError) // 第二行查重失败
      .mockResolvedValueOnce([{ id: 8, name: '新社团', grade: '初一' }] as any); // 清缓存后的 GET
    const app = await createApp();

    await request(app).get('/api/clubs');
    const importResponse = await request(app)
      .post('/api/clubs/import')
      .attach(
        'file',
        Buffer.from('社团名称,年级,最大报名人数\n新社团,初一,30\n另一个社团,初二,30', 'utf-8'),
        'clubs.csv'
      );

    expect(importResponse.status).toBe(500);
    const clubsResponse = await request(app).get('/api/clubs');

    expect(clubsResponse.body).toEqual([{ id: 8, name: '新社团', grade: '初一', grades: ['初一'] }]);
    expect(mysqlClient.query).toHaveBeenCalledTimes(5);
  });

  it('returns a grades array for legacy single-grade rows', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ insertId: 8 } as any)
      .mockResolvedValueOnce([{
        id: 8,
        name: '编程社',
        grade: '初二',
      }] as any)
      .mockResolvedValueOnce([{
        id: 8,
        name: '编程社',
        grade: '初二',
      }] as any);
    const app = await createApp();

    await request(app).post('/api/clubs').send({
      name: '编程社',
      grade: '初二',
      total_quota: 30,
    });

    const response = await request(app).get('/api/clubs');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({ grade: '初二', grades: ['初二'] });
  });
});
