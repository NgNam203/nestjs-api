function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
export class TimeoutError extends Error {
  public readonly label?: string;

  constructor(message = 'Operation timed out', label?: string) {
    super(message);
    this.name = 'TimeoutError';
    this.label = label;
  }
}

export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  let t: NodeJS.Timeout | null = null;

  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new TimeoutError(label ?? 'timeout')), ms);
  });

  // DEV/REHEARSAL ONLY: simulate DB slowness as part of the timed operation
  const mode = process.env.DB_MODE ?? 'ok';
  const wrapped = (async () => {
    if (mode === 'slow' && label?.startsWith('db_timeout_')) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    return p;
  })();

  try {
    return await Promise.race([wrapped, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}
