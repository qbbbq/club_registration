import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestAbortContext } from '../http/request-context';

vi.mock('../services/studentRegistrationService', () => {
  class StudentRegistrationNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(message = '学生不存在') {
      super(message);
      this.name = 'StudentRegistrationNotFoundError';
    }
  }

  class StudentRegistrationValidationError extends Error {
    readonly statusCode = 400;

    constructor(message: string) {
      super(message);
      this.name = 'StudentRegistrationValidationError';
    }
  }

  return {
    StudentRegistrationService: {
      lookup: vi.fn(),
      update: vi.fn(),
    },
    StudentRegistrationNotFoundError,
    StudentRegistrationValidationError,
  };
});

describe('student registration admin route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function createApp() {
    const { default: router } = await import('./student-registration');
    const app = express();
    app.use(createRequestAbortContext());
    app.use(express.json());
    app.use('/api/admin/student-registration', router);
    return app;
  }

  it('looks up a student and current registration by id card', async () => {
    const serviceModule = await import('../services/studentRegistrationService');
    const data = {
      student: {
        id: 12,
        name: '张三',
        idCard: '123456789012345678',
        grade: '初一',
        className: '初一(1)班',
      },
      registration: {
        id: 88,
        clubId: 1,
        clubName: '编程社',
        time: '2026-09-05T09:00:00.000Z',
      },
    };
    vi.mocked(serviceModule.StudentRegistrationService.lookup).mockResolvedValue(data as any);
    const app = await createApp();

    const response = await request(app)
      .post('/api/admin/student-registration/lookup')
      .send({ idCard: '123456789012345678' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data });
    expect(serviceModule.StudentRegistrationService.lookup).toHaveBeenCalledWith(
      '123456789012345678',
      expect.any(AbortSignal)
    );
  });

  it('returns 400 for an invalid lookup id card without calling the service', async () => {
    const serviceModule = await import('../services/studentRegistrationService');
    const app = await createApp();

    const response = await request(app)
      .post('/api/admin/student-registration/lookup')
      .send({ idCard: '12345' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: '身份证号格式不正确' });
    expect(serviceModule.StudentRegistrationService.lookup).not.toHaveBeenCalled();
  });

  it('returns 404 when the student does not exist', async () => {
    const serviceModule = await import('../services/studentRegistrationService');
    vi.mocked(serviceModule.StudentRegistrationService.lookup).mockRejectedValue(
      new serviceModule.StudentRegistrationNotFoundError()
    );
    const app = await createApp();

    const response = await request(app)
      .post('/api/admin/student-registration/lookup')
      .send({ idCard: '123456789012345678' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, message: '学生不存在' });
  });

  it('updates the complete student registration payload', async () => {
    const serviceModule = await import('../services/studentRegistrationService');
    vi.mocked(serviceModule.StudentRegistrationService.update).mockResolvedValue({
      student: {
        id: 12,
        name: '李四',
        idCard: '123456789012345679',
        grade: '初二',
        className: '初二(1)班',
      },
      registration: null,
    });
    const app = await createApp();

    const response = await request(app)
      .put('/api/admin/student-registration/12')
      .send({
        idCard: '123456789012345679',
        name: '李四',
        grade: '初二',
        className: '初二(1)班',
        clubId: 2,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(serviceModule.StudentRegistrationService.update).toHaveBeenCalledWith({
      studentId: 12,
      idCard: '123456789012345679',
      name: '李四',
      grade: '初二',
      className: '初二(1)班',
      clubId: 2,
    }, expect.any(AbortSignal));
  });

  it('normalizes an empty club id to null for a student without registration', async () => {
    const serviceModule = await import('../services/studentRegistrationService');
    vi.mocked(serviceModule.StudentRegistrationService.update).mockResolvedValue({
      student: {
        id: 12,
        name: '张三',
        idCard: '123456789012345678',
        grade: '初一',
        className: '初一(1)班',
      },
      registration: null,
    });
    const app = await createApp();

    const response = await request(app)
      .put('/api/admin/student-registration/12')
      .send({
        idCard: '123456789012345678',
        name: '张三',
        grade: '初一',
        className: '初一(1)班',
        clubId: '',
      });

    expect(response.status).toBe(200);
    expect(serviceModule.StudentRegistrationService.update).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: null }),
      expect.any(AbortSignal)
    );
  });

  it('returns 400 for service validation errors', async () => {
    const serviceModule = await import('../services/studentRegistrationService');
    vi.mocked(serviceModule.StudentRegistrationService.update).mockRejectedValue(
      new serviceModule.StudentRegistrationValidationError('该社团名额已满')
    );
    const app = await createApp();

    const response = await request(app)
      .put('/api/admin/student-registration/12')
      .send({
        idCard: '123456789012345678',
        name: '张三',
        grade: '初一',
        className: '初一(1)班',
        clubId: 2,
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: '该社团名额已满' });
  });
});
