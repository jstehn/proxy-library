// Art filters for playtest proxies (design doc 22, section 3.2). Pure functions on pixels, so
// each can be tested on a tiny made-up image; decoding and encoding JPEGs is infrastructure's job.

/** A colour image, four bytes per pixel (red, green, blue, alpha), row by row from the top. */
export type Pixels = Readonly<{ width: number; height: number; data: Uint8ClampedArray }>;

/** A greyscale image, one byte per pixel (0 black, 255 white). */
export type GrayPixels = Readonly<{ width: number; height: number; data: Uint8ClampedArray }>;

/**
 * The middle of the image with this width-to-height ratio, the way CSS's `object-fit: cover`
 * fills a box: what doesn't fit is cut off equally from both sides.
 */
export function cropToAspect(image: Pixels, aspect: number): Pixels {
  const { width, height } = image;
  const croppedWidth = Math.min(width, Math.max(1, Math.round(height * aspect)));
  const croppedHeight = Math.min(height, Math.max(1, Math.round(width / aspect)));
  const left = Math.floor((width - croppedWidth) / 2);
  const top = Math.floor((height - croppedHeight) / 2);
  const data = new Uint8ClampedArray(croppedWidth * croppedHeight * 4);
  for (let row = 0; row < croppedHeight; row++) {
    const from = ((top + row) * width + left) * 4;
    data.set(image.data.subarray(from, from + croppedWidth * 4), row * croppedWidth * 4);
  }
  return { width: croppedWidth, height: croppedHeight, data };
}

/** How bright each pixel looks (ITU-R BT.601 luma: green looks brightest, blue darkest). */
export function grayscale(image: Pixels): GrayPixels {
  const data = new Uint8ClampedArray(image.width * image.height);
  for (let index = 0; index < data.length; index++) {
    const red = image.data[index * 4] ?? 0;
    const green = image.data[index * 4 + 1] ?? 0;
    const blue = image.data[index * 4 + 2] ?? 0;
    data[index] = 0.299 * red + 0.587 * green + 0.114 * blue;
  }
  return { width: image.width, height: image.height, data };
}

/** A pixel's value, with coordinates outside the image taken from the nearest edge. */
function at(image: GrayPixels, x: number, y: number): number {
  const column = Math.min(image.width - 1, Math.max(0, x));
  const row = Math.min(image.height - 1, Math.max(0, y));
  return image.data[row * image.width + column] ?? 0;
}

/** Each pixel replaced by the average of the 3 × 3 square around it: smooths JPEG speckle. */
function blur(image: GrayPixels): GrayPixels {
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) sum += at(image, x + dx, y + dy);
      data[y * image.width + x] = sum / 9;
    }
  }
  return { width: image.width, height: image.height, data };
}

/** Edge strengths below this are dropped (paper texture, soft shading); fixed (decision 3). */
export const EDGE_THRESHOLD = 40;
/** Edge strengths above this print solid black. */
export const EDGE_FULL = 220;

/**
 * Line art from a picture with the Sobel filter: dark lines where brightness changes sharply,
 * white everywhere else. Two 3 × 3 kernels measure how fast brightness changes across (gx) and
 * down (gy) each pixel; the edge strength is the length of that change, √(gx² + gy²).
 */
export function sobelEdges(image: Pixels): GrayPixels {
  const gray = blur(grayscale(image));
  const data = new Uint8ClampedArray(gray.data.length);
  for (let y = 0; y < gray.height; y++) {
    for (let x = 0; x < gray.width; x++) {
      const topLeft = at(gray, x - 1, y - 1);
      const top = at(gray, x, y - 1);
      const topRight = at(gray, x + 1, y - 1);
      const left = at(gray, x - 1, y);
      const right = at(gray, x + 1, y);
      const bottomLeft = at(gray, x - 1, y + 1);
      const bottom = at(gray, x, y + 1);
      const bottomRight = at(gray, x + 1, y + 1);
      // [-1 0 1; -2 0 2; -1 0 1] and its transpose.
      const across = topRight + 2 * right + bottomRight - (topLeft + 2 * left + bottomLeft);
      const down = bottomLeft + 2 * bottom + bottomRight - (topLeft + 2 * top + topRight);
      const strength = Math.hypot(across, down);
      const darkness = (strength - EDGE_THRESHOLD) / (EDGE_FULL - EDGE_THRESHOLD);
      data[y * gray.width + x] = 255 - 255 * Math.min(1, Math.max(0, darkness));
    }
  }
  return { width: gray.width, height: gray.height, data };
}
