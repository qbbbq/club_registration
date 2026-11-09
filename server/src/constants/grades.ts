export const GRADES = ['初一', '初二', '初三'] as const;

export type Grade = (typeof GRADES)[number];

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}

export class GradeSelectionError extends Error {
  constructor(message = '可报名年级必须至少选择一个，且只能选择初一、初二或初三') {
    super(message);
    this.name = 'GradeSelectionError';
  }
}

function splitGradeValue(value: string): string[] {
  const parts = value.split(/[,，、]/).map((item) => item.trim());
  if (parts.some((item) => !item)) {
    throw new GradeSelectionError();
  }
  return parts;
}

function sortGrades(grades: Iterable<Grade>): Grade[] {
  const selected = new Set(grades);
  return GRADES.filter((grade) => selected.has(grade));
}

export function parseGradeSelection(value: unknown): Grade[] {
  let values: unknown[];

  if (typeof value === 'string') {
    values = splitGradeValue(value);
  } else if (Array.isArray(value)) {
    values = value.map((item) => typeof item === 'string' ? item.trim() : item);
    if (values.some((item) => typeof item === 'string' && /[,，、]/.test(item))) {
      throw new GradeSelectionError();
    }
  } else {
    values = [];
  }

  if (values.length === 0) {
    throw new GradeSelectionError();
  }

  if (values.some((valueItem) => !isGrade(valueItem))) {
    throw new GradeSelectionError();
  }

  const grades = values as Grade[];
  if (new Set(grades).size !== grades.length) {
    throw new GradeSelectionError('可报名年级不能重复');
  }

  return sortGrades(grades);
}

export function parseStoredGrades(value: string | null): Grade[] {
  if (typeof value !== 'string') return [];

  try {
    return parseGradeSelection(value);
  } catch {
    return [];
  }
}

export function serializeGrades(grades: readonly Grade[]): string {
  return parseGradeSelection([...grades]).join(',');
}

export function clubAllowsGrade(
  clubGrade: string | null,
  studentGrade: string | null
): boolean {
  return isGrade(studentGrade) && parseStoredGrades(clubGrade).includes(studentGrade);
}
