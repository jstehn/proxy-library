#!/usr/bin/env python3
"""Call the tududi board's MCP tools over HTTP, for sessions whose tududi MCP server isn't connected.

Run from the repo root:
  python3 scripts/tududi-mcp.py list [name,filter]
  python3 scripts/tududi-mcp.py call add_task_comment '{"id": 237, "body": "Started on refactor/P00-setup"}'
Uses the same key as .mcp.json (scripts/tududi-headers.sh reads .envrc.local).
"""
import json, os, subprocess, sys, urllib.request
URL = os.environ.get("TUDUDI_URL", "https://tududi.devstageprod.duckdns.org") + "/api/mcp"
AUTH = json.loads(subprocess.check_output(["bash", "scripts/tududi-headers.sh"]))["Authorization"]
def rpc(method, params, session=None):
    headers = {"Authorization": AUTH, "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if session: headers["Mcp-Session-Id"] = session
    req = urllib.request.Request(URL, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req) as r:
        body = r.read().decode(); sid = r.headers.get("Mcp-Session-Id")
    if body.startswith("event:") or "data:" in body[:20]:
        body = "\n".join(l[5:] for l in body.splitlines() if l.startswith("data:"))
    return (json.loads(body) if body.strip() else {}), sid
init, sid = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "proxy-library-script", "version": "1"}})
try: rpc("notifications/initialized", {}, sid)
except Exception: pass
if sys.argv[1] == "list":
    res, _ = rpc("tools/list", {}, sid)
    for t in res["result"]["tools"]:
        if len(sys.argv) < 3 or any(w in t["name"] for w in sys.argv[2].split(",")):
            print(t["name"], json.dumps(t.get("inputSchema", {}).get("properties", {})))
else:
    res, _ = rpc("tools/call", {"name": sys.argv[2], "arguments": json.loads(sys.argv[3])}, sid)
    out = res.get("result", res)
    for c in out.get("content", []): print(c.get("text", ""))
    if "error" in res: print("ERROR", res["error"])
