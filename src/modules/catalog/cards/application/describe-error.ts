import { assertNever } from "@/shared/kernel";
import type { ChoosePhotoError, SetPageSlugError } from "./admin";

// What each expected failure says to the player, in one place per module (ADR 0026, audit S7).
// The `switch` is exhaustive: a new error kind doesn't compile until it has a sentence.

export function describePhotoError(error: ChoosePhotoError | SetPageSlugError): string {
  switch (error.kind) {
    case "Forbidden":
      return "Only admins can change photos.";
    case "ProductNotFound":
      return "That product isn't in the catalog.";
    case "PhotoNotOnPage":
      return "That photo isn't on this set's WPN page.";
    case "SetNotFound":
      return "That set isn't in the catalog.";
    case "SlugInvalid":
      return "A page address is lowercase words joined by hyphens, like secrets-of-strixhaven.";
    default:
      return assertNever(error);
  }
}
