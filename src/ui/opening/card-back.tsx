// A card back of our own design (design doc 08, decision 2): the real Magic card back is Wizards
// of the Coast's artwork, so we draw something else with CSS.
export function CardBack() {
  return (
    <div
      aria-hidden
      className="flex aspect-[488/680] w-full items-center justify-center rounded-[4.5%] border-[6px] border-zinc-900 shadow-md"
      style={{
        background:
          "radial-gradient(ellipse at center, #7c3aed 0%, #3b0764 45%, #0f0a1f 80%), #0f0a1f",
      }}
    >
      <div className="flex h-[70%] w-[62%] items-center justify-center rounded-[50%] border-2 border-amber-300/70 bg-black/30">
        <span className="text-center text-[10px] leading-tight font-bold tracking-widest text-amber-200/90 uppercase">
          TCG
          <br />
          Virtual
          <br />
          Library
        </span>
      </div>
    </div>
  );
}
