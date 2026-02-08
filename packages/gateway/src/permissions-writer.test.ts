import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncPermissions, clearPermissions } from "./permissions-writer.js";

describe("permissions-writer", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-permissions-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, "openclaw.json");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("syncPermissions", () => {
    it("should create docker.binds from readPaths and writePaths", () => {
      // Create minimal config
      writeFileSync(configPath, JSON.stringify({}, null, 2), "utf-8");

      syncPermissions(
        {
          readPaths: ["/home/user/docs", "/var/log"],
          writePaths: ["/home/user/projects"],
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.agents.defaults.sandbox.docker.binds).toEqual([
        "/home/user/docs:/home/user/docs:ro",
        "/var/log:/var/log:ro",
        "/home/user/projects:/home/user/projects:rw",
      ]);
    });

    it("should deduplicate paths (prefer rw over ro)", () => {
      writeFileSync(configPath, JSON.stringify({}, null, 2), "utf-8");

      syncPermissions(
        {
          readPaths: ["/home/user/shared"],
          writePaths: ["/home/user/shared"], // Same path in both
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      // Should only have one bind mount, with rw mode
      expect(config.agents.defaults.sandbox.docker.binds).toEqual([
        "/home/user/shared:/home/user/shared:rw",
      ]);
    });

    it("should set workspaceAccess to rw if not already set", () => {
      writeFileSync(configPath, JSON.stringify({}, null, 2), "utf-8");

      syncPermissions(
        {
          readPaths: ["/home/user/docs"],
          writePaths: [],
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.agents.defaults.sandbox.workspaceAccess).toBe("rw");
    });

    it("should preserve existing workspaceAccess if already set", () => {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                sandbox: {
                  workspaceAccess: "ro",
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      syncPermissions(
        {
          readPaths: ["/home/user/docs"],
          writePaths: [],
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.agents.defaults.sandbox.workspaceAccess).toBe("ro");
    });

    it("should preserve other docker config fields", () => {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                sandbox: {
                  docker: {
                    image: "custom-image:latest",
                    network: "none",
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      syncPermissions(
        {
          readPaths: ["/home/user/docs"],
          writePaths: [],
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.agents.defaults.sandbox.docker.image).toBe(
        "custom-image:latest",
      );
      expect(config.agents.defaults.sandbox.docker.network).toBe("none");
      expect(config.agents.defaults.sandbox.docker.binds).toEqual([
        "/home/user/docs:/home/user/docs:ro",
      ]);
    });

    it("should preserve other top-level config fields", () => {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            gateway: {
              port: 18789,
              auth: { mode: "token", token: "secret" },
            },
            plugins: {
              "test-plugin": {},
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      syncPermissions(
        {
          readPaths: ["/home/user/docs"],
          writePaths: [],
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.gateway.port).toBe(18789);
      expect(config.gateway.auth.token).toBe("secret");
      expect(config.plugins["test-plugin"]).toEqual({});
    });

    it("should handle empty permissions (create empty binds array)", () => {
      writeFileSync(configPath, JSON.stringify({}, null, 2), "utf-8");

      syncPermissions(
        {
          readPaths: [],
          writePaths: [],
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.agents.defaults.sandbox.docker.binds).toEqual([]);
    });

    it("should update existing binds", () => {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                sandbox: {
                  docker: {
                    binds: ["/old/path:/old/path:ro"],
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      syncPermissions(
        {
          readPaths: ["/new/path"],
          writePaths: [],
        },
        configPath,
      );

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      // Should replace old binds
      expect(config.agents.defaults.sandbox.docker.binds).toEqual([
        "/new/path:/new/path:ro",
      ]);
    });

    it("should handle config file not existing gracefully", () => {
      const nonExistentPath = join(testDir, "does-not-exist.json");

      // Should not throw
      expect(() => {
        syncPermissions(
          {
            readPaths: ["/home/user/docs"],
            writePaths: [],
          },
          nonExistentPath,
        );
      }).not.toThrow();
    });
  });

  describe("clearPermissions", () => {
    it("should remove binds from docker config", () => {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                sandbox: {
                  docker: {
                    binds: ["/home/user/docs:/home/user/docs:ro"],
                    image: "custom-image:latest",
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      clearPermissions(configPath);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.agents.defaults.sandbox.docker.binds).toBeUndefined();
      // Should preserve other docker fields
      expect(config.agents.defaults.sandbox.docker.image).toBe(
        "custom-image:latest",
      );
    });

    it("should remove empty docker object after clearing binds", () => {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                sandbox: {
                  docker: {
                    binds: ["/home/user/docs:/home/user/docs:ro"],
                  },
                  workspaceAccess: "rw",
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      clearPermissions(configPath);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.agents.defaults.sandbox.docker).toBeUndefined();
      // Should preserve other sandbox fields
      expect(config.agents.defaults.sandbox.workspaceAccess).toBe("rw");
    });

    it("should handle config file not existing gracefully", () => {
      const nonExistentPath = join(testDir, "does-not-exist.json");

      // Should not throw
      expect(() => {
        clearPermissions(nonExistentPath);
      }).not.toThrow();
    });

    it("should preserve other top-level config fields", () => {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            gateway: {
              port: 18789,
            },
            agents: {
              defaults: {
                sandbox: {
                  docker: {
                    binds: ["/home/user/docs:/home/user/docs:ro"],
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      clearPermissions(configPath);

      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(config.gateway.port).toBe(18789);
    });
  });
});
