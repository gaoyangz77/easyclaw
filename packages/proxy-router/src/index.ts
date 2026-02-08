import { createServer, type Server as NetServer, type Socket } from "node:net";
import { readFileSync, existsSync, watch, type FSWatcher } from "node:fs";
import { ProxyAgent } from "undici";
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
   */
  async stop(): Promise<void> {
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
    }

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
   * Connect to target via upstream proxy.
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

    // Connect to upstream proxy
    const proxySocket = new (await import("node:net")).Socket();

    await new Promise<void>((resolve, reject) => {
      proxySocket.connect(proxyPort, proxyHost, () => resolve());
      proxySocket.on("error", reject);
    });

    // Send CONNECT request to upstream proxy
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
   * Connect to target directly without proxy.
   */
  private async connectDirect(
    clientSocket: Socket,
    targetHost: string,
    targetPort: number,
  ): Promise<void> {
    // Create raw TCP connection to target (NOT TLS - client handles that through the tunnel)
    const targetSocket = new (await import("node:net")).Socket();

    await new Promise<void>((resolve, reject) => {
      targetSocket.connect(targetPort, targetHost, () => resolve());
      targetSocket.on("error", reject);
    });

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

export * from "./types.js";
