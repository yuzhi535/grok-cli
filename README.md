<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://media.x.ai/v1/website/spacexai-symbol-white-transparent-0c31957f.png">
    <source media="(prefers-color-scheme: light)" srcset="https://media.x.ai/v1/website/spacexai-symbol-black-transparent-6435cf42.png">
    <img alt="Gcode logo" src="https://media.x.ai/v1/website/spacexai-symbol-black-transparent-6435cf42.png" width="96">
  </picture>
  <br>
  Gcode
</h1>

> **Gcode** 是基于 [xAI Grok Build](https://github.com/xai-org/grok-build) 的社区增强版（fork），二进制名改为 `gcode`。
> 保留上游全部功能的同时，增加了自动构建、多供应商支持和开箱即用的配置。

</div>

---

## 与上游 Grok Build 的区别

| 特性 | 上游 Grok Build | Gcode |
|------|:---:|:---:|
| 二进制名 | `grok` / `gork` | `gcode` |
| xAI 登录 | 必需 | **可选**（多供应商模式） |
| 模型支持 | xAI Grok | **OpenAI Codex OAuth · DeepSeek · Anthropic · Kimi 等** |
| 自动构建 | 无 | **每次 push 自动 CI 构建 + 发布** |
| 开箱配置 | 需自行配置 | **预置多供应商 config** |
| 上游合并 | — | 最小改动策略，便于追踪上游 |

### 核心增强

- **无需 xAI 登录**：内置多供应商桥接，直接用 OpenAI / DeepSeek / Anthropic 等账号即可使用。
- **ChatGPT / Codex OAuth（对齐 PI）**：走 `chatgpt.com/backend-api/codex/responses`，自动读 Codex CLI / PI / OpenCode 本地登录态并刷新 token。
- **自动 CI/CD**：push 到 `main` 自动构建 macOS ARM64 + Linux x86_64，发布到 GitHub Releases。
- **预置模型配置**：内置 PI 模型导入工具，`gcode models` 即可查看所有可用模型。
- **上游友好**：改动集中在一只手能数过来的文件中，合并上游更新时冲突极少。

### 使用 ChatGPT 订阅（OpenAI Codex OAuth）

与 PI 相同路径，不需要 Platform API Key：

1. 用任一工具完成 ChatGPT 登录（任选其一即可）：
   - `codex login`
   - PI 的 OpenAI Codex 登录
   - `opencode auth login`（OpenAI OAuth）
2. 导入模型并安装凭证 helper：

```sh
node scripts/import-pi-models.mjs
# 会写入 ~/.gcode/config.toml，并安装 ~/.gcode/bin/gcode-openai-codex-auth
```

3. 启动 `gcode`，选择 `pi-openai-codex-*` 模型（默认会跟 PI 的 default 对齐）。

运行时行为（从 PI 抄过来）：

| 项目 | 行为 |
|------|------|
| 端点 | `https://chatgpt.com/backend-api/codex/responses` |
| 鉴权 | `Authorization: Bearer <oauth access>` |
| 账号头 | JWT 里的 `chatgpt_account_id` → `chatgpt-account-id` |
| 其它头 | `OpenAI-Beta: responses=experimental`，`originator: gcode` |

---

**Grok Build** is SpaceXAI's terminal-based AI coding agent. It runs as a
full-screen TUI that understands your codebase, edits files, executes shell
commands, searches the web, and manages long-running tasks — interactively,
headlessly for scripting/CI, or embedded in editors via the Agent Client
Protocol (ACP).

[Installing the released binary](#installing-the-released-binary) ·
[Building from source](#building-from-source) ·
[Documentation](#documentation) ·
[Repository layout](#repository-layout) ·
[Development](#development) ·
[Contributing](#contributing) ·
[License](#license)


![Grok Build TUI](https://media.x.ai/v1/website/universe-tui-screenshot-6f7a0837.png)

**Learn more about the original Grok Build at [x.ai/cli](https://x.ai/cli)**

A small `SOURCE_REV` file at the root records the full monorepo commit SHA
for the version of the code present in this tree.

---

## Installing the released binary

每次 push 到 `main` 会自动构建，并更新 [Releases](https://github.com/yuzhi535/gcode/releases) 里的 **`latest`** 滚动发布。当前提供：

| 平台 | 产物 |
|------|------|
| macOS Apple Silicon | `gcode-macos-arm64.tar.gz` |
| Linux x86_64 | `gcode-linux-x86_64.tar.gz` |

### macOS (Apple Silicon)

```sh
curl -fsSL -o gcode.tar.gz \
  https://github.com/yuzhi535/gcode/releases/download/latest/gcode-macos-arm64.tar.gz
tar -xzf gcode.tar.gz
chmod +x gcode
sudo mv gcode /usr/local/bin/gcode   # 或放到任意在 PATH 里的目录
gcode --version
```

若 macOS 提示「无法验证开发者」：

```sh
xattr -dr com.apple.quarantine "$(command -v gcode)"
```

### Linux (x86_64)

```sh
curl -fsSL -o gcode.tar.gz \
  https://github.com/yuzhi535/gcode/releases/download/latest/gcode-linux-x86_64.tar.gz
tar -xzf gcode.tar.gz
chmod +x gcode
sudo mv gcode /usr/local/bin/gcode
gcode --version
```

### 指定版本

打了 `v*` tag 后会额外生成正式 release。把上面 URL 里的 `latest` 换成 tag 即可，例如：

```sh
# 示例
https://github.com/yuzhi535/gcode/releases/download/v0.1.0/gcode-macos-arm64.tar.gz
```

也可以在 Releases 页面手动下载：https://github.com/yuzhi535/gcode/releases

### 官方原版

如需 SpaceXAI 官方构建（二进制名为 `grok`）：

- 安装脚本：https://x.ai/cli/install.sh
- Changelog：https://x.ai/build/changelog

## Building from source

Requirements:

- **Rust** — the toolchain is pinned by [`rust-toolchain.toml`](rust-toolchain.toml);
  `rustup` installs it automatically on first build.
- **[DotSlash](https://dotslash-cli.com)** — required so hermetic tools under
  [`bin/`](bin/) (notably [`bin/protoc`](bin/protoc)) can download and run.
  Install it and ensure `dotslash` is on your `PATH` **before** building:

  ```sh
  cargo install dotslash
  # or: prebuilt packages — https://dotslash-cli.com/docs/installation/
  /usr/bin/env dotslash --help   # sanity check
  ```

- **protoc** — proto codegen resolves [`bin/protoc`](bin/protoc) via DotSlash,
  or falls back to a `protoc` on `PATH` / `$PROTOC`.
- macOS and Linux are supported build hosts; Windows builds are best-effort
  and not currently tested from this tree.

```sh
cargo run -p xai-grok-pager-bin              # build + launch the TUI (`gcode`)
cargo build -p xai-grok-pager-bin --release  # release binary: target/release/gcode
cargo check -p xai-grok-pager-bin            # fast validation
```

The binary artifact is named `gcode`. It opens directly to the main TUI and the
bundled multi-provider configuration does not require a Grok/xAI login. Supply
the credential required by the model you select instead. `/login`, `gcode login`,
and `--force-login` remain available when you explicitly want a Grok session.
Its user-level state and configuration default to `~/.gcode`; set `GCODE_HOME` to
use a different location (`GROK_HOME` remains accepted for compatibility). See the
[authentication guide](crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md).

## Documentation

Full online documentation is available at
[docs.x.ai/build/overview](https://docs.x.ai/build/overview).

The user guide ships with the pager crate:
[`crates/codegen/xai-grok-pager/docs/user-guide/`](crates/codegen/xai-grok-pager/docs/user-guide/)
— getting started, keyboard shortcuts, slash commands, configuration, theming,
MCP servers, skills, plugins, hooks, headless mode, sandboxing, and more.

## Repository layout

| Path | Contents |
|------|----------|
| `crates/codegen/xai-grok-pager-bin` | Composition-root package; builds the `gcode` binary |
| `crates/codegen/xai-grok-pager` | The TUI: scrollback, prompt, modals, rendering |
| `crates/codegen/xai-grok-shell` | Agent runtime + leader/stdio/headless entry points |
| `crates/codegen/xai-grok-tools` | Tool implementations (terminal, file edit, search, ...) |
| `crates/codegen/xai-grok-workspace` | Host filesystem, VCS, execution, checkpoints |
| `crates/codegen/...` | The rest of the CLI crate closure (config, MCP, markdown, sandbox, ...) |
| `crates/common/`, `crates/build/`, `prod/mc/` | Small shared leaf crates pulled in by the closure |
| `third_party/` | Vendored upstream source (Mermaid diagram stack) — see below |

> [!IMPORTANT]
> The root `Cargo.toml` (workspace members, dependency versions, lints,
> profiles) is **generated** — treat it as read-only. Prefer editing per-crate
> `Cargo.toml` files.

## Development

```sh
cargo check -p <crate>        # always target specific crates; full-workspace builds are slow
cargo test -p xai-grok-config # per-crate tests
cargo clippy -p <crate>       # lint config: clippy.toml at the repo root
cargo fmt --all               # rustfmt.toml at the repo root
```

## Contributing

> [!NOTE]
> This is a personal rebuilt fork of the original project.  
> For the upstream project, see the original SpaceXAI repository.  
> Issues and PRs related to the custom CI/release setup are welcome here.

## License

First-party code in this repository is licensed under the **Apache License,
Version 2.0** — see [`LICENSE`](LICENSE).

Third-party and vendored code remains under its original licenses. See:

- [`THIRD-PARTY-NOTICES`](THIRD-PARTY-NOTICES) — crates.io / git dependencies,
  bundled UI themes, and **in-tree source ports** (including openai/codex and
  sst/opencode tool implementations)
- [`crates/codegen/xai-grok-tools/THIRD_PARTY_NOTICES.md`](crates/codegen/xai-grok-tools/THIRD_PARTY_NOTICES.md)
  — crate-local notice for the codex and opencode ports (license texts +
  Apache §4(b) change notice)
- [`third_party/NOTICE`](third_party/NOTICE) — vendored Mermaid-stack index
