"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const smokeFile = path.resolve("workspace", "smoke-test.drawio");
const smokeExport = path.resolve("workspace", "smoke-test.drawio.svg");
const backupDir = path.resolve("workspace", "backups");

fs.rmSync(smokeFile, { force: true });
fs.rmSync(smokeExport, { force: true });
fs.rmSync(backupDir, { recursive: true, force: true });

const child = spawn(process.execPath, ["src/server.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    DRAWIO_MCP_NO_OPEN: "1",
    DRAWIO_MCP_FILE: smokeFile,
    DRAWIO_EXE: path.resolve("workspace", "missing-drawio.exe")
  },
  windowsHide: true
});

let stdout = Buffer.alloc(0);
let stderr = "";

child.stdout.on("data", chunk => {
  stdout = Buffer.concat([stdout, chunk]);
});

child.stderr.on("data", chunk => {
  stderr += chunk.toString();
});

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

function parseMessages(buffer) {
  const text = buffer.toString("utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function waitFor(predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const messages = parseMessages(stdout);
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for response.\nstderr=${stderr}`);
}

function responseText(message) {
  return message.result.content.map(item => item.text || "").join("\n");
}

function assertTextIncludes(message, pattern) {
  const output = responseText(message);
  if (!output.includes(pattern)) {
    throw new Error(`Expected response to include ${pattern}.\nResponse:\n${output}`);
  }
}

(async () => {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "local-drawio-smoke", version: "1.0.0" }
    }
  });
  await waitFor(message => message.id === 1);

  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = await waitFor(message => message.id === 2);
  const names = tools.result.tools.map(tool => tool.name);
  for (const name of ["start_session", "create_new_diagram", "get_diagram", "edit_diagram", "export_diagram"]) {
    if (!names.includes(name)) {
      throw new Error(`Missing tool: ${name}`);
    }
  }

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "create_new_diagram",
      arguments: {
        xml: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Smoke" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>'
      }
    }
  });
  const create = await waitFor(message => message.id === 3);
  assertTextIncludes(create, "Backup: not needed");

  send({
    jsonrpc: "2.0",
    id: 31,
    method: "tools/call",
    params: {
      name: "create_new_diagram",
      arguments: {
        xml: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Smoke again" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>'
      }
    }
  });
  const secondCreate = await waitFor(message => message.id === 31);
  assertTextIncludes(secondCreate, "before-create.drawio");

  send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "edit_diagram",
      arguments: {
        operations: [{
          operation: "update",
          cell_id: "2",
          new_xml: '<mxCell id="2" value="Smoke OK" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>'
        }]
      }
    }
  });
  const edit = await waitFor(message => message.id === 4);
  assertTextIncludes(edit, "before-edit.drawio");

  send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "export_diagram",
      arguments: {
        path: smokeExport,
        format: "png"
      }
    }
  });
  const mismatch = await waitFor(message => message.id === 5);
  if (!mismatch.result || mismatch.result.isError !== true || !responseText(mismatch).includes("Export format mismatch")) {
    throw new Error(`Expected export format mismatch error.\nResponse:\n${JSON.stringify(mismatch, null, 2)}`);
  }

  const backups = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter(name => name.endsWith(".drawio"))
    : [];
  if (backups.length < 2) {
    throw new Error(`Expected at least 2 backup files, found ${backups.length}.`);
  }

  console.log("Smoke test passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  child.kill();
});
