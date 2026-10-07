import { describe, expect, it } from "vitest";
import { cropToAspect, grayscale, sobelEdges, type Pixels } from "./art-filters";

/** An image from rows of grey levels (every pixel's red, green and blue the same). */
function image(rows: readonly (readonly number[])[]): Pixels {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(rows.flat().flatMap((level) => [level, level, level, 255]));
  return { width, height, data };
}

/** One colour, width × height. */
function solid(width: number, height: number, rgb: readonly [number, number, number]): Pixels {
  const pixel = [...rgb, 255];
  return {
    width,
    height,
    data: new Uint8ClampedArray(Array.from({ length: width * height }, () => pixel).flat()),
  };
}

describe("cropToAspect", () => {
  it("cuts equally from the left and right of a wide image", () => {
    const wide = image([[1, 2, 3, 4, 5, 6]]);
    const cropped = cropToAspect(wide, 2);
    expect([cropped.width, cropped.height]).toEqual([2, 1]);
    expect(grayscale(cropped).data).toEqual(new Uint8ClampedArray([3, 4]));
  });

  it("cuts equally from the top and bottom of a tall image", () => {
    const tall = image([[1], [2], [3], [4]]);
    const cropped = cropToAspect(tall, 1 / 2);
    expect([cropped.width, cropped.height]).toEqual([1, 2]);
    expect(grayscale(cropped).data).toEqual(new Uint8ClampedArray([2, 3]));
  });
});

describe("grayscale", () => {
  it("weighs green brightest and blue darkest, as eyes do", () => {
    const red = grayscale(solid(1, 1, [255, 0, 0])).data[0];
    const green = grayscale(solid(1, 1, [0, 255, 0])).data[0];
    const blue = grayscale(solid(1, 1, [0, 0, 255])).data[0];
    expect([red, green, blue]).toEqual([76, 150, 29]);
    expect(grayscale(solid(2, 2, [200, 200, 200])).data).toEqual(
      new Uint8ClampedArray([200, 200, 200, 200]),
    );
  });
});

describe("sobelEdges", () => {
  it("leaves a flat picture white", () => {
    const edges = sobelEdges(solid(5, 5, [90, 40, 200]));
    expect(edges.data.every((level) => level === 255)).toBe(true);
  });

  it("draws a dark line where black meets white, and nothing far from it", () => {
    const row = [0, 0, 0, 0, 255, 255, 255, 255];
    const edges = sobelEdges(image(Array.from({ length: 5 }, () => row)));
    expect([edges.width, edges.height]).toEqual([8, 5]);
    const middle = Array.from(edges.data.subarray(2 * 8, 3 * 8));
    // Darkest at the boundary (between columns 3 and 4), white at the far sides.
    expect(middle[3]).toBe(0);
    expect(middle[4]).toBe(0);
    expect(middle[0]).toBe(255);
    expect(middle[7]).toBe(255);
  });

  it("ignores faint changes (below the threshold)", () => {
    const row = [100, 100, 100, 104, 104, 104];
    const edges = sobelEdges(image(Array.from({ length: 3 }, () => row)));
    expect(edges.data.every((level) => level === 255)).toBe(true);
  });
});
