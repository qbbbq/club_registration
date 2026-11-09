import { clubIncludesGrade, parseClubGrades } from './clubGrades';

export interface StudentRegistrationClubOption {
  id: number;
  grade?: string | null;
  grades?: string[];
  remaining_quota: number;
}

export interface CurrentStudentRegistration {
  clubId: number;
}

export interface StudentRegistrationFormValues {
  idCard: string;
  name: string;
  grade: string;
  className: string;
  clubId: number | null;
}

interface StudentRegistrationRecordLike {
  student: {
    idCard: string;
    name: string;
    grade: string | null;
    className: string;
  };
  registration: {
    clubId: number;
  } | null;
}

export function filterStudentRegistrationClubs<T extends StudentRegistrationClubOption>(
  clubs: T[],
  grade: string,
  currentRegistration: CurrentStudentRegistration | null
): T[] {
  if (!grade) return [];

  const currentClubId = currentRegistration?.clubId;
  return clubs.filter((club) => clubIncludesGrade(club, grade) || club.id === currentClubId);
}

export function isStudentRegistrationClubDisabled(
  club: StudentRegistrationClubOption,
  grade: string,
  currentRegistration: CurrentStudentRegistration | null
): boolean {
  const isCurrent = club.id === currentRegistration?.clubId;
  const keepsLegacyClub = isCurrent && parseClubGrades(club.grades, club.grade).length === 0;

  return (
    (!clubIncludesGrade(club, grade) && !keepsLegacyClub) ||
    (club.remaining_quota <= 0 && !isCurrent)
  );
}

export function resetUnregisteredClubForGrade(
  clubId: number | null,
  grade: string,
  clubs: StudentRegistrationClubOption[],
  currentRegistration: CurrentStudentRegistration | null
): number | null {
  if (currentRegistration || clubId === null) return clubId;

  const selectedClub = clubs.find((club) => club.id === clubId);
  return selectedClub && !clubIncludesGrade(selectedClub, grade) ? null : clubId;
}

export function hasStudentRegistrationFormChanges(
  record: StudentRegistrationFormValues,
  form: StudentRegistrationFormValues
): boolean {
  return (
    record.idCard !== form.idCard ||
    record.name !== form.name ||
    record.grade !== form.grade ||
    record.className !== form.className ||
    record.clubId !== form.clubId
  );
}

export function shouldPreserveStudentRegistrationResult(
  record: StudentRegistrationFormValues,
  form: StudentRegistrationFormValues
): boolean {
  return hasStudentRegistrationFormChanges(record, form);
}

export function studentRegistrationSaveWasRefreshedSuccessfully(
  listRefreshResults: boolean[],
  lookupSucceeded: boolean
): boolean {
  return lookupSucceeded && listRefreshResults.every(Boolean);
}

export function studentRegistrationFormFromRecord(
  record: StudentRegistrationRecordLike
): StudentRegistrationFormValues {
  return {
    idCard: record.student.idCard,
    name: record.student.name,
    grade: record.student.grade || '',
    className: record.student.className,
    clubId: record.registration?.clubId ?? null,
  };
}
