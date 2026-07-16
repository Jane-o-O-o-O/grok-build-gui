# Settings capability audit

This audit compares the settings destinations extracted from the local Codex
desktop reference with features already implemented by the native Grok TUI.
It is intended to drive the next desktop settings iteration; it does not treat
every reference-only product or hardware feature as a Grok requirement.

## Result

- Reference settings destinations found: **28**
- Native Grok feature with a direct equivalent: **18**
- Native Grok feature with a partial equivalent: **4**
- Reference-specific feature without a native Grok equivalent: **6**
- Reusable native coverage: **22 / 28 (78.6%)** when direct and partial
  equivalents are counted together.

The reference route inventory comes from:

`C:\Users\26891\Desktop\chatgpt_ui_reverse\extracted\webview\assets\settings-sections-zUmNzWQK.js`

The displayed destination names come from:

`C:\Users\26891\Desktop\chatgpt_ui_reverse\extracted\webview\assets\settings-shared-CkwCmTAZ.js`

Native Grok evidence comes from the user guide under:

`crates/codegen/xai-grok-pager/docs/user-guide/`

## Capability matrix

| # | Reference destination | Native Grok coverage | Grok capability that can back a desktop page |
|---:|---|---|---|
| 1 | General | Direct | Models, permission defaults, compaction, runtime, update and feature flags in `config.toml` |
| 2 | Import | Direct | `/import-claude`, Claude/Cursor compatibility cells, MCP/hooks/rules/skills discovery |
| 3 | Profile | Direct | Browser sign-in, API keys, OIDC/SSO and external auth providers |
| 4 | Keyboard shortcuts | Partial | Complete native shortcut map exists, but arbitrary key remapping is not a general TUI setting |
| 5 | Codex Micro | Reference-only | Product-specific hardware controls |
| 6 | Appshots | Reference-only | Reference-app-specific feature |
| 7 | Appearance | Direct | Five themes plus system mode, compact/minimal/fullscreen modes and detailed `pager.toml` styling |
| 8 | Voice | Reference-only | No native dictation settings subsystem |
| 9 | Pets | Reference-only | Reference-app-specific decoration |
| 10 | Configuration / Agent | Direct | Agent mode, personas, subagents, reasoning effort, model routing, approval and sandbox modes |
| 11 | Git | Partial | Git tools, worktrees and review are native; branch-prefix and PR-default preferences need desktop-owned settings |
| 12 | Data controls | Direct | Local sessions, memory, telemetry, feedback and log controls |
| 13 | Cloud preferences | Partial | Remote catalog and usage services exist; reference cloud-task preferences do not map one-to-one |
| 14 | Cloud environments | Reference-only | No matching hosted-environment manager in the native TUI |
| 15 | Code review | Direct | Headless automated review plus native Git/diff workflows |
| 16 | Personalization | Direct | Personas, `AGENTS.md`, project rules and persistent memory |
| 17 | Usage & billing | Direct | `/usage`, token/cost accounting, dashboard and monitoring export |
| 18 | Debug | Direct | `grok inspect`, logs, terminal diagnostics and monitoring dashboard |
| 19 | Browser | Partial | Web search/fetch tools exist; an interactive embedded-browser permission center is desktop-owned |
| 20 | Computer use | Reference-only | No native OS application-control settings subsystem |
| 21 | Local environments | Direct | Environment loading, sandbox profiles, shell tools, headless mode and local runtime selection |
| 22 | Worktrees | Direct | Create/fork session worktrees and persistent worktree prompt policies |
| 23 | Environments | Direct | Local execution, sandbox, agent/ACP and headless environment controls |
| 24 | MCP servers | Direct | Stdio and HTTP/SSE servers, headers, environment, startup and tool timeouts |
| 25 | Hooks | Direct | Command, prompt, agent and HTTP lifecycle hooks with project/global scopes |
| 26 | Connections | Direct | ACP stdio, WebSocket relay, SDK/IDE integration and remote terminal workflows |
| 27 | Plugins | Direct | Plugin paths, enable/disable, marketplaces, bundled skills/agents/hooks/MCP/LSP |
| 28 | Skills | Direct | User, project, plugin, Claude and Cursor skill discovery and enable/disable controls |

## Recommended desktop settings structure

The 18 direct capabilities can be exposed without inventing a second runtime
configuration model. A practical navigation order is:

1. **General** — runtime, default model, language, update and session defaults.
2. **Models** — built-in models and third-party provider discovery.
3. **Appearance** — theme, density, thinking/tool grouping and diff display.
4. **Agent & permissions** — reasoning, approval, sandbox, compaction and subagents.
5. **Git & worktrees** — review defaults and new/fork worktree policies.
6. **Memory & personalization** — memory, personas and project instructions.
7. **MCP, hooks, plugins & skills** — discovery, enable/disable and configuration files.
8. **Connections & environments** — local runtime, ACP/WebSocket and environment loading.
9. **Usage & diagnostics** — usage, telemetry, logs and `grok inspect` results.

The desktop app should read and write the same `~/.grok/config.toml` keys used
by the TUI, with desktop-only state kept separately. This keeps CLI, TUI and
desktop behavior consistent and avoids configuration drift.
