import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adminSource = readFileSync(new URL('./Admin.vue', import.meta.url), 'utf8');

describe('admin system settings', () => {
  it('renames the tab to system settings and exposes a 30-character registration title field', () => {
    expect(adminSource).toContain('label="系统设置"');
    expect(adminSource).toContain('v-model="registrationTitleDraft"');
    expect(adminSource).toContain('maxlength="30"');
    expect(adminSource).toContain('handleSaveRegistrationTitle');
  });

  it('labels the registration title card as 报名入口标题栏', () => {
    expect(adminSource).toContain('<span>报名入口标题栏</span>');
  });
});
