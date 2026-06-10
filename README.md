# Local Draw.io MCP

这是一个面向本机 Draw.io 桌面版的 MCP Server。它让 Codex 可以通过 MCP 工具创建、读取、增删改 `.drawio` 图，并把图导出为 `png`、`svg`、`pdf`、`jpg` 等格式。

当前默认适配 Windows 上的 Draw.io 安装路径：

```text
D:\Program Files (x86)\Draw.io\draw.io.exe
```

默认工作文件：

```text
D:\Draw-workspace\current.drawio
```

工作文件故意放在不带空格的目录中，避免 Draw.io 桌面版处理 `Program Files (x86)` 这类路径时出现参数拆分问题。

## 功能

- 在本机 Draw.io 桌面版中打开当前工作图。
- 从 `mxGraphModel` 或 `.drawio`/`mxfile` XML 创建新图。
- 读取当前 `.drawio` XML，方便 Codex 基于现有图继续修改。
- 通过 cell id 对图元执行 `add`、`update`、`delete`。
- 导出当前图为 `.drawio`、`.xml`、`.png`、`.svg`、`.pdf`、`.jpg`。
- 支持用环境变量覆盖 Draw.io 路径和工作文件路径。

## 环境要求

- Windows。
- Node.js 18 或更高版本。
- 已安装 Draw.io 桌面版。
- Codex Desktop 或其他支持 stdio MCP Server 的客户端。

## 安装

克隆仓库后进入项目目录：

```powershell
git clone git@github.com:CycSpring/draw.io-use.git
cd draw.io-use
npm install
```

如果是在本机已经存在的目录中使用，直接安装依赖即可：

```powershell
cd "D:\Program Files (x86)\Draw.io\draw.io-mcp"
npm install
```

运行 smoke test：

```powershell
npm test
```

测试会启动 MCP Server，检查工具列表，并创建/修改一份临时图。测试时会设置 `DRAWIO_MCP_NO_OPEN=1`，不会弹出 Draw.io 窗口。

## 在 Codex 中配置

推荐把本项目作为本地 MCP Server 添加到 Codex：

```powershell
codex mcp add drawio -- node "D:\Program Files (x86)\Draw.io\draw.io-mcp\src\server.js"
```

添加后重启 Codex，或重新打开会话，让 MCP 工具刷新。可用工具会以 `mcp__drawio__...` 的形式出现，例如：

- `mcp__drawio__start_session`
- `mcp__drawio__create_new_diagram`
- `mcp__drawio__get_diagram`
- `mcp__drawio__edit_diagram`
- `mcp__drawio__export_diagram`

如果你的项目目录不是上面的默认路径，把命令里的 `src\server.js` 改成实际路径。

## Codex 中的典型用法

### 1. 打开当前图

让 Codex 调用：

```text
start_session
```

它会确保默认工作文件存在，并用本机 Draw.io 打开：

```text
D:\Draw-workspace\current.drawio
```

你可以在 Draw.io 里手动调整图，保存后 Codex 再调用 `get_diagram` 或 `edit_diagram` 会继续基于同一个文件操作。

### 2. 从 XML 创建新图

让 Codex 调用：

```text
create_new_diagram
```

参数示例：

