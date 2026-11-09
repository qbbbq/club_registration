import { describe, expect, it } from 'vitest';
import { getRawFile } from './uploadFile';

describe('getRawFile', () => {
  it('returns raw file from Element Plus UploadFile object', () => {
    const raw = new File(['姓名\t身份证号\t班级'], 'students.txt', { type: 'text/plain' });

    expect(getRawFile({ name: 'students.txt', raw })).toBe(raw);
  });
});
