// Real implementations of the collection ports, game and real. Only composition roots import this file.
export { drizzleCollectionRepository } from "../game/infrastructure/drizzle-repositories";
export {
  drizzleRealCollectionRepository,
  sqlPrintingMatcher,
} from "../real/infrastructure/drizzle-repositories";
