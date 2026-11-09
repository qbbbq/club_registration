import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestAbortContext } from '../http/request-context';

vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
}));

vi.mock('../services/registrationService', () => ({
  RegistrationService: {
    register: vi.fn(),
  },
}));

describe('register route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function createApp() {
    const { default: registerRouter } = await import('./register');
    const app = express();
    app.use(createRequestAbortContext());
    app.use(express.json());
    app.use('/api/register', registerRouter);
    return app;
  }

  it('uses verified student class name and grade from MySQL before registering', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const service = await import('../services/registrationService');
    vi.mocked(mysqlClient.query).mockResolvedValue([{ class_name: '初一(1)班', grade: '初一' }] as any);
    vi.mocked(service.RegistrationService.register).mockResolvedValue({
      success: true,
      message: '报名成功',
      data: {
        id: 12,
        name: '张三',
        className: '初一(1)班',
        clubId: 1,
        clubName: '篮球社',
        time: '2026-07-31T12:00:00.000Z',
      },
    });
    const app = await createApp();

    const response = await request(app).post('/api/register').send({
      name: '张三',
      idCard: '123456789012345678',
      className: '用户填写班级',
      clubId: '1',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: '报名成功',
      data: {
        id: 12,
        name: '张三',
        className: '初一(1)班',
        clubId: 1,
        clubName: '篮球社',
        time: '2026-07-31T12:00:00.000Z',
      },
    });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1',
      ['123456789012345678', '张三'],
      expect.any(AbortSignal)
    );
    expect(service.RegistrationService.register).toHaveBeenCalledWith({
      name: '张三',
      idCard: '123456789012345678',
      className: '初一(1)班',
      studentGrade: '初一',
      clubId: 1,
    }, expect.any(AbortSignal));
  });

  it('rejects registration when student does not exist', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([] as any);
    const app = await createApp();

    const response = await request(app).post('/api/register').send({
      name: '张三',
      idCard: '123456789012345678',
      className: '高一(1)班',
      clubId: '1',
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('学生信息不存在');
  });
});
