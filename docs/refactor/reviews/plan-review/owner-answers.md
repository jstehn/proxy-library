# The owner's answers on the project's philosophy (2026-11-19)

These answers shape the revised plan. Questions without an answer yet are listed at the bottom.

1. **Who the code is written for: yes.**
   - Write it for an experienced web developer, and keep it readable for a TypeScript newcomer.
   - Teaching goes in `lessons/`, not in code comments.
2. **Comments: (b).**
   - Exported functions get a short summary.
   - Other comments explain _why_, never restate what the code does.
   - Teaching comments that do restate it get trimmed.
3. **Reads: (a), an honest query layer** (what the architecture review calls "Option 1", CQRS-style).
   - Reads are each module's typed SQL query functions, written once and called directly by pages
     and actions through a documented read layer.
   - Capabilities are for writes and for anything with rules or permissions.
   - The one-line forward bundles (`deckReads`, `storeReads` and the rest) are removed.

## Still open

- Earlier list: 4 to 12.
- UI review: 1 to 5.
- Docs review: public repo and licence, CI, the AI note, `collection` versus `real-collection`.
