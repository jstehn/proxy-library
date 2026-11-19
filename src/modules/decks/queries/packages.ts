import {} from "drizzle-orm";
import {} from "../domain/packages";
import {} from "../infrastructure/schema";

export type CardPackageSummary = Readonly<{
  id: number;
  name: string;
  description: string;
  tags: readonly string[];
  cardCount: number;
  entries: readonly {
    oracleId: string;
    name: string;
    quantity: number;
    heading: string | null;
    note: string | null;
  }[];
}>;
