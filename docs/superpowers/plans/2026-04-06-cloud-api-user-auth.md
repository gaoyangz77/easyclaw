# Cloud-API User Auth (Email + Password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email + password registration/login to cloud-api and wire the sidebar "账号" button to this new auth system, replacing the OpenClaw GraphQL auth modal.

**Architecture:** Two new columns on the `users` table (`email UNIQUE`, `password_hash`). Three new REST endpoints: register/login/me. The panel's `UserAvatarButton` drops the OpenClaw `AuthModal` and uses a new `CreditsAuthModal` backed by `useCreditsAuth` hook. Token stored in `localStorage["credits-token"]`.

**Tech Stack:** Hono, bcryptjs, jose, postgres, React + useState/useEffect

---

## File Map

### Created
- `apps/cloud-api/src/db/migrations/002_user_email_auth.sql`
- `apps/cloud-api/src/lib/password.ts`
- `apps/cloud-api/src/__tests__/auth-email.test.ts`
- `apps/panel/src/api/credits-auth.ts`
- `apps/panel/src/hooks/useCreditsAuth.ts`
- `apps/panel/src/components/CreditsAuthModal.tsx`

### Modified
- `apps/cloud-api/src/db/schema.sql`
- `apps/cloud-api/src/routes/auth.ts`
- `packages/credits-client/src/index.ts`
- `apps/desktop/src/api-routes/credits-routes.ts`
- `apps/panel/src/components/UserAvatarButton.tsx`
- `apps/panel/src/layout/Layout.tsx`
- `apps/panel/src/pages/CreditsPage.tsx`

---

## Task 1: DB Migration — Add email + password_hash to users

**Files:**
- Create: `apps/cloud-api/src/db/migrations/002_user_email_auth.sql`
- Modify: `apps/cloud-api/src/db/schema.sql`

- [ ] **Step 1: Create migration file**

```sql
-- apps/cloud-api/src/db/migrations/002_user_email_auth.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
```

- [ ] **Step 2: Append to schema.sql**

Open `apps/cloud-api/src/db/schema.sql` and append at the end (after the subscriptions index):

```sql
-- Email/password auth columns (nullable — device-only users have NULL here)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
```

- [ ] **Step 3: Run migration**

```bash
cd apps/cloud-api
psql $DATABASE_URL -f src/db/migrations/002_user_email_auth.sql
```

Expected output:
```
ALTER TABLE
```

- [ ] **Step 4: Commit**

```bash
git add apps/cloud-api/src/db/migrations/002_user_email_auth.sql apps/cloud-api/src/db/schema.sql
git commit -m "feat(cloud-api): add email + password_hash columns to users"
```

---

## Task 2: Install bcryptjs + Password Helpers

**Files:**
- Create: `apps/cloud-api/src/lib/password.ts`

- [ ] **Step 1: Install bcryptjs**

```bash
cd apps/cloud-api
pnpm add bcryptjs
pnpm add -D @types/bcryptjs
```

- [ ] **Step 2: Create password.ts**

```typescript
// apps/cloud-api/src/lib/password.ts
import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/cloud-api/src/lib/password.ts apps/cloud-api/package.json pnpm-lock.yaml
git commit -m "feat(cloud-api): add bcryptjs password helpers"
```

---

## Task 3: Register / Login / Me Endpoints + Tests

