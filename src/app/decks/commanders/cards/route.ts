import { readPage } from "@/server/page-instance";
import { commanderCardsView } from "../_components/commander-cards-view";

// One commander's cards for the "See the cards" panel on Find a commander (design doc 36), read on
// request: `GET /decks/commanders/cards?oracleId=…&real=1`. It is a read, so it is a route and
// not a server action.

export async function GET(request: Request) {
  const { actor, reads } = await readPage();
  const { searchParams } = new URL(request.url);
  const oracleId = searchParams.get("oracleId") ?? "";
  const details = await reads.decks.commanderDetails(
    actor,
    oracleId,
    searchParams.get("real") === "1",
  );
  if (details === null) return new Response("Not found", { status: 404 });
  return Response.json(commanderCardsView(details));
}
