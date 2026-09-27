# Decisions to review

Phases 6–11 were built in one unattended overnight run (2026-09-27 → 28). Design docs were
**self-approved** so work could continue. Everything decided without you is listed here, so you can
review it in one place. Anything can still be changed.

## Answered by you before the run

| Topic                 | Decision                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review gates          | Self-approve each design doc, choose recommended options, and list judgement calls here                                                            |
| Selling singles       | The store pays **50%** of market price (admins can change it)                                                                                      |
| Decks and ownership   | **Shared:** each deck may use every copy you own. The builder shows which other decks use a card, and flags decks left short after a sale or trade |
| Opening sounds        | **Generated in the browser** (Web Audio API), with no sound files                                                                                  |
| Product and set art   | **Generated SVG art only.** Retailer photos wait for your decision on their terms                                                                  |
| Boxes and bundles     | **Unpack into inventory:** open each pack yourself, or "open all"                                                                                  |
| Activity feed         | Everyone sees **notable pulls, sealed purchases and completed trades**. Money amounts other than card prices stay private                          |
| Trades                | **Cards and money** on either side; accept, decline or cancel; a counter-offer is a new proposal                                                   |
| Docker                | Pull base images and **test the whole stack locally**                                                                                              |
| Collection export     | **Moxfield CSV, plain text list, full CSV**                                                                                                        |
| Tests and the network | Automated tests never call real APIs or image hosts. Real-endpoint checks go in an opt-in `pnpm test:remote` suite                                 |

## Judgement calls made during the run

Each entry: the phase, what was decided, why, and where to change it.

<!-- Added as the phases are built. -->
