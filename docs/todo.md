# To do

The working queue lives on the **Proxy Library** project in tududi
(https://tududi.devstageprod.duckdns.org), not in the repo. Work is **one feature at a time**;
ideas that come up mid-feature go to tududi's **inbox** and wait.

| Task status | Means                                                       |
| ----------- | ----------------------------------------------------------- |
| In progress | the feature being built now (one at a time)                 |
| Planned     | up next, highest priority first                             |
| Not started | someday ideas, tagged `someday` plus an area (`decks`, ...) |

When a feature is picked up it gets a design doc as usual (docs/roadmap.md). Its task is done
when the phase's lesson is written and the work is committed.

[future-ideas.md](future-ideas.md) stays as the record of deferred ideas and known limits that
design docs link to. Its items are also on the board as `someday` tasks; when one is picked up,
update both.

## Connecting

Claude Code connects to tududi's built-in MCP server through `.mcp.json`. It reads
`TUDUDI_URL` and `TUDUDI_API_KEY` from `.envrc.local` (copy `.envrc.local.example`; the key comes
from tududi's Profile → API keys). Start Claude Code from a direnv shell so they're set.
