"use strict";

const { spawn } = require("node:child_process");

const child = spawn(process.execPath, ["src/server.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    DRAWIO_MCP_NO_OPEN: "1",
    DRAWIO_MCP_FILE: "workspace/smoke-test.drawio"
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
  await waitFor(message => message.id === 3);

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
  await waitFor(message => message.id === 4);

  console.log("Smoke test passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  child.kill();
});
