import { createServer, Socket, type Server as NetServer } from "node:net";
import { readFileSync, existsSync, watch, type FSWatcher } from "node:fs";
import { createLogger } from "@easyclaw/logger";
import type { ProxyRouterConfig, ProxyRouterOptions } from "./types.js";

const log = createLogger("proxy-router");

/**
 * Local proxy router that routes requests to different upstream proxies
 * based on domain name and current provider key configuration.
 */
export class ProxyRouter {
  private server: NetServer | null = null;
  private config: ProxyRouterConfig | null = null;
  private configWatcher: FSWatcher | null = null;
  private options: Required<ProxyRouterOptions>;
  private activeSockets = new Set<Socket>();

  constructor(options: ProxyRouterOptions) {
    this.options = {
      port: options.port ?? 9999,
      configPath: options.configPath,
      onConfigReload: options.onConfigReload ?? (() => {}),
    };
  }

  /**
   * Start the proxy router server.
   */
  async start(): Promise<void> {
    // Load initial config
    this.loadConfig();

    // Watch config file for changes
    this.watchConfig();

    // Create HTTP CONNECT proxy server
    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.options.port, "127.0.0.1", () => {
        log.info(`Proxy router listening on 127.0.0.1:${this.options.port}`);
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  /**
   * Stop the proxy router server.
   * Destroys all active connections so server.close() resolves immediately.
   */
  async stop(): Promise<void> {
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }

    // Destroy all active piped connections so server.close() doesn't hang
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          log.info("Proxy router stopped");
          resolve();
        });
      });
      this.server = null;
    }
  }

  /**
   * Load configuration from disk.
   */
  private loadConfig(): void {
    try {
      if (!existsSync(this.options.configPath)) {
        log.warn(`Config file not found: ${this.options.configPath}`);
        this.config = null;
        return;
      }

      const content = readFileSync(this.options.configPath, "utf-8");
      this.config = JSON.parse(content) as ProxyRouterConfig;
      log.info("Config loaded successfully", {
        providers: Object.keys(this.config.activeKeys).length,
        domains: Object.keys(this.config.domainToProvider).length,
        systemProxy: this.config.systemProxy ?? "(none)",
      });
      this.options.onConfigReload(this.config);
    } catch (err) {
      log.error("Failed to load config", err);
      this.config = null;
    }
  }

  /**
   * Watch config file for changes and reload.
   */
  private watchConfig(): void {
    try {
      this.configWatcher = watch(this.options.configPath, (eventType) => {
        if (eventType === "change") {
          log.debug("Config file changed, reloading...");
          this.loadConfig();
        }
      });
    } catch (err) {
      log.warn("Failed to watch config file", err);
    }
  }

  /**
   * Handle incoming proxy connection.
   */
  private handleConnection(clientSocket: Socket): void {
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Parse HTTP CONNECT request
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return; // Wait for complete headers

      const headerStr = buffer.subarray(0, headerEnd).toString("utf-8");
      const lines = headerStr.split("\r\n");
      const requestLine = lines[0];

      if (!requestLine) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }

      const match = requestLine.match(/^CONNECT\s+([^:\s]+):(\d+)\s+HTTP/);
      if (!match) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }

      const [, targetHost, targetPortStr] = match;
      const targetPort = parseInt(targetPortStr ?? "443", 10);

      clientSocket.off("data", onData);
      this.handleConnect(clientSocket, targetHost ?? "", targetPort);
    };

    clientSocket.on("data", onData);
    clientSocket.on("error", (err) => {
      log.debug("Client socket error", err);
    });
  }

  /**
   * Handle CONNECT request by routing to upstream proxy or direct connection.
   */
  private async handleConnect(
    clientSocket: Socket,
    targetHost: string,
    targetPort: number,
  ): Promise<void> {
    this.activeSockets.add(clientSocket);
    const cleanup = () => { this.activeSockets.delete(clientSocket); };
    clientSocket.on("close", cleanup);

    try {
      const upstreamProxyUrl = this.resolveProxy(targetHost);

      if (upstreamProxyUrl) {
        // Route through upstream proxy
        await this.connectViaProxy(clientSocket, targetHost, targetPort, upstreamProxyUrl);
      } else {
        // Direct connection
        await this.connectDirect(clientSocket, targetHost, targetPort);
      }
    } catch (err) {
      log.error("Connection failed", { targetHost, targetPort, error: err });
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    }
  }

  /**
   * Resolve which upstream proxy to use based on target domain.
   */
  private resolveProxy(targetHost: string): string | null {
    if (!this.config) {
      log.debug("No config loaded, using direct connection");
      return null;
    }

    // Look up provider by domain
    const provider = this.config.domainToProvider[targetHost];
    if (!provider) {
      log.debug(`No provider mapping for ${targetHost}, using direct connection`);
      return null;
    }

    // Get active key for provider
    const activeKeyId = this.config.activeKeys[provider];
    if (!activeKeyId) {
      log.debug(`No active key for provider ${provider}, using direct connection`);
      return null;
    }

    // Get proxy for key
    const proxyUrl = this.config.keyProxies[activeKeyId];
    if (!proxyUrl) {
      log.debug(`No proxy configured for key ${activeKeyId}, using direct connection`);
      return null;
    }

    log.debug(`Routing ${targetHost} → ${provider} → key ${activeKeyId} → ${proxyUrl.replace(/\/\/[^:]+:[^@]+@/, '//*****:*****@')}`);
    return proxyUrl;
  }

  /**
   * Connect to a host:port, routing through the system proxy if configured.
   * Returns a connected Socket that reaches the given host.
   */
  private async connectToHost(host: string, port: number): Promise<Socket> {
    const systemProxy = this.config?.systemProxy;
    if (!systemProxy) {
      // Direct TCP connection
      const socket = new Socket();
      await new Promise<void>((resolve, reject) => {
        socket.connect(port, host, () => resolve());
        socket.on("error", reject);
      });
      return socket;
    }

    const proxyUrl = new URL(systemProxy);
    const proxyHost = proxyUrl.hostname;
    const proxyPort = parseInt(proxyUrl.port || "1080", 10);
    const scheme = proxyUrl.protocol.replace(":", "");

    if (scheme === "socks5" || scheme === "socks") {
      return this.connectViaSocks5(host, port, proxyHost, proxyPort);
    }

    // Default: HTTP CONNECT tunnel through system proxy
    return this.connectViaHttpConnect(host, port, proxyHost, proxyPort);
  }

  /**
   * Establish a tunnel to host:port through an HTTP proxy using CONNECT.
   */
  private async connectViaHttpConnect(
    targetHost: string,
    targetPort: number,
    proxyHost: string,
    proxyPort: number,
  ): Promise<Socket> {
    const socket = new Socket();
    await new Promise<void>((resolve, reject) => {
      socket.connect(proxyPort, proxyHost, () => resolve());
      socket.on("error", reject);
    });

    socket.write(
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${targetHost}:${targetPort}\r\n\r\n`,
    );

    await new Promise<void>((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const end = buf.indexOf("\r\n\r\n");
        if (end !== -1) {
          socket.off("data", onData);
          const resp = buf.subarray(0, end).toString("utf-8");
          if (resp.includes("200")) {
            resolve();
          } else {
            reject(new Error(`System HTTP proxy refused CONNECT: ${resp}`));
          }
        }
      };
      socket.on("data", onData);
      socket.on("error", reject);
    });

    return socket;
  }

  /**
   * Connect to host:port through a SOCKS5 proxy.
   */
  private async connectViaSocks5(
    targetHost: string,
    targetPort: number,
    proxyHost: string,
    proxyPort: number,
  ): Promise<Socket> {
    const socket = new Socket();
    await new Promise<void>((resolve, reject) => {
      socket.connect(proxyPort, proxyHost, () => resolve());
      socket.on("error", reject);
    });

    // Greeting: SOCKS5, 1 auth method, no-auth
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await readBytes(socket, 2);
    if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
      socket.destroy();
      throw new Error("SOCKS5 handshake failed (unsupported auth method)");
    }

    // Connect request: version=5, cmd=connect, rsv=0, atype=domain
    const hostBuf = Buffer.from(targetHost, "utf-8");
    const req = Buffer.alloc(4 + 1 + hostBuf.length + 2);
    req[0] = 0x05;
    req[1] = 0x01;
    req[2] = 0x00;
    req[3] = 0x03; // domain name
    req[4] = hostBuf.length;
    hostBuf.copy(req, 5);
    req.writeUInt16BE(targetPort, 5 + hostBuf.length);
    socket.write(req);

    // Read connect response header (4 bytes: ver, rep, rsv, atype)
    const resp = await readBytes(socket, 4);
    if (resp[0] !== 0x05 || resp[1] !== 0x00) {
      socket.destroy();
      throw new Error(`SOCKS5 connect failed (reply code: ${resp[1]})`);
    }

    // Drain the bound address based on address type
    const atype = resp[3];
    if (atype === 0x01) {
      await readBytes(socket, 4 + 2); // IPv4 (4) + port (2)
    } else if (atype === 0x04) {
      await readBytes(socket, 16 + 2); // IPv6 (16) + port (2)
    } else if (atype === 0x03) {
      const lenBuf = await readBytes(socket, 1);
      await readBytes(socket, lenBuf[0] + 2); // domain (len) + port (2)
    }

    return socket;
  }

  /**
   * Connect to target via upstream per-key proxy.
   * If a system proxy is configured, the connection to the per-key proxy
   * is itself routed through the system proxy (proxy chaining).
   */
  private async connectViaProxy(
    clientSocket: Socket,
    targetHost: string,
    targetPort: number,
    upstreamProxyUrl: string,
  ): Promise<void> {
    const proxyUrl = new URL(upstreamProxyUrl);
    const proxyHost = proxyUrl.hostname;
    const proxyPort = parseInt(proxyUrl.port || "8080", 10);
    const proxyAuth = proxyUrl.username
      ? `${proxyUrl.username}:${proxyUrl.password}`
      : null;

    // Connect to per-key proxy (routed through system proxy if configured)
    const proxySocket = await this.connectToHost(proxyHost, proxyPort);

    // Send CONNECT request to per-key proxy for the final target
    let connectRequest = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`;
    connectRequest += `Host: ${targetHost}:${targetPort}\r\n`;
    if (proxyAuth) {
      const authBase64 = Buffer.from(proxyAuth).toString("base64");
      connectRequest += `Proxy-Authorization: Basic ${authBase64}\r\n`;
    }
    connectRequest += "\r\n";

    proxySocket.write(connectRequest);

    // Wait for proxy response
    await new Promise<void>((resolve, reject) => {
      let responseBuffer = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        const headerEnd = responseBuffer.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          proxySocket.off("data", onData);
          const response = responseBuffer.subarray(0, headerEnd).toString("utf-8");
          if (response.includes("200")) {
            resolve();
          } else {
            reject(new Error(`Upstream proxy refused connection: ${response}`));
          }
        }
      };
      proxySocket.on("data", onData);
      proxySocket.on("error", reject);
    });

    // Tunnel established, send success to client
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    // Pipe data bidirectionally
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);

    proxySocket.on("error", () => {
      clientSocket.end();
    });
    clientSocket.on("error", () => {
      proxySocket.end();
    });
  }

  /**
   * Connect to target directly (no per-key proxy).
   * If a system proxy is configured, the connection is routed through it.
   */
  private async connectDirect(
    clientSocket: Socket,
    targetHost: string,
    targetPort: number,
  ): Promise<void> {
    const targetSocket = await this.connectToHost(targetHost, targetPort);

    // Tunnel established, send success to client
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    // Pipe data bidirectionally
    targetSocket.pipe(clientSocket);
    clientSocket.pipe(targetSocket);

    targetSocket.on("error", () => {
      clientSocket.end();
    });
    clientSocket.on("error", () => {
      targetSocket.end();
    });
  }
}

/**
 * Read exactly `n` bytes from a socket.
 */
function readBytes(socket: Socket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= n) {
        socket.off("data", onData);
        socket.off("error", onErr);
        resolve(buf.subarray(0, n));
        // If there are leftover bytes, push them back
        if (buf.length > n) {
          socket.unshift(buf.subarray(n));
        }
      }
    };
    const onErr = (err: Error) => {
      socket.off("data", onData);
      reject(err);
    };
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

export * from "./types.js";
