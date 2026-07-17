<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://media.x.ai/v1/website/spacexai-symbol-white-transparent-0c31957f.png">
    <source media="(prefers-color-scheme: light)" srcset="https://media.x.ai/v1/website/spacexai-symbol-black-transparent-6435cf42.png">
    <img alt="SpaceXAI logo" src="https://media.x.ai/v1/website/spacexai-symbol-black-transparent-6435cf42.png" width="96">
  </picture>
  <br>
  Grok Build (<code>gork</code>)
</h1>

> **注意**：这是由 [yuzhi535](https://github.com/yuzhi535) 重新构建和维护的版本（rebuilt fork）。  
> 基于原 SpaceXAI Grok Build 项目，增加了 GitHub Actions 自动构建流程（每次 commit 自动构建，并发布到 Releases，支持 Mac）。

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

> This is a personal rebuilt fork. See the note at the top of this README.

A small `SOURCE_REV` file at the root records the full monorepo commit SHA
for the version of the code present in this tree.

</div>

---

## Installing the released binary

每次 push 到 `main` 会自动构建，并更新 [Releases](https://github.com/yuzhi535/grok-cli/releases) 里的 **`latest`** 滚动发布。当前提供：

| 平台 | 产物 |
|------|------|
| macOS Apple Silicon | `gork-macos-arm64.tar.gz` |
| Linux x86_64 | `gork-linux-x86_64.tar.gz` |

### macOS (Apple Silicon)

```sh
curl -fsSL -o gork.tar.gz \
  https://github.com/yuzhi535/grok-cli/releases/download/latest/gork-macos-arm64.tar.gz
tar -xzf gork.tar.gz
chmod +x gork
sudo mv gork /usr/local/bin/gork   # 或放到任意在 PATH 里的目录
gork --version
```

若 macOS 提示「无法验证开发者」：

```sh
xattr -dr com.apple.quarantine "$(command -v gork)"
```

### Linux (x86_64)

```sh
curl -fsSL -o gork.tar.gz \
  https://github.com/yuzhi535/grok-cli/releases/download/latest/gork-linux-x86_64.tar.gz
tar -xzf gork.tar.gz
chmod +x gork
sudo mv gork /usr/local/bin/gork
gork --version
```

### 指定版本

打了 `v*` tag 后会额外生成正式 release。把上面 URL 里的 `latest` 换成 tag 即可，例如：

```sh
# 示例
https://github.com/yuzhi535/grok-cli/releases/download/v0.1.0/gork-macos-arm64.tar.gz
```

也可以在 Releases 页面手动下载：https://github.com/yuzhi535/grok-cli/releases

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
cargo run -p xai-grok-pager-bin              # build + launch the TUI (`gork`)
cargo build -p xai-grok-pager-bin --release  # release binary: target/release/gork
cargo check -p xai-grok-pager-bin            # fast validation
```

The binary artifact is named `gork`. It opens directly to the main TUI; sign in
only when needed with `/login`, `gork login`, or `--force-login`. Its user-level
state and configuration default to `~/.gork`; set `GORK_HOME` to use a different
location (`GROK_HOME` remains accepted for compatibility). See the
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
| `crates/codegen/xai-grok-pager-bin` | Composition-root package; builds the `gork` binary |
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
