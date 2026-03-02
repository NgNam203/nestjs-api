import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('should trim and lowercase', () => {
    expect(normalizeEmail('  Test@Example.COM  ')).toBe('test@example.com');
  });

  it('should handle already normalized', () => {
    expect(normalizeEmail('test@example.com')).toBe('test@example.com');
  });
});