**Files:**
- Create: `apps/cloud-api/src/__tests__/auth-email.test.ts`
- Modify: `apps/cloud-api/src/routes/auth.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/cloud-api/src/__tests__/auth-email.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { testClient } from "hono/testing";
import { authRoute } from "../routes/auth.js";

vi.mock("../db/client.js", () => ({ sql: vi.fn() }));
vi.mock("../lib/password.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$2b$12$hashed"),
  verifyPassword: vi.fn(),
}));

import { sql } from "../db/client.js";
import { verifyPassword } from "../lib/password.js";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const verifyMock = verifyPassword as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("POST /register", () => {
  it("returns 400 when email is missing", async () => {
    const res = await testClient(authRoute).register.$post({ json: { password: "secret123" } as any });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too short", async () => {
    const res = await testClient(authRoute).register.$post({ json: { email: "a@b.com", password: "short" } as any });
    expect(res.status).toBe(400);
  });

  it("returns 409 when email already exists", async () => {
    sqlMock.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    const res = await testClient(authRoute).register.$post({ json: { email: "a@b.com", password: "secret123" } });
    expect(res.status).toBe(409);
  });

  it("creates user and returns token + userId", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "user-1", jwt_secret: "secret-32-chars-padding-here-xx" }]);
    const res = await testClient(authRoute).register.$post({ json: { email: "a@b.com", password: "secret123" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ userId: "user-1" });
    expect(typeof (body as any).token).toBe("string");
  });
});

describe("POST /login", () => {
  it("returns 400 when fields are missing", async () => {
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com" } as any });
    expect(res.status).toBe(400);
  });

  it("returns 401 when user not found", async () => {
    sqlMock.mockResolvedValueOnce([]);
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com", password: "secret123" } });
    expect(res.status).toBe(401);
  });

  it("returns 401 when password is wrong", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "u1", jwt_secret: "s".repeat(32), password_hash: "$2b$12$hash" }]);
    verifyMock.mockResolvedValueOnce(false);
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com", password: "wrong" } });
    expect(res.status).toBe(401);
  });

  it("returns token on correct credentials", async () => {
    sqlMock.mockResolvedValueOnce([{ id: "u1", jwt_secret: "secret-32-chars-padding-here-xx", password_hash: "$2b$12$hash" }]);
    verifyMock.mockResolvedValueOnce(true);
    const res = await testClient(authRoute).login.$post({ json: { email: "a@b.com", password: "correct" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof (body as any).token).toBe("string");
    expect((body as any).userId).toBe("u1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/cloud-api
pnpm test src/__tests__/auth-email.test.ts
```

