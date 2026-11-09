import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
}));

describe('students route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function createApp() {
    const { default: studentsRouter } = await import('./students');
    const app = express();
    app.use(express.json());
    app.use('/api/students', studentsRouter);
    return app;
  }

  it('returns all students instead of truncating the list at 1000 rows', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const students = Array.from({ length: 1256 }, (_, index) => ({
      id: index + 1,
      name: `学生${index + 1}`,
      id_card: `900000200000${String(index + 1).padStart(6, '0')}`,
      class_name: '高一(1)班',
      created_at: new Date('2026-08-20T06:35:43.000Z'),
    }));
    vi.mocked(mysqlClient.query).mockResolvedValue(students as any);
    const app = await createApp();

    const response = await request(app).get('/api/students');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1256);
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT * FROM students ORDER BY created_at DESC'
    );
  });

  it('verifies a student from MySQL by id card and name', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([{ class_name: '初一(1)班', grade: '初一' }] as any);
    const app = await createApp();

    const response = await request(app).post('/api/students/verify').send({
      idCard: '123456789012345678',
      name: '张三',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      valid: true,
      message: '验证通过',
      className: '初一(1)班',
      grade: '初一',
    });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT class_name, grade FROM students WHERE id_card = ? AND name = ? LIMIT 1',
      ['123456789012345678', '张三']
    );
  });

  it('imports a new student text file into MySQL', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ affectedRows: 1 } as any);
    const app = await createApp();
    const file = Buffer.from('姓名\t身份证号\t年级\t班级\n张三\t123456789012345678\t初一\t初一(1)班', 'utf-8');

    const response = await request(app)
      .post('/api/students/import')
      .attach('file', file, 'students.txt');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.successCount).toBe(1);
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO students (id_card, name, grade, class_name) VALUES (?, ?, ?, ?)',
      ['123456789012345678', '张三', '初一', '初一(1)班']
    );
  });

  it('skips a student row with an invalid grade', async () => {
    const app = await createApp();
    const file = Buffer.from(
      '姓名\t身份证号\t年级\t班级\n张三\t123456789012345678\t高一\t初一(1)班',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/students/import')
      .attach('file', file, 'students.txt');

    expect(response.status).toBe(200);
    expect(response.body.data.successCount).toBe(0);
    expect(response.body.data.skipCount).toBe(1);
    expect(response.body.data.errors[0]).toContain('年级');
  });

  it('stores a canonical uppercase trailing X for student id cards', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce({ affectedRows: 1 } as any);
    const app = await createApp();
    const file = Buffer.from(
      '姓名\t身份证号\t年级\t班级\n张三\t12345678901234567x\t初一\t初一(1)班',
      'utf-8'
    );

    const response = await request(app)
      .post('/api/students/import')
      .attach('file', file, 'students.txt');

    expect(response.status).toBe(200);
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      1,
      'SELECT id FROM students WHERE id_card = ? LIMIT 1',
      ['12345678901234567X']
    );
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      'INSERT INTO students (id_card, name, grade, class_name) VALUES (?, ?, ?, ?)',
      ['12345678901234567X', '张三', '初一', '初一(1)班']
    );
  });

  it('looks up a student by id card returning name and class name', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([
      { name: '张三', class_name: '初一(1)班', grade: '初一' },
    ] as any);
    const app = await createApp();

    const response = await request(app).post('/api/students/lookup').send({
      idCard: '123456789012345678',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { name: '张三', className: '初一(1)班', grade: '初一' },
    });
    expect(mysqlClient.query).toHaveBeenCalledWith(
      'SELECT name, class_name, grade FROM students WHERE id_card = ? LIMIT 1',
      ['123456789012345678']
    );
  });

  it('lookup returns null data when student does not exist', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query).mockResolvedValue([] as any);
    const app = await createApp();

    const response = await request(app).post('/api/students/lookup').send({
      idCard: '123456789012345678',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: null,
      message: '学生信息不存在，请联系管理员导入',
    });
  });

  it('lookup rejects invalid id card format', async () => {
    const app = await createApp();

    const response = await request(app).post('/api/students/lookup').send({
      idCard: '12345',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: '身份证号格式不正确' });
  });
});
