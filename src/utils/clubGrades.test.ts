import { describe, expect, it } from 'vitest';
import { clubIncludesGrade, parseClubGrades } from './clubGrades';

describe('club grade helpers', () => {
  it('prefers response grades and falls back to legacy grade', () => {
    expect(parseClubGrades(['初一', '初二'], '初三')).toEqual(['初一', '初二']);
    expect(parseClubGrades(undefined, '初三,初一')).toEqual(['初一', '初三']);
    expect(clubIncludesGrade({ grades: ['初一', '初二'] }, '初二')).toBe(true);
    expect(clubIncludesGrade({ grade: null }, '初一')).toBe(false);
  });

  it('ignores invalid values and normalizes supported delimiters', () => {
    expect(parseClubGrades('初三、初一，高一')).toEqual(['初一', '初三']);
  });
});
