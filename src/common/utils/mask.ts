export function maskEmail(email: string) {
  const [u, d] = email.split('@');
  if (!u || !d) return 'unknown';
  return `${u.slice(0, 1)}***@${d}`;
}

export function maskIp(ip: string) {
  // IPv4 đơn giản
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  return 'unknown';
}
