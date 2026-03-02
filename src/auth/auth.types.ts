export type AccessPayload = { sub: string; role: 'USER' | 'ADMIN' };

export type RefreshPayload = {
  sub: string;
  sid: string;
  type: 'refresh';
  jti: string;
};
