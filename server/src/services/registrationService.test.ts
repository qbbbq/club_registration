import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../routes/clubs-cache', () => ({
  clearClubsCache: vi.fn(),
}));

describe('RegistrationService MySQL behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('locks the student and registration before mutating club quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '初一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{
        id: 1,
        name: '编程社',
        grade: '初一',
        total_quota: 50,
        remaining_quota: 2,
      }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 10 }])
      .mockResolvedValueOnce([[{ created_at: new Date('2026-07-31T12:00:00.000Z') }]]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 1,
        name: '编程社',
        grade: '初一',
        total_quota: 50,
        remaining_quota: 2,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));
    const { RegistrationService } = await import('./registrationService');

    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '初一(1)班',
      studentGrade: '初一',
      clubId: 1,
    });

    expect(result.success).toBe(true);
    expect(execute.mock.calls[0][0]).toContain('FROM students');
    expect(execute.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(execute.mock.calls[1][0]).toContain('FROM registrations');
    expect(execute.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(execute.mock.calls[2][0]).toContain('FROM clubs');
    expect(execute.mock.calls[2][0]).toContain('FOR UPDATE');
    expect(execute.mock.calls[3][0]).toContain('remaining_quota = remaining_quota - 1');
  });

  it('registers after locking the club and atomically decrementing quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '高一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初一', total_quota: 50, remaining_quota: 2 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 10 }])
      .mockResolvedValueOnce([[{ created_at: new Date('2026-07-31T12:00:00.000Z') }]]);

    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
         id: 1,
         name: '编程社',
         grade: '初一',
         total_quota: 50,
        remaining_quota: 2,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const controller = new AbortController();
    const result = await RegistrationService.register({
       name: '张三',
       idCard: '123456789012345678',
       className: '高一(1)班',
       studentGrade: '初一',
       clubId: 1,
    }, controller.signal);

    expect(result).toEqual({
      success: true,
      message: '报名成功',
      data: {
        id: 10,
        name: '张三',
        className: '高一(1)班',
        clubId: 1,
        clubName: '编程社',
        time: '2026-07-31T12:00:00.000Z',
      },
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(withTransaction).toHaveBeenCalledWith(expect.any(Function), controller.signal);
    expect(execute).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('remaining_quota = remaining_quota - 1'),
      [1]
    );
    expect(execute.mock.calls[3][0]).toContain('remaining_quota > 0');
    const clubsCache = await import('../routes/clubs-cache');
    expect(clubsCache.clearClubsCache).toHaveBeenCalledOnce();
    expect(execute.mock.calls[3][0]).not.toContain('FOR UPDATE');
    expect(execute).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('INSERT INTO registrations'),
      ['张三', expect.stringMatching(/^[a-f0-9]{64}$/), '高一(1)班', 1]
    );
    expect(execute).toHaveBeenNthCalledWith(
      6,
      'SELECT created_at FROM registrations WHERE id = ?',
      [10]
    );
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it('returns full immediately when the non-locking club precheck finds no quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
         id: 1,
         name: '编程社',
         grade: '初一',
         total_quota: 50,
        remaining_quota: 0,
      }] as any);

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
       name: '张三',
       idCard: '123456789012345678',
       className: '高一(1)班',
       studentGrade: '初一',
       clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '该社团名额已满' });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('checks an unset club grade before reporting that the club is full', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '初一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: null, total_quota: 50, remaining_quota: 0 },
      ]]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 1,
        name: '编程社',
        grade: null,
        total_quota: 50,
        remaining_quota: 0,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '初一(1)班',
      studentGrade: '初一',
      clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '该社团暂未设置可报名年级' });
    expect(withTransaction).toHaveBeenCalledOnce();
  });

  it('returns full without inserting when the atomic quota update affects no rows', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '高一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初一', total_quota: 50, remaining_quota: 1 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
         id: 1,
         name: '编程社',
         grade: '初一',
         total_quota: 50,
        remaining_quota: 1,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
       name: '张三',
       idCard: '123456789012345678',
       className: '高一(1)班',
       studentGrade: '初一',
       clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '该社团名额已满' });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls[3][0]).toContain('remaining_quota > 0');
    expect(execute.mock.calls[3][0]).not.toContain('FOR UPDATE');
  });

  it('returns duplicate registration message after the transaction rolls back the quota decrement', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '高一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初一', total_quota: 50, remaining_quota: 2 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' });
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
         id: 1,
         name: '编程社',
         grade: '初一',
         total_quota: 50,
        remaining_quota: 2,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
       name: '张三',
       idCard: '123456789012345678',
       className: '高一(1)班',
       studentGrade: '初一',
       clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '该身份证号已报名过社团' });
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('returns club not found before opening a transaction', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any);

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '高一(1)班',
      studentGrade: '初一',
      clubId: 999,
    });

    expect(result).toEqual({ success: false, message: '社团不存在' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('rejects registration before the configured open time without opening a transaction', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    query.mockResolvedValueOnce([{ value: '2099-01-01T08:00:00+08:00' }] as any);

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '高一(1)班',
      studentGrade: '初一',
      clubId: 1,
    });

    expect(result).toEqual({
      success: false,
      message: '报名尚未开始，开放时间：2099年01月01日 08:00',
    });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });

  it('allows registration when the open time has passed', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '高一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初一', total_quota: 50, remaining_quota: 2 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 10 }])
      .mockResolvedValueOnce([[{ created_at: new Date('2026-07-31T12:00:00.000Z') }]]);
    query
      .mockResolvedValueOnce([{ value: '2020-01-01T08:00:00+08:00' }] as any)
      .mockResolvedValueOnce([{
         id: 1,
         name: '编程社',
         grade: '初一',
         total_quota: 50,
        remaining_quota: 2,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '高一(1)班',
      studentGrade: '初一',
      clubId: 1,
    });

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it('propagates unexpected database errors after quota work starts', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const databaseError = new Error('database unavailable');
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '高一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初一', total_quota: 50, remaining_quota: 2 },
      ]])
      .mockRejectedValueOnce(databaseError);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
         id: 1,
         name: '编程社',
         grade: '初一',
         total_quota: 50,
        remaining_quota: 2,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    await expect(RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '高一(1)班',
      studentGrade: '初一',
      clubId: 1,
    })).rejects.toThrow('database unavailable');
  });

  it('rejects registration when student and club grades do not match', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '初一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初二', total_quota: 30, remaining_quota: 30 },
      ]]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 1,
        name: '编程社',
        grade: '初二',
        total_quota: 30,
        remaining_quota: 30,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '初一(1)班',
      studentGrade: '初一',
      clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '该社团不面向您的年级' });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('allows a student when the club includes the student grade', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初二', class_name: '初二(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初一,初二', total_quota: 30, remaining_quota: 1 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 11 }])
      .mockResolvedValueOnce([[{ created_at: new Date('2026-07-31T12:00:00.000Z') }]]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 1,
        name: '编程社',
        grade: '初一,初二',
        total_quota: 30,
        remaining_quota: 1,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '初二(1)班',
      studentGrade: '初二',
      clubId: 1,
    });

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('INSERT INTO registrations'),
      ['张三', expect.stringMatching(/^[a-f0-9]{64}$/), '初二(1)班', 1]
    );
  });

  it('rejects a student outside the club grade set', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初三', class_name: '初三(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: '初一,初二', total_quota: 30, remaining_quota: 30 },
      ]]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 1,
        name: '编程社',
        grade: '初一,初二',
        total_quota: 30,
        remaining_quota: 30,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '初三(1)班',
      studentGrade: '初三',
      clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '该社团不面向您的年级' });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('rejects registration when student grade is missing', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: null, class_name: '初一(1)班' }]]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 1,
        name: '编程社',
        grade: '初一',
        total_quota: 30,
        remaining_quota: 30,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '初一(1)班',
      studentGrade: null,
      clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '学生年级未设置，请联系管理员' });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('rejects registration when club grade is missing', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const query = vi.mocked(mysqlClient.query);
    const withTransaction = vi.mocked(mysqlClient.withTransaction);
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 9, name: '张三', grade: '初一', class_name: '初一(1)班' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        { id: 1, name: '编程社', grade: null, total_quota: 30, remaining_quota: 30 },
      ]]);
    query
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{
        id: 1,
        name: '编程社',
        grade: null,
        total_quota: 30,
        remaining_quota: 30,
      }] as any);
    withTransaction.mockImplementation(async (callback) => callback({ execute } as any));

    const { RegistrationService } = await import('./registrationService');
    const result = await RegistrationService.register({
      name: '张三',
      idCard: '123456789012345678',
      className: '初一(1)班',
      studentGrade: '初一',
      clubId: 1,
    });

    expect(result).toEqual({ success: false, message: '该社团暂未设置可报名年级' });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
