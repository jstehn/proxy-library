// Worker entry point: `pnpm worker <command>`. Each command lives in worker/commands/.
import { checkCommanders, checkPacks, checkProducts } from "./commands/checks";
import type { Command } from "./commands/command";
import { draftTimers, schedule } from "./commands/schedule";
import {
  embedCards,
  health,
  migrate,
  sync,
  syncEdhrec,
  syncRules,
  syncSpellbook,
  valueProducts,
} from "./commands/sync";
import { createWorkerContainer } from "./container";

const COMMANDS: Record<string, Command> = {
  health,
  migrate,
  sync,
  "value-products": valueProducts,
  "embed-cards": embedCards,
  "sync-edhrec": syncEdhrec,
  "sync-rules": syncRules,
  "sync-spellbook": syncSpellbook,
  "check-packs": checkPacks,
  "check-products": checkProducts,
  "check-commanders": checkCommanders,
  schedule,
  "draft-timers": draftTimers,
};

async function main(name: string | undefined) {
  const command = name === undefined ? undefined : COMMANDS[name];
  if (command === undefined) {
    console.error(`usage: pnpm worker <${Object.keys(COMMANDS).join("|")}>`);
    process.exitCode = 1;
    return;
  }
  const container = createWorkerContainer();
  try {
    await command(container);
  } finally {
    await container.close();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
