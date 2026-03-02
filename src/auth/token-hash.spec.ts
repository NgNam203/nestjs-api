import { hashToken } from './token-hash';

describe('hashToken', () => {
  it('should return deterministic hash', () => {
    const a = hashToken('hello');
    const b = hashToken('hello');
    expect(a).toBe(b);
  });

  it('should change when input changes', () => {
    const a = hashToken('hello');
    const b = hashToken('hello2');
    expect(a).not.toBe(b);
  });

  it('should be hex string length 64', () => {
    const h = hashToken('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