Expected: FAIL — `Cannot find route register` or similar (routes don't exist yet)

- [ ] **Step 3: Replace auth.ts with register/login/me handlers**

```typescript
// apps/cloud-api/src/routes/auth.ts
import { Hono } from "hono";
import { SignJWT } from "jose";
import { sql } from "../db/client.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { getActiveSubscription } from "../db/quota.js";
import { authMiddleware } from "../middleware/auth.js";
import { randomBytes } from "node:crypto";

export const authRoute = new Hono<{ Variables: { userId: string } }>();

// ── Device auth (unchanged) ─────────────────────────────────────────────────
authRoute.post("/device", async (c) => {
  const body = await c.req.json<{ deviceId?: string }>();
  if (!body.deviceId || typeof body.deviceId !== "string") {
    return c.json({ error: "deviceId is required" }, 400);
  }

  const { deviceId } = body;
  const jwtSecret = randomBytes(32).toString("hex");
  const freeCredits = Math.max(0, parseInt(process.env.FREE_CREDITS ?? "100", 10)) || 100;

  const [user] = await sql<{ id: string; jwt_secret: string; credits_init: boolean }[]>`
    INSERT INTO users (device_id, jwt_secret)
    VALUES (${deviceId}, ${jwtSecret})
    ON CONFLICT (device_id) DO UPDATE SET device_id = EXCLUDED.device_id
    RETURNING id, jwt_secret, credits_init
  `;

  if (!user) return c.json({ error: "db error" }, 500);

  const claimed = await sql<{ id: string }[]>`
    UPDATE users SET credits_init = true
    WHERE id = ${user.id} AND credits_init = false
    RETURNING id
  `;

  if (claimed.length > 0) {
    await sql`
      INSERT INTO credit_ledger (user_id, delta, reason)
      VALUES (${user.id}, ${freeCredits}, 'signup_bonus')
    `;
    await sql`
      INSERT INTO credit_balance (user_id, balance)
      VALUES (${user.id}, ${freeCredits})
      ON CONFLICT (user_id) DO UPDATE SET balance = credit_balance.balance + ${freeCredits}, updated_at = now()
    `;
  }

  const [row] = await sql<{ balance: number }[]>`
    SELECT balance FROM credit_balance WHERE user_id = ${user.id}
  `;
  const balance = row?.balance ?? 0;

  const secret = new TextEncoder().encode(user.jwt_secret);
  const token = await new SignJWT({ sub: user.id, did: deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  return c.json({ token, balance });
});

// ── Email register ──────────────────────────────────────────────────────────
authRoute.post("/register", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  if (!body.email || !body.password) {
    return c.json({ error: "email and password are required" }, 400);
  }
  if (body.password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  const passwordHash = await hashPassword(body.password);
  const deviceId = randomBytes(16).toString("hex"); // placeholder so NOT NULL is satisfied
  const jwtSecret = randomBytes(32).toString("hex");

  let user: { id: string; jwt_secret: string };
  try {
    const [row] = await sql<{ id: string; jwt_secret: string }[]>`
      INSERT INTO users (device_id, jwt_secret, email, password_hash)
      VALUES (${deviceId}, ${jwtSecret}, ${body.email}, ${passwordHash})
      RETURNING id, jwt_secret
    `;
    if (!row) return c.json({ error: "Registration failed" }, 500);
    user = row;
  } catch (err: unknown) {
    if ((err as Record<string, unknown>)?.code === "23505") {
      return c.json({ error: "Email already registered" }, 409);
    }
    throw err;
  }

  const secret = new TextEncoder().encode(user.jwt_secret);
  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  return c.json({ token, userId: user.id });
});

// ── Email login ─────────────────────────────────────────────────────────────
authRoute.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  if (!body.email || !body.password) {
    return c.json({ error: "email and password are required" }, 400);
  }

  const [user] = await sql<{ id: string; jwt_secret: string; password_hash: string | null }[]>`
    SELECT id, jwt_secret, password_hash FROM users WHERE email = ${body.email}
  `;

  if (!user || !user.password_hash) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const secret = new TextEncoder().encode(user.jwt_secret);
  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  return c.json({ token, userId: user.id });
});

// ── Me (requires JWT) ───────────────────────────────────────────────────────
authRoute.get("/me", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const [user] = await sql<{ email: string | null }[]>`
    SELECT email FROM users WHERE id = ${userId}
  `;
  const sub = await getActiveSubscription(userId);
  return c.json({
    userId,
    email: user?.email ?? null,
    plan: sub ? sub.tier : "free",
  });
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/cloud-api
pnpm test src/__tests__/auth-email.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Run full test suite**

```bash
cd apps/cloud-api
pnpm test
```

Expected: all 25 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/cloud-api/src/routes/auth.ts apps/cloud-api/src/__tests__/auth-email.test.ts
git commit -m "feat(cloud-api): add email register/login/me endpoints"
```

---

## Task 4: Update Credits-Client SDK

**Files:**
- Modify: `packages/credits-client/src/index.ts`

- [ ] **Step 1: Add register/login/me to the interface and implementation**

In `packages/credits-client/src/index.ts`:

Add to the `CreditsClient` interface (after `createSubscription`):
```typescript
register(email: string, password: string): Promise<{ token: string; userId: string }>;
login(email: string, password: string): Promise<{ token: string; userId: string }>;
me(token: string): Promise<{ userId: string; email: string | null; plan: string }>;
```

Add to the `createCreditsClient` implementation (after `createSubscription`):
```typescript
register(email, password) {
  return apiRequest<{ token: string; userId: string }>(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
},

login(email, password) {
  return apiRequest<{ token: string; userId: string }>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
},

me(token) {
  return apiRequest<{ userId: string; email: string | null; plan: string }>(
    baseUrl,
    "/api/auth/me",
    { token }
  );
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/credits-client/src/index.ts
git commit -m "feat(credits-client): add register, login, me methods"
```

---

## Task 5: Desktop Proxy — Auth Endpoints

**Files:**
- Modify: `apps/desktop/src/api-routes/credits-routes.ts`

- [ ] **Step 1: Add three new proxy handlers**

Inside `handleCreditsRoutes`, add BEFORE the final `return false;`:

```typescript
// POST /api/auth/register
if (pathname === "/api/auth/register" && req.method === "POST") {
  const body = await parseBody(req) as { email?: string; password?: string };
  if (!creditsClient) {
    sendJson(res, 503, { error: "Credits service not configured" });
    return true;
  }
  try {
    const result = await creditsClient.register(body.email ?? "", body.password ?? "");
    sendJson(res, 200, result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("already") ? 409 : msg.includes("least 8") ? 400 : 400;
    sendJson(res, status, { error: msg });
  }
  return true;
}

// POST /api/auth/login
if (pathname === "/api/auth/login" && req.method === "POST") {
  const body = await parseBody(req) as { email?: string; password?: string };
  if (!creditsClient) {
    sendJson(res, 503, { error: "Credits service not configured" });
    return true;
  }
  try {
    const result = await creditsClient.login(body.email ?? "", body.password ?? "");
    sendJson(res, 200, result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("Invalid") ? 401 : 400;
    sendJson(res, status, { error: msg });
  }
  return true;
}

// GET /api/auth/me
if (pathname === "/api/auth/me" && req.method === "GET") {
  const authHeader = req.headers["authorization"] as string | undefined;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !creditsClient) {
    sendJson(res, 401, { error: "Unauthorized" });
    return true;
  }
  try {
    const data = await creditsClient.me(token);
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 401, { error: "Unauthorized" });
  }
  return true;
}
```

- [ ] **Step 2: Rebuild desktop**

```bash
cd apps/desktop
npx tsdown
```

Expected: `✔ Build complete`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/api-routes/credits-routes.ts
git commit -m "feat(desktop): proxy /api/auth/register, /login, /me to cloud-api"
```

---

## Task 6: Panel Auth API + useCreditsAuth Hook

**Files:**
- Create: `apps/panel/src/api/credits-auth.ts`
- Create: `apps/panel/src/hooks/useCreditsAuth.ts`

- [ ] **Step 1: Create credits-auth.ts**

```typescript
// apps/panel/src/api/credits-auth.ts
import { fetchJson } from "./client.js";

const TOKEN_KEY = "credits-token";

export function getCreditsToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setCreditsToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearCreditsToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface MeResponse {
  userId: string;
  email: string | null;
  plan: string;
}

export function apiRegister(email: string, password: string): Promise<{ token: string; userId: string }> {
  return fetchJson("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function apiLogin(email: string, password: string): Promise<{ token: string; userId: string }> {
  return fetchJson("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function apiMe(token: string): Promise<MeResponse> {
  return fetchJson("/auth/me", {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
}
```

- [ ] **Step 2: Create useCreditsAuth.ts**

```typescript
// apps/panel/src/hooks/useCreditsAuth.ts
import { useState, useEffect, useCallback } from "react";
import {
  getCreditsToken, setCreditsToken, clearCreditsToken,
  apiRegister, apiLogin, apiMe,
  type MeResponse,
} from "../api/credits-auth.js";

interface CreditsAuthState {
  token: string | null;
  me: MeResponse | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): void;
}

export function useCreditsAuth(): CreditsAuthState {
  const [token, setToken] = useState<string | null>(() => getCreditsToken());
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // On mount (or token change), verify token and load profile
  useEffect(() => {
    if (!token) { setMe(null); return; }
    setLoading(true);
    apiMe(token)
      .then(setMe)
      .catch(() => {
        // Token invalid or expired — clear it
        clearCreditsToken();
        setToken(null);
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setCreditsToken(result.token);
    setToken(result.token);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const result = await apiRegister(email, password);
    setCreditsToken(result.token);
    setToken(result.token);
  }, []);

  const logout = useCallback(() => {
    clearCreditsToken();
    setToken(null);
    setMe(null);
  }, []);

  return { token, me, loading, login, register, logout };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/panel/src/api/credits-auth.ts apps/panel/src/hooks/useCreditsAuth.ts
git commit -m "feat(panel): add credits-auth API + useCreditsAuth hook"
```

---

## Task 7: CreditsAuthModal Component

**Files:**
- Create: `apps/panel/src/components/CreditsAuthModal.tsx`

- [ ] **Step 1: Create CreditsAuthModal.tsx**

```tsx
// apps/panel/src/components/CreditsAuthModal.tsx
import { useState } from "react";
import { Modal } from "./modals/Modal.js";
import { useCreditsAuth } from "../hooks/useCreditsAuth.js";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreditsAuthModal({ isOpen, onClose, onSuccess }: Props) {
  const { login, register } = useCreditsAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchTab(t: "login" | "register") {
    setTab(t);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (tab === "register" && password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    setSubmitting(true);
    try {
      if (tab === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      onClose();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="账号" maxWidth={400}>
      <div className="auth-modal-form">
        <div className="auth-tab-pill" role="tablist">
          <button
            className={`auth-tab-pill-btn${tab === "login" ? " auth-tab-pill-btn--active" : ""}`}
            onClick={() => switchTab("login")}
            role="tab"
            type="button"
          >登录</button>
          <button
            className={`auth-tab-pill-btn${tab === "register" ? " auth-tab-pill-btn--active" : ""}`}
            onClick={() => switchTab("register")}
            role="tab"
            type="button"
          >注册</button>
        </div>

        {error && <div className="error-alert">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="form-label-block">
            邮箱
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="auth-input"
              autoComplete="email"
            />
          </label>
          <label className="form-label-block">
            密码{tab === "register" && <span className="auth-hint">（至少 8 位）</span>}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="auth-input"
              autoComplete={tab === "login" ? "current-password" : "new-password"}
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary auth-submit-btn"
            disabled={submitting}
          >
            {submitting ? "请稍候…" : tab === "login" ? "登录" : "注册"}
          </button>
        </form>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/panel/src/components/CreditsAuthModal.tsx
git commit -m "feat(panel): add CreditsAuthModal for cloud-api auth"
```

---

## Task 8: Replace UserAvatarButton + Clean Up Layout

**Files:**
- Modify: `apps/panel/src/components/UserAvatarButton.tsx`
- Modify: `apps/panel/src/layout/Layout.tsx`

- [ ] **Step 1: Rewrite UserAvatarButton.tsx**

```tsx
// apps/panel/src/components/UserAvatarButton.tsx
import { useState } from "react";
import { CreditsAuthModal } from "./CreditsAuthModal.js";
import { useCreditsAuth } from "../hooks/useCreditsAuth.js";
import { UserPlusIcon } from "./icons.js";

interface UserAvatarButtonProps {
  onNavigate: (path: string) => void;
}

export function UserAvatarButton({ onNavigate: _ }: UserAvatarButtonProps) {
  const { me, logout } = useCreditsAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  if (me) {
    const initial = (me.email ?? "?").charAt(0).toUpperCase();
    return (
      <div className="user-avatar-wrapper">
        <button
          className="user-avatar-btn user-avatar-btn-active"
          onClick={() => setShowMenu((v) => !v)}
          title={me.email ?? "已登录"}
        >
          <span className="user-avatar-circle">{initial}</span>
        </button>
        {showMenu && (
          <div className="user-avatar-menu" onClick={() => setShowMenu(false)}>
            <div className="user-avatar-menu-email">{me.email}</div>
            <button className="user-avatar-menu-item" onClick={logout}>退出登录</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="user-avatar-wrapper">
      <button
        className="user-avatar-btn"
        onClick={() => setModalOpen(true)}
        title="登录 / 注册"
      >
        <UserPlusIcon />
      </button>
      <CreditsAuthModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Clean up Layout.tsx — remove OpenClaw AuthModal**

In `apps/panel/src/layout/Layout.tsx`:

a) Remove these imports:
```typescript
import { AuthModal } from "../components/modals/AuthModal.js";
```

b) Remove these state declarations:
```typescript
const [authModalOpen, setAuthModalOpen] = useState(false);
const [pendingAuthPath, setPendingAuthPath] = useState<string | null>(null);
```

c) Remove the `AUTH_REQUIRED_PATHS` constant (top of file):
```typescript
const AUTH_REQUIRED_PATHS = new Set(["/browser-profiles", "/tiktok-shops", "/ecommerce"]);
```

d) Remove the auth gate in the nav button `onClick` — replace:
```typescript
onClick={() => {
  if (AUTH_REQUIRED_PATHS.has(item.path) && !user) {
    setPendingAuthPath(item.path);
    setAuthModalOpen(true);
  } else {
    onNavigate(item.path);
  }
}}
```
with:
```typescript
onClick={() => onNavigate(item.path)}
```

e) Remove the `user` variable: `const user = entityStore.currentUser;`

f) Remove `useEntityStore` import if `entityStore` is no longer used anywhere else in the file. (Check that no other references remain before removing.)

g) Remove the `<AuthModal ...>` JSX at the bottom of the return.

- [ ] **Step 3: Rebuild desktop to verify no TypeScript errors**

```bash
cd apps/desktop
npx tsdown
```

Expected: `✔ Build complete`

- [ ] **Step 4: Commit**

```bash
git add apps/panel/src/components/UserAvatarButton.tsx apps/panel/src/layout/Layout.tsx
git commit -m "feat(panel): replace OpenClaw AuthModal with CreditsAuthModal in sidebar"
```

---

## Task 9: CreditsPage — Login Gate on Subscription Buttons

**Files:**
- Modify: `apps/panel/src/pages/CreditsPage.tsx`

- [ ] **Step 1: Add useCreditsAuth + login gate**

In `apps/panel/src/pages/CreditsPage.tsx`, add at the top of `CreditsPage()`:

```typescript
import { useCreditsAuth } from "../hooks/useCreditsAuth.js";
import { CreditsAuthModal } from "../components/CreditsAuthModal.js";
```

Inside the component, add after the existing state:
```typescript
const { me } = useCreditsAuth();
const [authModalOpen, setAuthModalOpen] = useState(false);
```

Replace the subscription plan cards section. Change the "订阅" buttons to check login first:

```tsx
{/* Subscription cards (shown for free users) */}
{quota?.plan === "free" && (
  <div className="credits-page__plans">
    <h2>升级套餐</h2>
    {subMsg && <p className="credits-page__recharge-msg">{subMsg}</p>}
    <div className="credits-page__plan-cards">
      <div className="credits-page__plan-card">
        <div className="credits-page__plan-name">基础版</div>
        <div className="credits-page__plan-price">¥19 / 月</div>
        <div className="credits-page__plan-desc">500 万 token/月 · 所有模型</div>
        <button
          className="btn btn-primary"
          onClick={() => me ? handleSubscribe("basic") : setAuthModalOpen(true)}
        >
          {me ? "订阅" : "登录后订阅"}
        </button>
      </div>
      <div className="credits-page__plan-card credits-page__plan-card--featured">
        <div className="credits-page__plan-name">专业版</div>
        <div className="credits-page__plan-price">¥49 / 月</div>
        <div className="credits-page__plan-desc">2000 万 token/月 · 所有模型</div>
        <button
          className="btn btn-primary"
          onClick={() => me ? handleSubscribe("pro") : setAuthModalOpen(true)}
        >
          {me ? "订阅" : "登录后订阅"}
        </button>
      </div>
    </div>
    <CreditsAuthModal
      isOpen={authModalOpen}
      onClose={() => setAuthModalOpen(false)}
      onSuccess={() => loadData(page)}
    />
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add apps/panel/src/pages/CreditsPage.tsx
git commit -m "feat(panel): gate subscription buttons behind cloud-api login"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| DB: email + password_hash columns | Task 1 |
| Password policy (min 8 chars, bcrypt 12) | Task 2 + Task 3 |
| POST /api/auth/register | Task 3 |
| POST /api/auth/login | Task 3 |
| GET /api/auth/me | Task 3 |
| credits-client register/login/me | Task 4 |
| Desktop proxy for auth endpoints | Task 5 |
| localStorage["credits-token"] | Task 6 (credits-auth.ts) |
| useCreditsAuth hook | Task 6 |
| CreditsAuthModal | Task 7 |
| Sidebar AccountIcon → cloud-api auth | Task 8 |
| Remove OpenClaw AuthModal from Layout | Task 8 |
| CreditsPage subscription login gate | Task 9 |

**Placeholder scan:** No TBDs found.

**Type consistency:**
- `useCreditsAuth()` returns `{ token, me, loading, login, register, logout }` — used consistently in Task 7 (CreditsAuthModal), Task 8 (UserAvatarButton), Task 9 (CreditsPage).
- `MeResponse` defined in `credits-auth.ts`, imported in `useCreditsAuth.ts` — consistent.
- `apiMe` / `apiLogin` / `apiRegister` names consistent across `credits-auth.ts` and `useCreditsAuth.ts`.
