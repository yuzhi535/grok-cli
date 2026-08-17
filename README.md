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

> **Gcode** 是专门承载 CatPaw 模型的 Grok Build harness。界面、上下文、计划、权限、工具、文件编辑和 diff 都由 Gcode 管理；CatPaw 只负责模型推理与提出工具调用。

</div>

---

## 职责边界

| 能力 | 所有者 |
|------|------|
| TUI、执行页、工具卡、文件 diff | Gcode |
| 上下文、计划、权限、工具执行 | Gcode |
| 模型路由与推理 | CatPaw |
| CatPaw ACP Agent | 不进入执行链路 |

### CatPaw 模型

发布包只展示已经做过真实身份验真的 12 个 CatPaw 模型，包括 GPT-5.6 Sol/Terra/Luna、LongCat 2.0、Claude Opus 4.8/4.6、GLM、Kimi、MiniMax 和 DeepSeek。默认模型是 `catpaw-gpt-5.6-sol`。

本地 loopback gateway 会把 Gcode function tools 映射成 CatPaw client-owned tools。CatPaw 返回调用后，由 Gcode 执行，再通过 `turn-end` 把结果交回模型。默认采用严格验真：CatPaw 历史记录中的实际模型身份通过后，内容才会进入 Gcode。

认证从 `CATPAW_COOKIE` 或官方 `~/.catpaw/sso_config.json` 加载。SSO 不写入 Gcode 配置，也不会进入发往 loopback gateway 的 Bearer header。

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

每次 push 到 `catpaw-gork` 会自动构建并发布不可变 prerelease。发布包需要本机已有 Node.js 20 或更高版本。当前提供：

| 平台 | 产物 |
|------|------|
| macOS Apple Silicon | `gcode-macos-arm64.tar.gz` |
| Linux x86_64 | `gcode-linux-x86_64.tar.gz` |

### macOS (Apple Silicon)

```sh
curl -fsSL -o gcode.tar.gz \
  https://github.com/yuzhi535/gcode/releases/download/<tag>/gcode-macos-arm64.tar.gz
mkdir -p "$HOME/.local/share/gcode" "$HOME/.local/bin"
tar -xzf gcode.tar.gz -C "$HOME/.local/share/gcode"
ln -sfn "$HOME/.local/share/gcode/gcode" "$HOME/.local/bin/gcode"
gcode --version
```

若 macOS 提示「无法验证开发者」：

```sh
xattr -dr com.apple.quarantine "$HOME/.local/share/gcode"
```

### Linux (x86_64)

```sh
curl -fsSL -o gcode.tar.gz \
  https://github.com/yuzhi535/gcode/releases/download/<tag>/gcode-linux-x86_64.tar.gz
mkdir -p "$HOME/.local/share/gcode" "$HOME/.local/bin"
tar -xzf gcode.tar.gz -C "$HOME/.local/share/gcode"
ln -sfn "$HOME/.local/share/gcode/gcode" "$HOME/.local/bin/gcode"
gcode --version
```

### 指定版本

在 `catpaw-gork` 分支打 `gcode-v*` tag 后会额外生成正式 release，例如：

```sh
# 示例
https://github.com/yuzhi535/gcode/releases/download/gcode-v0.1.0/gcode-macos-arm64.tar.gz
```

也可以在 Releases 页面手动下载：https://github.com/yuzhi535/gcode/releases

### 通过 Gcode 渠道升级

```sh
gcode update --check
gcode update
```

每个 GitHub 构建都会把唯一的 Gcode release 版本写入发布包。更新器只读取
`yuzhi535/gcode` 的 GitHub Releases，下载整个平台包，校验随包发布的
SHA-256，运行 smoke test 后再原子切换 `~/.local/bin/gcode`。它不会查询
Grok 的 npm、x.ai 或 GCS 更新渠道。

Gcode 发布包关闭了原版 core-only 自动更新，因为只替换 Rust core 会导致
launcher、CatPaw gateway 和模型配置版本不一致。需要升级时使用上面的
`gcode update`，整套组件会一起升级。

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
cargo build -p xai-grok-pager-bin --release  # release core: target/release/gcode
cargo check -p xai-grok-pager-bin            # fast validation
```

The GitHub archive wraps the compiled `gcode-core` with a Node launcher that installs the CatPaw managed model catalog and starts the loopback gateway for inference commands. User state lives under `~/.gcode`; set `GCODE_HOME` to use another directory. Legacy `GORK_HOME` and `GROK_HOME` remain accepted as input compatibility aliases.

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
| `crates/codegen/xai-grok-pager-bin` | Composition-root package; builds `gcode-core` |
| `catpaw-gateway` | Loopback model adapter, launcher, and CatPaw-only catalog |
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
