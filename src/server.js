#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const zlib = require("node:zlib");
const { XMLBuilder, XMLParser } = require("fast-xml-parser");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_DIR = process.env.DRAWIO_MCP_WORKSPACE || "D:\\Draw-workspace";
const DEFAULT_FILE = process.env.DRAWIO_MCP_FILE || path.join(WORKSPACE_DIR, "current.drawio");
const DRAWIO_EXE = process.env.DRAWIO_EXE || "D:\\Program Files (x86)\\Draw.io\\draw.io.exe";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  preserveOrder: false
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  format: true,
  suppressEmptyNode: true
});

function text(message) {
  return { content: [{ type: "text", text: message }] };
}

function ensureWorkspace() {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

function blankModel() {
  return '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="800" pageHeight="600" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
}

function normalizeGraphModel(xml) {
  const trimmed = xml.trim();
  if (trimmed.startsWith("<mxGraphModel")) {
    return trimmed;
  }

  const doc = parseXml(trimmed);
  const model = getDiagramModel(doc);
  return buildXml({ mxGraphModel: model });
}

function encodeCompressedDiagramText(modelXml) {
  const encoded = encodeURIComponent(modelXml);
  return zlib.deflateRawSync(Buffer.from(encoded, "utf8")).toString("base64");
}

function wrapMxGraphModel(xml) {
  const modelXml = normalizeGraphModel(xml);
  const compressed = encodeCompressedDiagramText(modelXml);
  return `<mxfile host="Electron" modified="${new Date().toISOString()}" agent="local-drawio-mcp" version="30.0.4" type="device"><diagram id="local-page-1" name="第 1 页">${compressed}</diagram></mxfile>`;
}

function ensureCurrentFile() {
  ensureWorkspace();
  if (!fs.existsSync(DEFAULT_FILE)) {
    fs.writeFileSync(DEFAULT_FILE, wrapMxGraphModel(blankModel()), "utf8");
  }
}

function readCurrentXml() {
  ensureCurrentFile();
  return fs.readFileSync(DEFAULT_FILE, "utf8");
}

function writeCurrentXml(xml) {
  ensureWorkspace();
  fs.writeFileSync(DEFAULT_FILE, xml, "utf8");
}

function parseXml(xml) {
  return parser.parse(xml);
}

function buildXml(obj) {
  return builder.build(obj);
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function decodeCompressedDiagramText(textValue) {
  const compact = String(textValue || "").trim();
  if (!compact) {
    return null;
  }

  try {
    const inflated = zlib.inflateRawSync(Buffer.from(compact, "base64")).toString("utf8");
    return decodeURIComponent(inflated.replace(/\+/g, "%20"));
  } catch (_error) {
    return null;
  }
}

function getDiagramModel(doc) {
  if (doc.mxGraphModel) {
    return doc.mxGraphModel;
  }
  const diagrams = asArray(doc.mxfile && doc.mxfile.diagram);
  if (diagrams.length === 0) {
    throw new Error("No diagram found in .drawio XML.");
  }
  const first = diagrams[0];
  if (first.mxGraphModel) {
    return first.mxGraphModel;
  }
  if (typeof first["#text"] === "string") {
    const textModel = first["#text"].trim().startsWith("<")
      ? first["#text"]
      : decodeCompressedDiagramText(first["#text"]);
    if (textModel) {
      const parsed = parseXml(textModel);
      if (parsed.mxGraphModel) {
        return parsed.mxGraphModel;
      }
    }
  }
  throw new Error("No mxGraphModel found in first diagram.");
}

function setDiagramModel(doc, model) {
  if (doc.mxGraphModel) {
    doc.mxGraphModel = model;
    return doc;
  }
  const diagrams = asArray(doc.mxfile && doc.mxfile.diagram);
  if (diagrams.length === 0) {
    throw new Error("No diagram found in .drawio XML.");
  }
  diagrams[0].mxGraphModel = model;
  delete diagrams[0]["#text"];
  doc.mxfile.diagram = Array.isArray(doc.mxfile.diagram) ? diagrams : diagrams[0];
  return doc;
}

function getCells(model) {
  if (!model.root) {
    model.root = {};
  }
  const cells = asArray(model.root.mxCell);
  model.root.mxCell = cells;
  return cells;
}

function parseCellXml(xml) {
  const parsed = parseXml(xml.trim());
  if (!parsed.mxCell) {
    throw new Error("new_xml must contain a complete mxCell element.");
  }
  return parsed.mxCell;
}

function cellId(cell) {
  return String(cell.id || "");
}

function applyOperations(xml, operations) {
  const doc = parseXml(xml);
  const model = getDiagramModel(doc);
  const cells = getCells(model);
  const indexById = new Map(cells.map((cell, index) => [cellId(cell), index]));

  for (const op of operations) {
    if (!op || !op.operation || !op.cell_id) {
      throw new Error("Each operation requires operation and cell_id.");
    }

    const id = String(op.cell_id);
    if (op.operation === "delete") {
      if (indexById.has(id)) {
        const idx = indexById.get(id);
        cells.splice(idx, 1);
        indexById.clear();
        cells.forEach((cell, index) => indexById.set(cellId(cell), index));
      }
      continue;
    }

    if (!op.new_xml) {
      throw new Error(`${op.operation} operation for ${id} requires new_xml.`);
    }
    const newCell = parseCellXml(op.new_xml);
    newCell.id = id;

    if (op.operation === "add") {
      if (indexById.has(id)) {
        throw new Error(`Cannot add cell ${id}; it already exists.`);
      }
      cells.push(newCell);
      indexById.set(id, cells.length - 1);
      continue;
    }

    if (op.operation === "update") {
      if (!indexById.has(id)) {
        throw new Error(`Cannot update missing cell ${id}.`);
      }
      cells[indexById.get(id)] = newCell;
      continue;
    }

    throw new Error(`Unsupported operation: ${op.operation}`);
  }

  setDiagramModel(doc, model);
  return buildXml(doc);
}

function launchDrawio(filePath) {
  if (process.env.DRAWIO_MCP_NO_OPEN === "1") {
    return;
  }
  if (!fs.existsSync(DRAWIO_EXE)) {
    throw new Error(`Draw.io executable not found: ${DRAWIO_EXE}`);
  }
  const child = spawn(DRAWIO_EXE, [filePath], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
}

function runDrawioExport(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(DRAWIO_EXE, ["-x", "-o", outputPath, inputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`draw.io export failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

function resolveOutputPath(outputPath) {
  if (!outputPath) {
    throw new Error("path is required.");
  }
  return path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
}

const server = new McpServer({
  name: "local-drawio-mcp",
  version: "1.0.0"
});

server.registerTool("start_session", {
  description: "Open the current .drawio file in the locally installed Draw.io desktop app.",
  inputSchema: {}
}, async () => {
  ensureCurrentFile();
  launchDrawio(DEFAULT_FILE);
  return text(`本地 Draw.io 已打开。\n\n工作文件: ${DEFAULT_FILE}\nDraw.io: ${DRAWIO_EXE}`);
});

server.registerTool("create_new_diagram", {
  description: "Create a new diagram from mxGraphModel or mxfile XML, save it locally, and open it in Draw.io.",
  inputSchema: {
    xml: z.string().min(1).describe("Complete mxGraphModel or mxfile XML.")
  }
}, async ({ xml }) => {
  const wrapped = wrapMxGraphModel(xml);
  writeCurrentXml(wrapped);
  launchDrawio(DEFAULT_FILE);
  return text(`图已写入本地 Draw.io 文件并打开。\n\n工作文件: ${DEFAULT_FILE}\nXML length: ${wrapped.length}`);
});

server.registerTool("get_diagram", {
  description: "Read the current local .drawio file XML.",
  inputSchema: {}
}, async () => {
  const xml = readCurrentXml();
  return text(`Current local diagram XML:\n\n${xml}`);
});

server.registerTool("edit_diagram", {
  description: "Edit the current local .drawio file by ID-based add/update/delete operations. get_diagram is recommended but not required.",
  inputSchema: {
    operations: z.array(z.object({
      operation: z.enum(["add", "update", "delete"]),
      cell_id: z.string(),
      new_xml: z.string().optional()
    })).min(1)
  }
}, async ({ operations }) => {
  const before = readCurrentXml();
  const after = applyOperations(before, operations);
  writeCurrentXml(after);
  return text(`本地图已更新。\n\nApplied ${operations.length} operation(s).\n工作文件: ${DEFAULT_FILE}`);
});

server.registerTool("export_diagram", {
  description: "Export the current local .drawio file. .drawio copies XML; png/svg/pdf/jpg use the local Draw.io exporter.",
  inputSchema: {
    path: z.string().min(1),
    format: z.enum(["drawio", "png", "svg", "pdf", "jpg", "xml"]).optional()
  }
}, async ({ path: outputPath, format }) => {
  ensureCurrentFile();
  const resolved = resolveOutputPath(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const ext = path.extname(resolved).slice(1).toLowerCase();
  const finalFormat = format || ext || "drawio";

  if (finalFormat === "drawio" || finalFormat === "xml") {
    fs.copyFileSync(DEFAULT_FILE, resolved);
  } else {
    await runDrawioExport(DEFAULT_FILE, resolved);
  }

  return text(`导出完成: ${resolved}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`local-drawio-mcp running. file=${DEFAULT_FILE}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
