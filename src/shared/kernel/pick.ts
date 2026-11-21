/**
 * Some of a service's methods, listed by name. A narrow capability (ADR 0026) is exactly this: it
 * holds the methods callers use, so a method nobody calls can't be reached.
 */
export function pick<Source extends object, Key extends keyof Source>(
  source: Source,
  ...keys: readonly Key[]
): Pick<Source, Key> {
  const picked = {} as Pick<Source, Key>;
  for (const key of keys) picked[key] = source[key];
  return picked;
}
