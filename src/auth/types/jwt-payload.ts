export type AccessTokenPayload = {
  sub: string; // userId
  role: 'USER' | 'ADMIN';
  iat?: number;
  exp?: number;
};
