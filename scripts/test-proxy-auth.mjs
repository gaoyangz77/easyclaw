#!/usr/bin/env node
/**
 * Test authenticated proxy functionality.
 * Tests both valid and invalid credentials.
 */

import { Socket } from "node:net";

const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 8888;
const TARGET = "api.openai.com:443";

async function testProxy(username, password, description) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Testing: ${description}`);

    const socket = new Socket();
    let response = "";

    socket.connect(PROXY_PORT, PROXY_HOST, () => {
      let request = `CONNECT ${TARGET} HTTP/1.1\r\n`;
      request += `Host: ${TARGET}\r\n`;

      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        request += `Proxy-Authorization: Basic ${auth}\r\n`;
      }

      request += "\r\n";
      socket.write(request);
    });

    socket.on("data", (data) => {
      response += data.toString();
      const headerEnd = response.indexOf("\r\n\r\n");

      if (headerEnd !== -1) {
        const statusLine = response.split("\r\n")[0];
        console.log(`   Response: ${statusLine}`);

        if (statusLine.includes("200")) {
          console.log("   ✅ Success - Connection established");
        } else if (statusLine.includes("407")) {
          console.log("   ❌ Failed - Proxy authentication required");
        } else {
          console.log(`   ⚠️  Unexpected response`);
        }

        socket.end();
        resolve();
      }
    });

    socket.on("error", (err) => {
      console.log(`   ❌ Error: ${err.message}`);
      resolve();
    });

    setTimeout(() => {
      console.log("   ⏱️  Timeout");
      socket.destroy();
      resolve();
    }, 3000);
  });
}

async function runTests() {
  console.log("🔐 Testing authenticated proxy (make sure test-proxy.mjs is running on port 8888)");

  await testProxy(null, null, "No authentication");
  await testProxy("wronguser", "wrongpass", "Invalid credentials");
  await testProxy("testuser", "wrongpass", "Valid user, wrong password");
  await testProxy("testuser", "testpass", "Valid credentials");

  console.log("\n✅ Tests completed");
}

runTests();
