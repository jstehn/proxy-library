/**
 * The card an arrow key moves to: the next or previous one for left and right, and the nearest
 * one in the row above or below for up and down (rows are found by position on screen).
 */
export function nextByPosition(buttons: HTMLElement[], index: number, key: string): number | null {
  if (key === "ArrowRight") return index + 1 < buttons.length ? index + 1 : null;
  if (key === "ArrowLeft") return index > 0 ? index - 1 : null;
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;
  const here = buttons[index].getBoundingClientRect();
  const down = key === "ArrowDown";
  let best: { index: number; rowDistance: number; sideDistance: number } | null = null;
  for (const [candidate, button] of buttons.entries()) {
    const box = button.getBoundingClientRect();
    const rowDistance = down ? box.top - here.top : here.top - box.top;
    if (rowDistance <= 4) continue; // same row, or the wrong direction
    const sideDistance = Math.abs(box.left - here.left);
    const closerRow = best === null || rowDistance < best.rowDistance - 4;
    const sameRowButNearer =
      best !== null &&
      Math.abs(rowDistance - best.rowDistance) <= 4 &&
      sideDistance < best.sideDistance;
    if (closerRow || sameRowButNearer) best = { index: candidate, rowDistance, sideDistance };
  }
  return best === null ? null : best.index;
}
