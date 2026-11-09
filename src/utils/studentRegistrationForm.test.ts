import { describe, expect, it } from 'vitest';
import {
  filterStudentRegistrationClubs,
  hasStudentRegistrationFormChanges,
  isStudentRegistrationClubDisabled,
  resetUnregisteredClubForGrade,
  shouldPreserveStudentRegistrationResult,
  studentRegistrationFormFromRecord,
  studentRegistrationSaveWasRefreshedSuccessfully,
} from './studentRegistrationForm';

const clubs = [
  { id: 1, grade: '初一', grades: ['初一'], remaining_quota: 0 },
  { id: 2, grade: '初一,初二', grades: ['初一', '初二'], remaining_quota: 2 },
  { id: 3, grade: '初二', grades: ['初二'], remaining_quota: 2 },
  { id: 4, grade: null, grades: [], remaining_quota: 0 },
];

describe('student registration form club selection', () => {
  it('keeps the current legacy club visible while showing same-grade clubs', () => {
    expect(filterStudentRegistrationClubs(clubs, '初一', { clubId: 4 }).map((club) => club.id))
      .toEqual([1, 2, 4]);
  });

  it('disables mismatched or full target clubs but keeps the current club selectable', () => {
    expect(isStudentRegistrationClubDisabled(clubs[0], '初一', null)).toBe(true);
    expect(isStudentRegistrationClubDisabled(clubs[2], '初一', null)).toBe(true);
    expect(isStudentRegistrationClubDisabled(clubs[0], '初一', { clubId: 1 })).toBe(false);
    expect(isStudentRegistrationClubDisabled(clubs[4 - 1], '初一', { clubId: 4 })).toBe(false);
  });

  it('clears an unregistered club when its grade changes but preserves a registered choice', () => {
    expect(resetUnregisteredClubForGrade(1, '初二', clubs, null)).toBeNull();
    expect(resetUnregisteredClubForGrade(2, '初二', clubs, { clubId: 2 })).toBe(2);
  });

  it('detects unsaved edits before a repeated lookup can replace the form', () => {
    const record = {
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 2,
    };

    expect(hasStudentRegistrationFormChanges(record, { ...record })).toBe(false);
    expect(hasStudentRegistrationFormChanges(record, { ...record, name: '张三 updated' })).toBe(true);
    expect(shouldPreserveStudentRegistrationResult(record, { ...record, name: '张三 updated' })).toBe(true);
    expect(shouldPreserveStudentRegistrationResult(record, { ...record })).toBe(false);
  });

  it('only reports a fully refreshed save as refreshed successfully', () => {
    expect(studentRegistrationSaveWasRefreshedSuccessfully([true, true, true], true)).toBe(true);
    expect(studentRegistrationSaveWasRefreshedSuccessfully([true, false, true], true)).toBe(false);
    expect(studentRegistrationSaveWasRefreshedSuccessfully([true, true, true], false)).toBe(false);
  });

  it('creates a clean form baseline from a saved student registration view', () => {
    expect(studentRegistrationFormFromRecord({
      student: {
        idCard: '123456789012345678',
        name: '张三',
        grade: '初一',
        className: '初一(1)班',
      },
      registration: { clubId: 2 },
    })).toEqual({
      idCard: '123456789012345678',
      name: '张三',
      grade: '初一',
      className: '初一(1)班',
      clubId: 2,
    });
  });
});
