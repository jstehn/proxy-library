/**
 * Exhaustiveness check for `switch` statements over discriminated unions.
 * If a new variant is added and not handled, the call no longer type-checks.
 */
export function assertNever(value: never, message = "Unhandled variant"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
