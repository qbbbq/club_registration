import { describe, expect, it } from 'vitest';
import {
  GradeSelectionError,
  clubAllowsGrade,
  parseGradeSelection,
  parseStoredGrades,
  serializeGrades,
} from './grades';

describe('grade selection utilities', () => {
  it('parses a single legacy grade', () => {
    expect(parseGradeSelection('初一')).toEqual(['初一']);
  });

  it('parses delimited grades and returns the fixed option order', () => {
    expect(parseGradeSelection('初三、初一，初二')).toEqual(['初一', '初二', '初三']);
  });

  it('rejects empty, invalid, and duplicate selections', () => {
    expect(() => parseGradeSelection('')).toThrow(GradeSelectionError);
    expect(() => parseGradeSelection('初一,,初二')).toThrow(GradeSelectionError);
    expect(() => parseGradeSelection(['初一', '高一'])).toThrow(GradeSelectionError);
    expect(() => parseGradeSelection(['初一', '初一'])).toThrow(GradeSelectionError);
    expect(() => parseGradeSelection(['初一,初二'])).toThrow(GradeSelectionError);
  });

  it('serializes grades canonically', () => {
    expect(serializeGrades(['初三', '初一'])).toBe('初一,初三');
    expect(parseStoredGrades(null)).toEqual([]);
    expect(parseStoredGrades('初一,初三')).toEqual(['初一', '初三']);
    expect(parseStoredGrades('初一,高一')).toEqual([]);
    expect(parseStoredGrades('')).toEqual([]);
  });

  it('matches a student grade against a legacy or multi-grade club', () => {
    expect(clubAllowsGrade('初一', '初一')).toBe(true);
    expect(clubAllowsGrade('初一,初二', '初二')).toBe(true);
    expect(clubAllowsGrade('初一,初二', '初三')).toBe(false);
    expect(clubAllowsGrade(null, '初一')).toBe(false);
  });
});
