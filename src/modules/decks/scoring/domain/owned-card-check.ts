// The answer to "do I own this card?" for one name.

export type OwnedCardCheck =
  | Readonly<{
      query: string;
      inCatalog: false;
      status: "not in catalog";
    }>
  | Readonly<{
      query: string;
      inCatalog: true;
      name: string;
      oracleId: string;
      ownedGame: number;
      ownedReal: number;
      ownedTotal: number;
      cheapestPriceCents: number | null;
      decks: readonly { id: number; name: string; quantity: number }[];
    }>;
