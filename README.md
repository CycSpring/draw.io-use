# Local Draw.io MCP

本项目提供一个本地 Draw.io MCP 服务，使用已安装的桌面版：

`D:\Program Files (x86)\Draw.io\draw.io.exe`

服务会维护默认工作文件：

`D:\Draw-workspace\current.drawio`

默认工作文件放在不带空格的目录里，避免 Draw.io 桌面版打开 `Program Files (x86)` 这类路径时把参数拆坏。

## Tools

- `start_session`: 用本地 Draw.io 打开当前工作文件。
- `create_new_diagram`: 写入新的 `mxGraphModel`/`mxfile`，并打开本地 Draw.io。
- `get_diagram`: 读取当前本地 `.drawio` XML。
- `edit_diagram`: 按 cell id 增删改当前图。建议先读图，但不强制。
- `export_diagram`: 导出 `.drawio`、`.png`、`.svg`、`.pdf`、`.jpg`。

如果你在桌面版 Draw.io 里手动调整了图，保存后 MCP 会继续读取同一个工作文件并在此基础上编辑。

## Codex MCP

```powershell
codex mcp add drawio -- node "D:\Program Files (x86)\Draw.io\draw.io-mcp\src\server.js"
```

添加后重启 Codex，或重新打开会话，让 MCP 工具刷新。

## Claude Code MCP

本服务是标准 stdio MCP Server，Claude Code 也可以直接使用：

```powershell
claude mcp add drawio -- node "D:\Program Files (x86)\Draw.io\draw.io-mcp\src\server.js"
```

可以用下面命令检查连接状态：

```powershell
claude mcp get drawio
```

## Codex 自动安装

当用户在 Codex 里说“@CycSpring/draw.io-use 给我装上这个 MCP”时，可以按下面流程安装：

```powershell
$repo = "$env:USERPROFILE\.codex\mcp\draw.io-use"
New-Item -ItemType Directory -Force (Split-Path $repo) | Out-Null

if (Test-Path "$repo\.git") {
  git -C $repo pull
} else {
  git clone https://github.com/CycSpring/draw.io-use.git $repo
}

npm --prefix $repo install
codex mcp add drawio -- node "$repo\src\server.js"
```

如果已经存在同名 `drawio` MCP，先移除旧配置或更新为新的 `server.js` 路径。

## 在 Codex 里怎么用

可以直接用自然语言让 Codex 画图、改图、导出图，例如：

- “用 drawio 画一个三层架构图，并打开让我检查。”
- “读取当前 Draw.io 图，把网关模块改成 API Gateway。”
- “在现有图里加一个 Redis 节点，连到后端服务。”
- “把当前图导出成 `D:\Draw-workspace\exports\architecture.png`。”
- “把当前图导出成 `D:\Draw-workspace\current.drawio.png`，我想直接看 PNG 预览。”

常见协作流程：

1. 让 Codex 调用 `create_new_diagram` 生成第一版图。
2. 在 Draw.io 桌面版里手动微调并保存。
3. 让 Codex 调用 `get_diagram` 读取最新文件。
4. 继续让 Codex 用 `edit_diagram` 做局部修改，或用 `export_diagram` 导出成图片/PDF。

注意：`create_new_diagram` 会覆盖当前工作文件；如果要保留旧图，先导出或复制一份。
