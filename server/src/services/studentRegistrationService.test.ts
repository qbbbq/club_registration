import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashIdCard } from '../utils/id-card';

vi.mock('../storage/database/mysql-client', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../routes/clubs-cache', () => ({
  clearClubsCache: vi.fn(),
}));

describe('StudentRegistrationService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const student = {
    id: 12,
    name: '张三',
    id_card: '123456789012345678',
    grade: '初一',
    class_name: '初一(1)班',
  };

  const currentRegistration = {
    id: 88,
    name: '张三',
    id_card_hash: 'old-hash',
    class_name: '初一(1)班',
    club_id: 1,
    created_at: new Date('2026-09-05T09:00:00.000Z'),
  };

  const currentClub = {
    id: 1,
    name: '编程社',
    grade: '初一',
    total_quota: 30,
    remaining_quota: 0,
  };

  const targetClub = {
    id: 2,
    name: '篮球社',
    grade: '初一',
    total_quota: 30,
    remaining_quota: 3,
  };

  function mockTransaction(execute: ReturnType<typeof vi.fn>) {
    return import('../storage/database/mysql-client').then((mysqlClient) => {
      vi.mocked(mysqlClient.withTransaction).mockImplementation(async (callback) =>
        callback({ execute } as any)
      );
    });
  }

  it('looks up a student and current registration by id card', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([student] as any)
      .mockResolvedValueOnce([{
        id: 88,
        club_id: 1,
        club_name: '编程社',
        created_at: new Date('2026-09-05T09:00:00.000Z'),
      }] as any);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    const result = await StudentRegistrationService.lookup('123456789012345678');

    expect(result).toEqual({
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
        time: new Date('2026-09-05T09:00:00.000Z'),
      },
    });
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      1,
      'SELECT id, name, id_card, grade, class_name FROM students WHERE id_card = ? LIMIT 1',
      ['123456789012345678'],
      undefined
    );
    expect(mysqlClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('id_card_hash = ?'),
      [expect.stringMatching(/^[a-f0-9]{64}$/)],
      undefined
    );
  });

  it('returns a null registration for a student without registration', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    vi.mocked(mysqlClient.query)
      .mockResolvedValueOnce([student] as any)
      .mockResolvedValueOnce([] as any);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    const result = await StudentRegistrationService.lookup('123456789012345678');

    expect(result.registration).toBeNull();
  });

  it('updates student details and registration details without changing quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ ...student, grade: null }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[currentClub]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    const result = await StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三 updated',
      grade: '初一',
      className: '初一(2)班',
      clubId: 1,
    });

    expect(result.student).toMatchObject({
      id: 12,
      name: '张三 updated',
      idCard: '123456789012345678',
      grade: '初一',
      className: '初一(2)班',
    });
    expect(result.registration).toMatchObject({
      id: 88,
      clubId: 1,
      clubName: '编程社',
      time: currentRegistration.created_at,
    });
    expect(execute).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('UPDATE students'),
      ['张三 updated', '123456789012345678', '初一', '初一(2)班', 12]
    );
    expect(execute).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('UPDATE registrations'),
      ['张三 updated', expect.stringMatching(/^[a-f0-9]{64}$/), '初一(2)班', 88]
    );
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('SET remaining_quota'))).toBe(false);
    const clubsCache = await import('../routes/clubs-cache');
    expect(clubsCache.clearClubsCache).not.toHaveBeenCalled();
  });

  it('switches clubs, preserves registration identity, and adjusts both quotas', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[currentClub, targetClub]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    const result = await StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 2,
    });

    expect(result.registration).toMatchObject({
      id: 88,
      clubId: 2,
      clubName: '篮球社',
      time: currentRegistration.created_at,
    });
    expect(execute).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('remaining_quota = remaining_quota + 1'),
      [1]
    );
    expect(execute).toHaveBeenNthCalledWith(
      7,
      expect.stringContaining('remaining_quota = remaining_quota - 1'),
      [2]
    );
    expect(execute).toHaveBeenNthCalledWith(
      8,
      expect.stringContaining('UPDATE registrations'),
      ['张三', expect.stringMatching(/^[a-f0-9]{64}$/), '初一(1)班', 2, 88]
    );
    const clubsCache = await import('../routes/clubs-cache');
    expect(clubsCache.clearClubsCache).toHaveBeenCalledOnce();
  });

  it('allows switching to a club that includes the edited student grade', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ ...student, grade: '初二' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[
        currentClub,
        { ...targetClub, grade: '初一,初二' },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    const result = await StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初二',
      className: '初二(1)班',
      clubId: 2,
    });

    expect(result.registration).toMatchObject({
      id: 88,
      clubId: 2,
      clubName: '篮球社',
      time: currentRegistration.created_at,
    });
  });

  it('creates a registration for a student without one', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[targetClub]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 101 }])
      .mockResolvedValueOnce([[{ created_at: new Date('2026-09-05T10:00:00.000Z') }]]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    const result = await StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 2,
    });

    expect(result.registration).toEqual({
      id: 101,
      clubId: 2,
      clubName: '篮球社',
      time: new Date('2026-09-05T10:00:00.000Z'),
    });
    expect(execute).toHaveBeenNthCalledWith(
      7,
      expect.stringContaining('INSERT INTO registrations'),
      ['张三', expect.stringMatching(/^[a-f0-9]{64}$/), '初一(1)班', 2]
    );
    const clubsCache = await import('../routes/clubs-cache');
    expect(clubsCache.clearClubsCache).toHaveBeenCalledOnce();
  });

  it('updates only student details when an unregistered student has no target club', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    const result = await StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(2)班',
      clubId: null,
    });

    expect(result.registration).toBeNull();
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('updates a registration hash when the id card changes', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentClub]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345679',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 1,
    });

    expect(execute).toHaveBeenNthCalledWith(
      7,
      expect.stringContaining('UPDATE registrations'),
      ['张三', hashIdCard('123456789012345679'), '初一(1)班', 88]
    );
    expect(execute.mock.calls[3][0]).not.toContain('FOR UPDATE');
  });

  it('rejects an invalid grade before opening a transaction', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const { StudentRegistrationService, StudentRegistrationValidationError } =
      await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '高一',
      className: '初一(1)班',
      clubId: 1,
    })).rejects.toMatchObject({
      name: 'StudentRegistrationValidationError',
      statusCode: 400,
    });
    expect(mysqlClient.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate new id card before updating the student', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[{ id: 99 }]]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345679',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 1,
    })).rejects.toThrow('身份证号已被其他学生使用');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).not.toContain('FOR UPDATE');
    const clubsCache = await import('../routes/clubs-cache');
    expect(clubsCache.clearClubsCache).not.toHaveBeenCalled();
  });

  it('rejects switching to a club for another grade', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[
        currentClub,
        { ...targetClub, grade: '初二' },
      ]]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 2,
    })).rejects.toThrow('该社团不面向学生所在年级');
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('rejects switching to a full club without returning the old quota', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[currentClub, { ...targetClub, remaining_quota: 0 }]]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 2,
    })).rejects.toThrow('该社团名额已满');
    expect(execute).toHaveBeenCalledTimes(4);
    const clubsCache = await import('../routes/clubs-cache');
    expect(clubsCache.clearClubsCache).not.toHaveBeenCalled();
  });

  it('rejects clearing an existing registration', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: null,
    })).rejects.toThrow('已有报名记录不能清空社团');
    expect(execute).toHaveBeenCalledTimes(3);
    expect(mysqlClient.withTransaction).toHaveBeenCalledOnce();
  });

  it('keeps a full current club when the club is unchanged', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[currentClub]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 1,
    })).resolves.toBeTruthy();
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('SET remaining_quota = remaining_quota - 1'))).toBe(false);
    expect(mysqlClient.withTransaction).toHaveBeenCalledOnce();
  });

  it('allows personal edits while keeping an ungraded current club', async () => {
    const mysqlClient = await import('../storage/database/mysql-client');
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[{ ...currentClub, grade: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三（已修改）',
      grade: '初二',
      className: '初一(2)班',
      clubId: 1,
    })).resolves.toMatchObject({
      registration: { id: 88, clubId: 1, clubName: '编程社' },
    });
  });

  it('propagates database errors so the transaction can roll back', async () => {
    const databaseError = new Error('database unavailable');
    const execute = vi.fn().mockRejectedValueOnce(databaseError);
    await mockTransaction(execute);
    const { StudentRegistrationService } = await import('./studentRegistrationService');

    await expect(StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 1,
    })).rejects.toThrow('database unavailable');
    const clubsCache = await import('../routes/clubs-cache');
    expect(clubsCache.clearClubsCache).not.toHaveBeenCalled();
  });

  it('maps a registration unique-key race to a validation error', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[student]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentRegistration]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[currentClub]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' });
    await mockTransaction(execute);
    const { StudentRegistrationService, StudentRegistrationValidationError } =
      await import('./studentRegistrationService');

    const error = await StudentRegistrationService.update({
      studentId: 12,
      idCard: '123456789012345679',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 1,
    }).catch((caughtError) => caughtError);
    expect(error).toBeInstanceOf(StudentRegistrationValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('身份证号已被其他学生或报名记录使用');
  });
});
