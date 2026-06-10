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
