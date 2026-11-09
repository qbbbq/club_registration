import crypto from 'crypto';

export function normalizeIdCard(idCard: string): string {
  return idCard.trim().replace(/x$/i, 'X');
}

export function hashIdCard(idCard: string): string {
  return crypto.createHash('sha256').update(normalizeIdCard(idCard)).digest('hex');
}
