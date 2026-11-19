import { sql, type SQL } from "drizzle-orm";

/** `array['a', 'b']::text[]` with every value as a parameter (an empty list is `array[]::text[]`). */
export function textArray(values: readonly string[]): SQL {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}
