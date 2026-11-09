import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adminSource = readFileSync(new URL('./Admin.vue', import.meta.url), 'utf8');
const mobileStyles = adminSource.slice(adminSource.indexOf('@media (max-width: 768px)'));

describe('admin responsive layout', () => {
  it('stacks management card controls and wraps their buttons on narrow screens', () => {
    expect(mobileStyles).toMatch(/\.card-header\s*\{[\s\S]*?flex-direction:\s*column/);
    expect(mobileStyles).toMatch(/\.header-buttons\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });

  it('uses multi-select controls for club grade configuration', () => {
    expect(adminSource).toMatch(/v-model="editForm\.grades"[\s\S]*?multiple/);
    expect(adminSource).toMatch(/v-model="addForm\.grades"[\s\S]*?multiple/);
    expect(adminSource).toContain('collapse-tags');
  });

  it('keeps scrollable table bodies aligned with their headers', () => {
    expect(adminSource).toMatch(
      /\.el-table__body-wrapper[\s\S]*?\.el-scrollbar__wrap[\s\S]*?\{[\s\S]*?text-align:\s*left/
    );
  });

  it('renames the tab to system settings and exposes a 30-character registration title field', () => {
    expect(adminSource).toContain('label="系统设置"');
    expect(adminSource).toContain('v-model="registrationTitleDraft"');
    expect(adminSource).toContain('maxlength="30"');
    expect(adminSource).toContain('handleSaveRegistrationTitle');
  });
});
