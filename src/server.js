#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const zlib = require("node:zlib");
const { XMLBuilder, XMLParser } = require("fast-xml-parser");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

const WORKSPACE_DIR = process.env.DRAWIO_MCP_WORKSPACE || "D:\\Draw-workspace";
const DEFAULT_FILE = process.env.DRAWIO_MCP_FILE || path.join(WORKSPACE_DIR, "current.drawio");
const SUPPORTED_EXPORT_FORMATS = new Set(["drawio", "xml", "png", "svg", "pdf", "jpg"]);

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
  fs.mkdirSync(path.dirname(DEFAULT_FILE), { recursive: true });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function drawioCandidates() {
  return unique([
    process.env.DRAWIO_EXE,
    "D:\\Program Files (x86)\\Draw.io\\draw.io.exe",
    "D:\\Program Files\\Draw.io\\draw.io.exe",
    "D:\\Draw-io\\draw.io\\draw.io.exe",
    "D:\\Program Files\\draw.io\\draw.io.exe",
    "D:\\Program Files (x86)\\draw.io\\draw.io.exe",
    "C:\\Program Files\\draw.io\\draw.io.exe",
    "C:\\Program Files (x86)\\draw.io\\draw.io.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "draw.io", "draw.io.exe"),
    path.join(process.env.ProgramFiles || "", "draw.io", "draw.io.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "draw.io", "draw.io.exe")
  ]);
}

function resolveDrawioExe() {
  const candidates = drawioCandidates();
  if (process.env.DRAWIO_EXE) {
    return {
      path: process.env.DRAWIO_EXE,
      checked: candidates,
      exists: fs.existsSync(process.env.DRAWIO_EXE)
    };
  }

  const found = candidates.find(candidate => fs.existsSync(candidate));
  return { path: found || null, checked: candidates, exists: Boolean(found) };
}

function missingDrawioMessage(resolved) {
  const checked = resolved.checked.map(candidate => `- ${candidate}`).join("\n");
  if (process.env.DRAWIO_EXE) {
    return [
      `Draw.io executable from DRAWIO_EXE was not found: ${process.env.DRAWIO_EXE}`,
      "",
      "Fix: set DRAWIO_EXE to the full path of draw.io.exe.",
      "",
      "Checked paths:",
      checked
    ].join("\n");
  }

  return [
    "Draw.io executable was not found.",
    "",
    "Fix: set DRAWIO_EXE to the full path of draw.io.exe, for example:",
    '$env:DRAWIO_EXE="D:\\Program Files (x86)\\Draw.io\\draw.io.exe"',
    "",
    "Checked paths:",
    checked
  ].join("\n");
}

function requireDrawioExe() {
  const resolved = resolveDrawioExe();
  if (!resolved.exists) {
    throw new Error(missingDrawioMessage(resolved));
  }
  return resolved.path;
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
  return `<mxfile host="Electron" modified="${new Date().toISOString()}" agent="local-drawio-mcp" version="30.0.4" type="device"><diagram id="local-page-1" name="Page-1">${compressed}</diagram></mxfile>`;
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

function backupCurrentFile(reason) {
  if (!fs.existsSync(DEFAULT_FILE)) {
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(path.dirname(DEFAULT_FILE), "backups");
  const baseName = path.basename(DEFAULT_FILE, path.extname(DEFAULT_FILE));
  const backupPath = path.join(backupDir, `${baseName}.${timestamp}.before-${reason}.drawio`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(DEFAULT_FILE, backupPath);
  return backupPath;
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
  const drawioExe = requireDrawioExe();
  const child = spawn(drawioExe, [filePath], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
}

function preflightDrawioOpen() {
  if (process.env.DRAWIO_MCP_NO_OPEN !== "1") {
    requireDrawioExe();
  }
}

function runDrawioExport(inputPath, outputPath) {
  const drawioExe = requireDrawioExe();
  return new Promise((resolve, reject) => {
    const child = spawn(drawioExe, ["-x", "-o", outputPath, inputPath], {
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
    child.on("error", error => {
      reject(new Error(`draw.io export failed to start.\nExecutable: ${drawioExe}\nInput: ${inputPath}\nOutput: ${outputPath}\nError: ${error.message}`));
    });
    child.on("close", code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`draw.io export failed with code ${code}.\nExecutable: ${drawioExe}\nInput: ${inputPath}\nOutput: ${outputPath}\nOutput:\n${stderr || stdout}`));
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

function resolveExportFormat(outputPath, format) {
  const ext = path.extname(outputPath).slice(1).toLowerCase();
  const finalFormat = (format || ext || "drawio").toLowerCase();

  if (!SUPPORTED_EXPORT_FORMATS.has(finalFormat)) {
    throw new Error(`Unsupported export format: ${finalFormat}. Supported formats: ${[...SUPPORTED_EXPORT_FORMATS].join(", ")}.`);
  }

  if (format && ext && ext !== finalFormat) {
    throw new Error(`Export format mismatch: path extension is .${ext}, but format is ${finalFormat}. Use a matching extension or omit format.`);
  }

  return finalFormat;
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
  const resolved = resolveDrawioExe();
  return text(`Local Draw.io opened.\n\nFile: ${DEFAULT_FILE}\nDraw.io: ${resolved.path || "not found"}`);
});

server.registerTool("create_new_diagram", {
  description: "Create a new diagram from mxGraphModel or mxfile XML, save it locally, and open it in Draw.io.",
  inputSchema: {
    xml: z.string().min(1).describe("Complete mxGraphModel or mxfile XML.")
  }
}, async ({ xml }) => {
  const wrapped = wrapMxGraphModel(xml);
  preflightDrawioOpen();
  const backupPath = backupCurrentFile("create");
  writeCurrentXml(wrapped);
  launchDrawio(DEFAULT_FILE);
  return text(`Local diagram created and opened.\n\nFile: ${DEFAULT_FILE}\nBackup: ${backupPath || "not needed"}\nXML length: ${wrapped.length}`);
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
  const backupPath = backupCurrentFile("edit");
  writeCurrentXml(after);
  return text(`Local diagram updated.\n\nApplied ${operations.length} operation(s).\nFile: ${DEFAULT_FILE}\nBackup: ${backupPath || "not needed"}`);
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

  const finalFormat = resolveExportFormat(resolved, format);

  if (finalFormat === "drawio" || finalFormat === "xml") {
    fs.copyFileSync(DEFAULT_FILE, resolved);
  } else {
    await runDrawioExport(DEFAULT_FILE, resolved);
  }

  return text(`Export complete: ${resolved}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const resolved = resolveDrawioExe();
  console.error(`local-drawio-mcp running. file=${DEFAULT_FILE} drawio=${resolved.path || "not found"}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
