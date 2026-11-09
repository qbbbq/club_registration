import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeSource = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8');
const registerSource = readFileSync(new URL('./Register.vue', import.meta.url), 'utf8');

describe('registration title integration', () => {
  it('uses the shared title loader on the QR entry page', () => {
    expect(homeSource).toContain("from '../utils/registrationSettings'");
    expect(homeSource).toContain('loadRegistrationTitle');
    expect(homeSource).toContain('{{ registrationTitle }}');
  });

  it('uses the shared title loader on the registration page', () => {
    expect(registerSource).toContain("from '../utils/registrationSettings'");
    expect(registerSource).toContain('loadRegistrationTitle');
    expect(registerSource).toContain('{{ registrationTitle }}');
  });
});
