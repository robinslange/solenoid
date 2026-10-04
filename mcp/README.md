# @solenoid.systems/mcp

Solenoid limits what an agent does. The agent's tools call Solenoid before they act, and Solenoid refuses an action that would go past its limit. This MCP server lets your assistant read those limits and the signed receipts in chat. Ask it how many emails the conversation `support/conv-123` has left, and it answers from the limit on that scope. Started with `--admin`, it can also change limits and revoke spend keys.

A scope is a path you choose, such as `support/conv-123`, and a limit caps one unit, such as `emails`, at a scope and every scope under it.

It needs Node 20 or later and has no runtime dependencies.

## Set it up

Get a spend key with `solenoid key <scope>`, then add the server to Claude Code, as its [MCP docs](https://code.claude.com/docs/en/mcp) describe. Keep the name before `-e`:

```sh
claude mcp add solenoid -e SOLENOID_KEY=sk.spend.… -- npx -y @solenoid.systems/mcp
```

The server refuses to start unless `SOLENOID_KEY` is a spend key. It reads the key's scope and every scope under it. It sends to `SOLENOID_API` if that is set, and to `https://api.solenoid.systems` otherwise. Then ask your assistant "how many emails does support/conv-123 have left?". It calls `get` on that scope and answers from each limit that applies there, with its usage and what is left.

To change limits and revoke keys as well, add a second server under its own name, started with `--admin`:

```sh
claude mcp add solenoid-admin -- npx -y @solenoid.systems/mcp --admin
```

`--admin` reads the admin key and the API from `~/.config/solenoid/credentials`, the file that `solenoid init` and `solenoid login` write. `SOLENOID_CONFIG_DIR` moves it to `$SOLENOID_CONFIG_DIR/credentials`. The server refuses to start unless that file holds an admin key, one that starts `sk.admin.`.

For Claude Desktop, add the server to `claude_desktop_config.json`, as the [guide to connecting local servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) describes. The file is at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "solenoid": {
      "command": "npx",
      "args": ["-y", "@solenoid.systems/mcp"],
      "env": { "SOLENOID_KEY": "sk.spend.…" }
    }
  }
}
```

For the admin tools, add a `solenoid-admin` entry with `"args": ["-y", "@solenoid.systems/mcp", "--admin"]` and no `env`.

## Tools

| Tool | Needs | What it does |
|---|---|---|
| `get` | a spend key or `--admin` | Shows every limit that applies at a scope, with its usage and what is left, and lists the scope's children. |
| `log` | a spend key or `--admin` | Lists the signed receipts at a scope and below, newest first, 50 at a time, each with its time. Pass `before` to page back. It has no time filter, so to answer "what did the agent do in the last hour", the assistant reads the times. |
| `set_limit` | `--admin` | Sets or removes limits at a scope. A number sets the cap, `0` refuses every spend of the unit, and `null` removes the limit. Any of `per`, `on_outage` and `warn_at` left out of a call resets to its default, so pass the current settings back with a change. It refuses `per`, `on_outage`, `warn_at`, `rotate_keys` and `rotate_admin` as unit names, and any value that isn't a number or `null`. Solenoid refuses the unit `spends`, which the plan sets, with `plan_owned`. |
| `rotate` | `--admin` | Revokes the spend key for exactly one scope and returns its new key. The old key fails at once, so deploy the new one wherever the old one was. It never rotates the admin key: run `solenoid rotate --admin --yes` in your terminal for that. |

## Keep the admin tools away from the agent you govern

Give a governed agent a spend key, and never `--admin`. With `--admin`, it could raise its own limits, which defeats them. Add `solenoid-admin` only to a client that isn't itself running under the limits, such as the assistant you use to manage Solenoid. Without `--admin`, the server refuses an admin key in `SOLENOID_KEY`, so one pasted there by mistake never runs.

## Protocol

The server speaks JSON-RPC over stdio. It serves MCP `2026-07-28` statelessly, reading the version from each request's `_meta`, and answers `server/discover` with the versions it supports ([versioning, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)). It serves `2025-11-25` and `2025-06-18` after `initialize` ([lifecycle, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle); [lifecycle, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)). It writes only JSON-RPC to stdout, as the [stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) requires. When it can't start, it prints the reason to stderr and exits with code 1.
