import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

describe('registration settings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the stored title', async () => {
    const axios = await import('axios');
    vi.mocked(axios.default.get).mockResolvedValue({
      data: { success: true, data: { title: '2026 秋季社团报名' } },
    } as any);
    const { loadRegistrationTitle } = await import('./registrationSettings');

    await expect(loadRegistrationTitle()).resolves.toBe('2026 秋季社团报名');
    expect(axios.default.get).toHaveBeenCalledWith('/api/settings/registration-title');
  });

  it('falls back to the default title for an empty response', async () => {
    const axios = await import('axios');
    vi.mocked(axios.default.get).mockResolvedValue({
      data: { success: true, data: { title: '   ' } },
    } as any);
    const { DEFAULT_REGISTRATION_TITLE, loadRegistrationTitle } =
      await import('./registrationSettings');

    await expect(loadRegistrationTitle()).resolves.toBe(DEFAULT_REGISTRATION_TITLE);
  });

  it('falls back to the default title when loading fails', async () => {
    const axios = await import('axios');
    vi.mocked(axios.default.get).mockRejectedValue(new Error('network unavailable'));
    const { DEFAULT_REGISTRATION_TITLE, loadRegistrationTitle } =
      await import('./registrationSettings');

    await expect(loadRegistrationTitle()).resolves.toBe(DEFAULT_REGISTRATION_TITLE);
  });
});