```xml
<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="1" pageWidth="800" pageHeight="600">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="node-1" value="入口" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
      <mxGeometry x="80" y="80" width="120" height="60" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

服务会把传入的 `mxGraphModel` 包装成 `.drawio` 的 `mxfile` 格式，并写入默认工作文件。

### 3. 读取当前图

让 Codex 调用：

```text
get_diagram
```

它会返回当前 `.drawio` XML。建议在编辑已有图之前先读取一次，避免覆盖你刚在桌面版里手动保存的内容。

### 4. 按 cell id 修改图

让 Codex 调用：

```text
edit_diagram
```

参数结构：

```json
{
  "operations": [
    {
      "operation": "update",
      "cell_id": "node-1",
      "new_xml": "<mxCell id=\"node-1\" value=\"入口服务\" style=\"rounded=1;whiteSpace=wrap;html=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"80\" y=\"80\" width=\"140\" height=\"60\" as=\"geometry\"/></mxCell>"
    }
  ]
}
```

支持的操作：

- `add`：新增一个 cell，`cell_id` 不能已存在，必须提供 `new_xml`。
- `update`：替换一个已存在的 cell，必须提供 `new_xml`。
- `delete`：删除一个 cell，如果 id 不存在会跳过。

注意：`new_xml` 必须是完整的 `<mxCell ...>` 元素。服务会用 `cell_id` 覆盖 `new_xml` 中的 `id`，以保证操作目标一致。

### 5. 导出图片或文件

让 Codex 调用：

```text
export_diagram
```

参数示例：

```json
{
  "path": "D:\\Draw-workspace\\exports\\architecture.png",
  "format": "png"
}
```

可选格式：

- `drawio`
- `xml`
- `png`
- `svg`
- `pdf`
- `jpg`

如果 `format` 不传，会根据 `path` 的扩展名推断。导出 `.drawio` 或 `.xml` 时会直接复制当前工作文件；导出图片/PDF 时会调用 Draw.io 桌面版的命令行导出能力。

## 环境变量

可以用环境变量覆盖默认路径：

```powershell
$env:DRAWIO_EXE = "D:\Program Files (x86)\Draw.io\draw.io.exe"
$env:DRAWIO_MCP_WORKSPACE = "D:\Draw-workspace"
$env:DRAWIO_MCP_FILE = "D:\Draw-workspace\current.drawio"
node "D:\Program Files (x86)\Draw.io\draw.io-mcp\src\server.js"
```

支持的变量：

- `DRAWIO_EXE`：Draw.io 桌面版可执行文件路径。
- `DRAWIO_MCP_WORKSPACE`：默认工作目录。未设置时为 `D:\Draw-workspace`。
- `DRAWIO_MCP_FILE`：当前工作 `.drawio` 文件。未设置时为 `DRAWIO_MCP_WORKSPACE\current.drawio`。
- `DRAWIO_MCP_NO_OPEN`：设置为 `1` 时不自动打开 Draw.io，适合测试或无界面环境。

如果要在 Codex MCP 配置中使用自定义路径，可以通过启动命令设置环境变量，例如：

```powershell
codex mcp add drawio -- powershell -NoProfile -Command "$env:DRAWIO_MCP_FILE='D:\Draw-workspace\project-a.drawio'; node 'D:\Program Files (x86)\Draw.io\draw.io-mcp\src\server.js'"
```

## 本地开发

启动 MCP Server：

```powershell
npm start
```

运行测试：

```powershell
npm test
```

项目结构：

```text
.
├── README.md
├── package.json
├── scripts
│   └── smoke-test.js
└── src
    └── server.js
```

核心逻辑在 `src/server.js`：

- 使用 `@modelcontextprotocol/sdk` 提供 stdio MCP Server。
- 使用 `fast-xml-parser` 解析和构建 Draw.io XML。
- 使用 Node.js `zlib` 处理 `.drawio` 内部压缩 diagram 内容。
- 使用 Draw.io 桌面版命令行参数执行导出。

## 注意事项

- 编辑图之前建议先调用 `get_diagram`，尤其是你刚在 Draw.io 桌面版里手动保存过图时。
- `create_new_diagram` 会覆盖当前工作文件，请确认不需要保留旧图，或先用 `export_diagram` 导出备份。
- `edit_diagram` 是基于 cell id 的结构化替换，不会自动重新布局。需要复杂排版时，可以让 Codex 先读取当前 XML，再生成完整 cell 坐标。
- 手动在 Draw.io 中修改后要保存，否则 MCP 读取到的仍然是上一次保存的文件内容。
- 导出 `png`、`svg`、`pdf`、`jpg` 依赖 Draw.io 桌面版存在且可执行；如果只导出 `.drawio` 或 `.xml`，不需要调用 Draw.io 导出器。
- 路径里建议少用特殊字符。默认工作区使用 `D:\Draw-workspace`，就是为了减少 Windows 命令行路径问题。
- 这个 MCP Server 操作的是本机文件，不会自动上传到云端或 GitHub。
- 多个 Codex 会话同时操作同一个 `DRAWIO_MCP_FILE` 时，后保存的一方可能覆盖先保存的一方。并行画图时建议给每个项目设置独立文件。

## 常见问题

### Codex 里看不到 drawio 工具

确认已经执行 `codex mcp add drawio -- ...`，然后重启 Codex 或重新打开会话。也可以检查 MCP 配置里的 `server.js` 路径是否真实存在。

### 调用 `start_session` 报 Draw.io 不存在

检查 `DRAWIO_EXE` 是否指向真实的 `draw.io.exe`：

```powershell
Test-Path "D:\Program Files (x86)\Draw.io\draw.io.exe"
```

如果你的安装位置不同，请设置 `DRAWIO_EXE`。

### 导出图片失败

先确认 Draw.io 桌面版可以正常启动，再检查输出目录是否可写。`export_diagram` 会自动创建输出目录，但目标磁盘或目录仍需要有写入权限。

### 中文显示异常

Draw.io XML 中的中文通常可以正常保存。若导出的图片字体效果不一致，请在 Draw.io 中使用本机已安装字体，并避免依赖远程字体。

## 许可证

ISC
