import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./2026-09-06-allow-multiple-club-grades.sql', import.meta.url),
  'utf8'
);

describe('multiple club grades migration', () => {
  it('widens the existing club grade column without dropping data', () => {
    expect(migration).toContain('ALTER TABLE clubs MODIFY COLUMN grade VARCHAR(20) NULL');
    expect(migration).not.toContain('DROP TABLE');
  });
});
