import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('./2026-11-09-add-test-table.sql', import.meta.url);

describe('test table migration', () => {
  it('adds a migration that creates the test table', () => {
    expect(existsSync(migrationUrl)).toBe(true);

    const migration = readFileSync(migrationUrl, 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS test_table');
    expect(migration).toContain('test_content');
  });

  it('includes the test table in a fresh database schema', () => {
    const initSql = readFileSync(new URL('../init.sql', import.meta.url), 'utf8');
    expect(initSql).toContain('CREATE TABLE IF NOT EXISTS test_table');
    expect(initSql).toContain('test_content');
  });
});
