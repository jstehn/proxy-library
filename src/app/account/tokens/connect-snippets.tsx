// How to connect an LLM client (design doc 28, section 9): examples for the common kinds of
// client, not a list of supported apps. Any MCP client that can send a header works.

type Props = { secret: string; mcpUrl: string; openApiUrl: string };

function Snippet(props: { title: string; note: string; code: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-sm font-medium">{props.title}</h3>
      <p className="text-xs text-zinc-500">{props.note}</p>
      <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

export function ConnectSnippets(props: Props) {
  const header = `Bearer ${props.secret}`;
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        "proxy-library": { type: "http", url: props.mcpUrl, headers: { Authorization: header } },
      },
    },
    null,
    2,
  );
  const bridgeConfig = JSON.stringify(
    {
      mcpServers: {
        "proxy-library": {
          command: "npx",
          args: ["-y", "mcp-remote", props.mcpUrl, "--header", `Authorization:${header}`],
        },
      },
    },
    null,
    2,
  );
  return (
    <div className="flex flex-col gap-4">
      <Snippet
        title="An MCP client that connects over HTTP"
        note="Most desktop apps, IDEs and command-line agents: add a remote (HTTP) server with this address and header. The JSON is the common config file shape."
        code={mcpConfig}
      />
      <Snippet
        title="An MCP client that only starts local servers"
        note="Apps that run MCP servers as commands (stdio) reach this one through the mcp-remote bridge (needs Node.js)."
        code={bridgeConfig}
      />
      <Snippet
        title="Function calling without MCP"
        note="Import the OpenAPI description, and send the header with every call."
        code={`${props.openApiUrl}\nAuthorization: ${header}`}
      />
    </div>
  );
}
