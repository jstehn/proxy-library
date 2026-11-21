/** The key for a pack's photo in `packPhotos`' map. Not a read, so it lives apart from the reads. */
export const packKey = (setCode: string, boosterType: string) => `${setCode}/${boosterType}`;
