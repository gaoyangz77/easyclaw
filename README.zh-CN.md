<p align="center">
  <img src="website/site/assets/LOGO_CN_BOY_COMPACT.png" width="300" alt="爪爪">
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

## 为什么需要 EasyClaw？

[OpenClaw](https://github.com/openclaw/openclaw) 是一个强大的 Agent 运行时——但它是为工程师设计的。使用它意味着编辑配置文件、管理进程、在终端中操作 API 密钥。对于非程序员（设计师、运营、财务、小企业主）来说，这个门槛太高了。

EasyClaw 把 OpenClaw 封装成一个**人人都能用的桌面应用**：安装后从系统托盘启动，通过本地 Web 面板管理一切。用自然语言写规则而不是写代码，点几下就能配置 LLM 服务商和消息通道，让 Agent 在交互中逐渐理解你的偏好。无需终端。

**一句话：** OpenClaw 是引擎，EasyClaw 是驾驶舱。

## 功能特性

- **自然语言规则**：用自然语言编写规则——它们会编译为策略、守卫或技能，并立即生效（无需重启）
- **多服务商 LLM 支持**：支持 15+ 个服务商（OpenAI、Anthropic、DeepSeek、智谱、Moonshot、通义千问等），具备多密钥管理和区域感知默认值
- **按服务商配置代理**：为每个 LLM 服务商或 API 密钥配置 HTTP/SOCKS5 代理，支持自动路由和热重载——对受限地区至关重要
- **多账号通道支持**：通过界面配置 Telegram、Discord、Slack、WhatsApp 等，密钥安全存储（Keychain/DPAPI）
- **Token 用量追踪**：按模型和服务商实时统计，自动从 OpenClaw 会话文件刷新
- **语音消息支持**：根据地区自动选择合适的语音识别服务
- **可视化权限控制**：通过界面控制文件读写权限
- **零重启更新**：API 密钥和代理变更通过热重载立即生效——无需重启网关
- **本地优先与隐私保护**：所有数据保存在本地；密钥永不以明文存储
- **自动更新**：客户端更新检查器，静态清单托管

### 文件权限的工作原理

EasyClaw 通过 OpenClaw 插件在工具调用*执行前*拦截并验证文件路径。具体保护范围：

- **文件访问工具**（`read`、`write`、`edit`、`image`、`apply-patch`）：完全受保护——路径会根据你配置的权限进行验证
- **命令执行工具**（`exec`、`process`）：验证工作目录，但无法检查命令字符串*内部*的路径（如 `cat /etc/passwd`）

**覆盖率**：约 85-90% 的文件访问场景。如需最大安全性，可考虑通过规则限制或禁用 `exec` 工具。

**技术说明**：文件权限插件使用 OpenClaw 的 `before_tool_call` 钩子——无需修改上游源代码，因此 EasyClaw 可以干净地拉取 OpenClaw 更新。

## 环境要求

| 工具    | 版本       |
| ------- | ---------- |
| Node.js | >= 22.12.0 |
| pnpm    | 10.6.2     |

## 快速开始

```bash
pnpm install
pnpm build
pnpm --filter @easyclaw/desktop dev
```

启动 Electron 托盘应用后，它会拉起 OpenClaw 网关并在 `http://localhost:3210` 提供管理面板。

## 仓库结构

```
easyclaw/
├── apps/
│   ├── desktop/          # Electron 托盘应用（主进程）
│   └── panel/            # React 管理界面（由 desktop 提供服务）
├── packages/
│   ├── core/             # 共享类型 & Zod schemas
│   ├── gateway/          # 网关生命周期、配置写入、密钥注入
│   ├── logger/           # 结构化日志（tslog）
│   ├── storage/          # SQLite 持久化（better-sqlite3）
│   ├── rules/            # 规则编译 & Skill 文件写入
│   ├── secrets/          # Keychain / DPAPI / 文件密钥存储
│   ├── updater/          # 自动更新客户端
│   ├── stt/              # 语音转文字抽象层
│   └── openclaw-plugin/  # OpenClaw 插件 SDK
├── extensions/
│   ├── dingtalk/         # 钉钉通道集成
│   └── wecom/            # 企业微信通道集成
├── scripts/
│   └── release.sh        # 构建安装包 + 更新网站
├── vendor/
│   └── openclaw/         # 内置的 OpenClaw（gitignored）
└── website/              # 静态站点 + nginx/docker 托管发布
```

## 工作区

Monorepo 使用 pnpm workspaces（`apps/*`、`packages/*`、`extensions/*`），通过 [Turbo](https://turbo.build) 编排构建。所有包通过 [tsdown](https://github.com/nicolo-ribaudo/tsdown) 输出 ESM。

### 应用

| 包                  | 说明                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| `@easyclaw/desktop` | Electron 35 托盘应用。管理网关生命周期，在端口 3210 托管面板服务，数据存储于 SQLite。   |
| `@easyclaw/panel`   | React 19 + Vite 6 SPA。包含规则、服务商、通道、权限、用量页面，以及首次启动引导向导。  |

### 包

| 包                          | 说明                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@easyclaw/core`            | Zod 校验类型：`Rule`、`ChannelConfig`、`PermissionConfig`、`ModelConfig`，LLM 服务商定义（OpenAI、Anthropic、DeepSeek、智谱、Moonshot、通义千问），区域感知默认值。 |
| `@easyclaw/gateway`         | `GatewayLauncher`（支持指数退避的启动/停止/重启）、配置写入器、从系统密钥链注入密钥、Skills 目录监听实现热重载。                |
| `@easyclaw/logger`          | 基于 tslog 的日志模块。写入 `~/.easyclaw/logs/`。                                                                              |
| `@easyclaw/storage`         | 基于 better-sqlite3 的 SQLite 存储。包含规则、产物、通道、权限、设置的 Repository，内置迁移系统。数据库位于 `~/.easyclaw/easyclaw.db`。 |
| `@easyclaw/rules`           | 规则编译、Skill 生命周期（激活/停用）、Skill 文件写入器（将规则具象化为 OpenClaw 的 SKILL.md 文件）。                           |
| `@easyclaw/secrets`         | 平台感知的密钥存储。macOS Keychain、文件回退方案、测试用内存存储。                                                             |
| `@easyclaw/updater`         | 检查网站上的 `update-manifest.json`，通知用户新版本。                                                                          |
| `@easyclaw/stt`             | 语音转文字服务商抽象层。                                                                                                       |
| `@easyclaw/openclaw-plugin` | OpenClaw 插件 SDK 集成。                                                                                                       |

## 脚本

所有根目录脚本通过 Turbo 运行：

```bash
pnpm build        # 构建所有包（遵循依赖图）
pnpm dev          # 以开发模式运行 desktop + panel
pnpm test         # 运行所有测试（vitest）
pnpm lint         # 检查所有包（oxlint）
pnpm format       # 检查格式（oxfmt）
pnpm format:fix   # 自动修复格式
```

### 单包命令

```bash
# Desktop
pnpm --filter @easyclaw/desktop dev        # 以开发模式启动 Electron
pnpm --filter @easyclaw/desktop build      # 打包主进程
pnpm --filter @easyclaw/desktop test       # 运行 desktop 测试
pnpm --filter @easyclaw/desktop dist:mac   # 构建 macOS DMG（universal）
pnpm --filter @easyclaw/desktop dist:win   # 构建 Windows NSIS 安装包

# Panel
pnpm --filter @easyclaw/panel dev          # Vite 开发服务器
pnpm --filter @easyclaw/panel build        # 生产构建

# 任意包
pnpm --filter @easyclaw/core test
pnpm --filter @easyclaw/gateway test
```

## 架构

```
┌─────────────────────────────────────────┐
│  系统托盘（Electron 主进程）             │
│  ├── GatewayLauncher → vendor/openclaw  │
│  ├── 面板 HTTP 服务器（:3210）           │
│  │   ├── 静态文件（panel dist/）         │
│  │   └── REST API（/api/*）              │
│  ├── SQLite 存储                         │
│  └── 自动更新                            │
└─────────────────────────────────────────┘
         │                    ▲
         ▼                    │
┌─────────────┐    ┌─────────────────┐
│  OpenClaw   │    │  面板（React）   │
│  网关进程    │    │  localhost:3210  │
└─────────────┘    └─────────────────┘
```

桌面应用以**纯托盘模式**运行（macOS 下隐藏 Dock 图标）。它会：

1. 从 `vendor/openclaw/` 启动 OpenClaw 网关
2. 在 `localhost:3210` 提供面板 UI 和 REST API
3. 将网关配置写入 `~/.openclaw/gateway/config.yml`
4. 运行时从系统密钥链注入密钥
5. 监听 `~/.openclaw/skills/` 目录以热重载规则生成的 Skill 文件

### REST API

面板服务器暴露以下端点：

| 端点               | 方法                   | 说明                         |
| ------------------ | ---------------------- | ---------------------------- |
| `/api/rules`       | GET, POST, PUT, DELETE | 规则增删改查                 |
| `/api/channels`    | GET, POST, PUT, DELETE | 通道管理                     |
| `/api/permissions` | GET, POST, PUT, DELETE | 权限管理                     |
| `/api/settings`    | GET, PUT               | 键值对设置存储               |
| `/api/providers`   | GET                    | 可用 LLM 服务商              |
| `/api/status`      | GET                    | 系统状态（规则数、网关状态） |

### 数据目录

| 路径                             | 用途                   |
| -------------------------------- | ---------------------- |
| `~/.easyclaw/easyclaw.db`        | SQLite 数据库          |
| `~/.easyclaw/logs/`              | 应用日志               |
| `~/.openclaw/`                   | OpenClaw 状态目录      |
| `~/.openclaw/gateway/config.yml` | 网关配置               |
| `~/.openclaw/sessions/`          | WhatsApp 会话          |
| `~/.openclaw/skills/`            | 自动生成的 Skill 文件  |

## 构建安装包

### macOS（DMG，universal arm64+x64）

```bash
pnpm build
pnpm --filter @easyclaw/desktop dist:mac
# 输出：apps/desktop/release/EasyClaw-<version>-universal.dmg
```

代码签名和公证需设置以下环境变量：

```bash
CSC_LINK=<.p12 证书路径>
CSC_KEY_PASSWORD=<证书密码>
APPLE_ID=<你的 Apple ID>
APPLE_APP_SPECIFIC_PASSWORD=<应用专用密码>
APPLE_TEAM_ID=<团队 ID>
```

### Windows（NSIS 安装包，x64）

```bash
pnpm build
pnpm --filter @easyclaw/desktop dist:win
# 输出：apps/desktop/release/EasyClaw Setup <version>.exe
```

支持从 macOS 交叉编译（NSIS 无需 Wine）。Windows 代码签名需设置：

```bash
CSC_LINK=<.pfx 证书路径>
CSC_KEY_PASSWORD=<证书密码>
```

### 自动发布

`scripts/release.sh` 脚本处理完整流程：

```bash
./scripts/release.sh 0.1.0
```

它会：

1. 设置 `apps/desktop/package.json` 中的版本号
2. 构建所有工作区包
3. 构建 macOS DMG 和 Windows NSIS 安装包
4. 计算 SHA-256 哈希
5. 将安装包复制到 `website/site/releases/`
6. 更新 `website/site/update-manifest.json` 和 `website/site/index.html` 中的哈希与下载链接

## 注意：better-sqlite3 原生模块

`desktop dev` 会自动为 Electron 的 Node ABI 重新构建 better-sqlite3。这意味着**之后运行测试可能会失败**（`NODE_MODULE_VERSION` 不匹配）。修复方法：

```bash
pnpm install   # 恢复系统 Node 的预编译二进制文件
```

## 测试

测试使用 [Vitest](https://vitest.dev/)。运行所有测试：

```bash
pnpm test
```

运行指定包的测试：

```bash
pnpm --filter @easyclaw/storage test
pnpm --filter @easyclaw/gateway test
```

## 代码风格

- **Lint**：[oxlint](https://oxc-project.github.io/)（基于 Rust，速度快）
- **格式化**：[oxfmt](https://oxc-project.github.io/)（基于 Rust，速度快）
- **TypeScript**：严格模式，ES2023 目标，NodeNext 模块解析

```bash
pnpm lint
pnpm format       # 检查
pnpm format:fix   # 自动修复
```

## 网站与部署

`website/` 目录包含托管在 `www.easy-claw.com` 的静态产品站点：

```
website/
├── site/           # 静态 HTML/CSS/JS（国际化：中/英/日）
│   ├── index.html
│   ├── style.css
│   ├── i18n.js
│   ├── update-manifest.json
│   └── releases/   # 安装包（gitignored）
├── nginx/          # nginx 配置（HTTPS、重定向、缓存）
├── docker-compose.yml
└── init-letsencrypt.sh
```

在生产服务器上：

```bash
cd website
./init-letsencrypt.sh   # 首次 SSL 配置
docker compose up -d    # 启动 nginx + certbot
```

## 许可证

详见 [LICENSE](LICENSE)。
