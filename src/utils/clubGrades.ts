const GRADE_OPTIONS = ['初一', '初二', '初三'] as const;

function splitGradeValue(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseClubGrades(grades: unknown, legacyGrade?: unknown): string[] {
  const source = grades === undefined ? legacyGrade : grades;
  const values = Array.isArray(source)
    ? source.flatMap((value) => typeof value === 'string' ? splitGradeValue(value) : [])
    : typeof source === 'string'
      ? splitGradeValue(source)
      : [];
  const selected = new Set(values);

  return GRADE_OPTIONS.filter((grade) => selected.has(grade));
}

export function clubIncludesGrade(
  club: { grades?: unknown; grade?: unknown },
  studentGrade: string | null
): boolean {
  return typeof studentGrade === 'string' &&
    parseClubGrades(club.grades, club.grade).includes(studentGrade);
}
