import { describe, expect, it } from 'vitest';
import { parseStoredGrades } from '../../constants/grades';
import { DEFAULT_CLUBS } from './default-clubs';

describe('default club seeds', () => {
  it('give every new default club at least one available grade', () => {
    expect(DEFAULT_CLUBS.length).toBeGreaterThan(0);
    expect(DEFAULT_CLUBS.every((club) => parseStoredGrades(club.grade).length > 0)).toBe(true);
    expect(DEFAULT_CLUBS.some((club) => club.grade.includes(','))).toBe(true);
  });
});
