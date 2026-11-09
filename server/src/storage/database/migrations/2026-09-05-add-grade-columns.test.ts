import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./2026-09-05-add-grade-columns.sql', import.meta.url),
  'utf8'
);

describe('grade and id card migration', () => {
  it('uses the same trimmed uppercase identity as the application', () => {
    expect(migration).toContain('SHA2(UPPER(TRIM(s.id_card)), 256)');
    expect(migration).toContain('SHA2(LOWER(TRIM(s.id_card)), 256)');
    expect(migration).toContain('SET id_card = UPPER(TRIM(id_card))');
    expect(migration).toContain('BINARY id_card <> BINARY UPPER(TRIM(id_card))');
  });

  it('checks canonical identity collisions before changing the schema', () => {
    expect(migration).toContain("SIGNAL SQLSTATE '45000'");
    expect(migration).toContain('GROUP BY UPPER(TRIM(id_card))');
    expect(migration).toContain('GROUP BY UPPER(TRIM(s.id_card))');
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).toContain('无法关联到学生');
    expect(migration.indexOf('SIGNAL SQLSTATE')).toBeLessThan(
      migration.indexOf('ALTER TABLE clubs')
    );
  });
});
