import { describe, expect, it } from "vitest";
import { imageUrl } from "./images";

const large = "https://cards.scryfall.io/large/front/1/3/132dc07f.jpg?1787678033";
const uris = { small: "s", normal: "n", large };

describe("imageUrl", () => {
  it("uses the stored address for each size", () => {
    expect(imageUrl(uris, "normal")).toBe("n");
    expect(imageUrl({ ...uris, artCrop: "a" }, "artCrop")).toBe("a");
  });

  it("works out the art crop from the large image when it isn't stored yet", () => {
    expect(imageUrl(uris, "artCrop")).toBe(
      "https://cards.scryfall.io/art_crop/front/1/3/132dc07f.jpg?1787678033",
    );
  });
});
