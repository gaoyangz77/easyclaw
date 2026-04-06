# 积分系统 + OpenRouter 接入 设计文档

**日期**: 2026-04-06  
**状态**: 待实施

---

## 1. 目标

将 RivonClaw 改造为支持三种接入模式，新增积分体系让新用户免费体验，接入 OpenRouter 作为积分模式的底层模型服务。

---

## 2. 三种接入模式

| 模式 | 标识 | 说明 |
|------|------|------|
| 默认模型（积分） | `credits` | 新用户默认，走云端代理 + 我方 OpenRouter 主 Key，按 token 扣积分 |
| 自定义 Coding Plan | `coding-plan` | 用户自己的编程订阅（zhipu-coding、moonshot-coding、qwen-coding 等），复用现有 subscription plan 流程 |
| 订阅大模型 | `subscription` | 用户自己的 Claude/Gemini 订阅或 API Key（OpenAI、Anthropic、OpenRouter 等），复用现有 API Key / OAuth 流程 |

**切换逻辑**：
- 模式存储在本地 SQLite `settings` 表，key 为 `access_mode`
- 桌面端启动时读取模式，决定 OpenClaw 网关的 provider 配置
- 若模式为 `credits` 且积分耗尽，UI 提示切换模式或充值

---

## 3. 云端后端（apps/cloud-api）

### 3.1 技术栈

| 项目 | 选型 |
|------|------|
| 运行时 | Node.js 24 + TypeScript |
| 框架 | Hono |
| 数据库 | PostgreSQL（Supabase 托管） |
| 认证 | 设备 ID（SHA-256）+ JWT |
| 部署 | Vercel / Railway |

### 3.2 接口

```
POST /api/auth/device          # 设备注册/登录，返回 JWT + 当前积分余额
GET  /api/credits/balance      # 查询积分余额（需 JWT）
GET  /api/credits/history      # 消费记录（分页，需 JWT）
POST /api/proxy/openrouter     # 流式代理到 OpenRouter，扣积分（需 JWT）
POST /api/recharge/create      # 创建充值订单（本期返回占位响应，支付逻辑留空）
```

### 3.3 数据模型

```sql
-- 用户
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    TEXT UNIQUE NOT NULL,
  jwt_secret   TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  credits_init BOOLEAN DEFAULT false  -- 是否已发放初始积分
);

-- 积分账本（append-only）
CREATE TABLE credit_ledger (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),
  delta      INTEGER NOT NULL,        -- 正: 充值/赠送; 负: 消费
  reason     TEXT NOT NULL,           -- 'signup_bonus' | 'consumption' | 'recharge'
  model      TEXT,                    -- 消费时记录模型名
  tokens     INTEGER,                 -- 消费 token 数
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 余额缓存（从 ledger 聚合，读性能优化）
CREATE TABLE credit_balance (
  user_id    UUID PRIMARY KEY REFERENCES users(id),
  balance    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.4 积分规则

- 新用户注册赠送 **100 积分**（可配置）
- 消费公式：`积分消耗 = ceil((input_tokens + output_tokens) / 1000)`（暂定，可按模型定价调整）
- 请求前校验余额，余额不足返回 `402` 状态码
- 账本 append-only，不允许直接修改余额

---

## 4. 客户端 SDK（packages/credits-client）

```typescript
// 对外 API
export interface CreditsClient {
  deviceAuth(deviceId: string): Promise<{ token: string; balance: number }>
  getBalance(token: string): Promise<number>
  getHistory(token: string, page: number): Promise<LedgerEntry[]>
  proxyStream(token: string, payload: OpenRouterPayload): Promise<ReadableStream>
}
```

- 封装所有 cloud-api 通信
- 桌面端（`@rivonclaw/desktop`）和 panel 均通过此包访问云端
- token 缓存在内存，过期自动用 device_id 刷新

---

## 5. Panel UI 改动

### 5.1 新增页面

| 页面 | 路径 | 说明 |
|------|------|------|
| 接入模式选择 | `/access-mode` | 三种模式卡片，首次进入或在设置中切换 |
| 积分中心 | `/credits` | 余额展示、消费记录列表、充值入口（占位） |

### 5.2 现有页面改动

- **ProvidersPage**：顶部新增「当前模式」徽章，积分模式时隐藏 API Key 配置区，显示「去积分中心」入口
- **顶部导航栏**：积分模式下常驻积分余额显示（`CreditsBalance` 组件）
- **技能市场**（`/skills`）：**保持现有功能不变**

### 5.3 积分耗尽处理

- 代理返回 `402` 时，前端弹出 Modal：
  - 选项 A：充值（跳转 `/credits`）
  - 选项 B：切换到自己的 API Key（跳转 `/access-mode`）

---

## 6. 桌面端（desktop）改动

### 6.1 启动时初始化

```
读取 access_mode from SQLite
  ├─ credits  → 调用 credits-client.deviceAuth() 获取 JWT
  │             → 将代理地址注入 OpenClaw 的 openrouter provider baseUrl
  │               (指向 cloud-api /api/proxy/openrouter)
  ├─ coding-plan → 走现有 subscription plan 流程（不变）
  └─ subscription → 走现有 API Key / OAuth 流程（不变）
```

### 6.2 热重载

- 积分耗尽切换模式后，调用现有 `GatewayLauncher.restart()` 重新注入配置
- 无需重启整个 Electron 进程

---

## 7. OpenRouter 接入改动

- 现有 `openrouter` provider 定义保持不变（供 subscription 模式直接使用）
- 积分模式新增一个运行时 provider 配置（不写入 `models.ts`）：
  - `baseUrl`: `https://your-cloud-api.com/api/proxy/openrouter`
  - 请求头注入 `Authorization: Bearer <JWT>`
- 云端代理层替换 Authorization 为主 Key 后转发给 `https://openrouter.ai/api/v1`

---

## 8. 不在本期范围

- 支付回调实现（微信/支付宝/Stripe）
- 用户注册账号体系（本期用设备 ID 匿名）
- STT、遥测、浏览器配置等无关模块改动
- Onboarding 引导流程改造

---

## 9. 实施顺序建议

1. `apps/cloud-api` — 数据库 schema + `/auth/device` + `/credits/balance` + `/proxy/openrouter`
2. `packages/credits-client` — SDK 封装
3. `packages/core` — 新增 `AccessMode` 类型 + settings key
4. `apps/desktop` — 启动时模式初始化 + 热重载
5. `apps/panel` — AccessModePage + CreditsPage + ProvidersPage 改动 + CreditsBalance 组件
