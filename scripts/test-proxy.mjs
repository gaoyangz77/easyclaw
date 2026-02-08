#!/usr/bin/env node
/**
 * Simple HTTP CONNECT proxy for testing.
 * Logs all requests passing through without modifying them.
 *
 * Usage:
 *   node scripts/test-proxy.mjs [port]
 *
 * Default port: 8888
 * Authentication: username=testuser, password=testpass
 */

import { createServer, Socket } from "node:net";

const PORT = process.argv[2] ? parseInt(process.argv[2], 10) : 8888;

// Test credentials (hardcoded for testing)
const AUTH_USER = "testuser";
const AUTH_PASS = "testpass";
const stats = {
  connections: 0,
  activeConnections: 0,
  byHost: {},
};

function log(message, ...args) {
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[${timestamp}]`, message, ...args);
}

function logStats() {
  log(`📊 Stats: ${stats.connections} total, ${stats.activeConnections} active`);
  const sorted = Object.entries(stats.byHost)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (sorted.length > 0) {
    log("  Top hosts:", sorted.map(([host, count]) => `${host} (${count})`).join(", "));
  }
}

const server = createServer((clientSocket) => {
  stats.connections++;
  stats.activeConnections++;

  let buffer = Buffer.alloc(0);
  let targetHost = null;
  let targetPort = null;

  const cleanup = () => {
    stats.activeConnections--;
  };

  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Parse HTTP CONNECT request
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const headerStr = buffer.subarray(0, headerEnd).toString("utf-8");
    const lines = headerStr.split("\r\n");
    const requestLine = lines[0];

    if (!requestLine) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      cleanup();
      return;
    }

    const match = requestLine.match(/^CONNECT\s+([^:\s]+):(\d+)\s+HTTP/);
    if (!match) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      cleanup();
      return;
    }

    targetHost = match[1];
    targetPort = parseInt(match[2], 10);

    // Check for Proxy-Authorization header
    const authHeader = lines.find(line => line.toLowerCase().startsWith("proxy-authorization:"));
    if (!authHeader) {
      log(`❌ Missing authentication for ${targetHost}:${targetPort}`);
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Test Proxy\"\r\n\r\n");
      cleanup();
      return;
    }

    // Parse Basic auth
    const authMatch = authHeader.match(/^Proxy-Authorization:\s*Basic\s+(.+)$/i);
    if (!authMatch) {
      log(`❌ Invalid auth format for ${targetHost}:${targetPort}`);
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Test Proxy\"\r\n\r\n");
      cleanup();
      return;
    }

    const credentials = Buffer.from(authMatch[1], "base64").toString("utf-8");
    const [username, password] = credentials.split(":");

    if (username !== AUTH_USER || password !== AUTH_PASS) {
      log(`❌ Invalid credentials (${username}:***) for ${targetHost}:${targetPort}`);
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Test Proxy\"\r\n\r\n");
      cleanup();
      return;
    }

    log(`✅ Authenticated as ${username} for ${targetHost}:${targetPort}`);

    // Track stats
    stats.byHost[targetHost] = (stats.byHost[targetHost] || 0) + 1;

    log(`🔗 CONNECT ${targetHost}:${targetPort}`);

    clientSocket.off("data", onData);

    // Connect to target with raw TCP (NOT TLS - client handles that through the tunnel)
    const targetSocket = new Socket();

    targetSocket.connect(targetPort, targetHost, () => {
      log(`✅ Connected to ${targetHost}:${targetPort}`);
      // Send success response
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

      // Pipe bidirectionally
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);

      // Track data transfer
      let bytesIn = 0;
      let bytesOut = 0;

      targetSocket.on("data", (chunk) => {
        bytesIn += chunk.length;
      });

      clientSocket.on("data", (chunk) => {
        bytesOut += chunk.length;
      });

      const onClose = () => {
        log(`🔚 Closed ${targetHost}:${targetPort} (↑${bytesOut} ↓${bytesIn} bytes)`);
        cleanup();
        targetSocket.removeAllListeners();
        clientSocket.removeAllListeners();
      };

      targetSocket.on("end", onClose);
      targetSocket.on("error", onClose);
      clientSocket.on("end", onClose);
      clientSocket.on("error", onClose);
    });

    targetSocket.on("error", (err) => {
      log(`❌ Failed to connect to ${targetHost}:${targetPort}:`, err.message);
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      cleanup();
    });
  };

  clientSocket.on("data", onData);
  clientSocket.on("error", (err) => {
    log("❌ Client socket error:", err.message);
    cleanup();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  log(`🚀 Test proxy listening on http://127.0.0.1:${PORT}`);
  log(`   Authentication required: ${AUTH_USER}:${AUTH_PASS}`);
  log("");
  log("   Set this as your upstream proxy in EasyClaw provider settings:");
  log(`   - Without auth: http://127.0.0.1:${PORT}`);
  log(`   - With auth:    http://${AUTH_USER}:${AUTH_PASS}@127.0.0.1:${PORT}`);
  log("");
});

// Print stats every 10 seconds
setInterval(logStats, 10000);

// Graceful shutdown
process.on("SIGINT", () => {
  log("\n👋 Shutting down...");
  logStats();
  server.close(() => {
    process.exit(0);
  });
});
