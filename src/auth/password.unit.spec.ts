import * as bcrypt from 'bcrypt';

describe('Password hashing (bcrypt)', () => {
  it('should hash and verify password', async () => {
    const plain = 'P@ssw0rd!';
    const hash = await bcrypt.hash(plain, 12);

    expect(hash).not.toBe(plain);
    expect(await bcrypt.compare(plain, hash)).toBe(true);
    expect(await bcrypt.compare('wrong', hash)).toBe(false);
  });
});
