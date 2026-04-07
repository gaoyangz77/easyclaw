# Cloud-API User Auth (Email + Password)

**Date:** 2026-04-06  
**Status:** Approved

## Overview

Add email + password registration and login to `apps/cloud-api`. This is a separate account system from the OpenClaw gateway (which uses GraphQL + its own JWT). Cloud-api accounts are used exclusively for managing subscriptions and quota in the credits system.

Device-based auth (deviceId → JWT) is kept unchanged for the free daily quota tier. Email accounts are required only to subscribe to a paid plan.

---

## 1. Database Changes

Two new nullable columns on the existing `users` table:

```sql
ALTER TABLE users
  ADD COLUMN email         TEXT UNIQUE,
  ADD COLUMN password_hash TEXT;
```

- Device users: both columns are NULL
- Email users: `email` is set, `password_hash` is a bcrypt hash (cost factor 12)
- `email` has a UNIQUE constraint — one account per email address

No new tables needed.

---

## 2. Password Policy

- Minimum 8 characters
- bcrypt with cost factor 12 (via the `bcrypt` npm package)
- No complexity requirements enforced server-side (keep it simple)

---

## 3. New API Endpoints

All under `/api/auth/`:

### `POST /api/auth/register`

```ts
Body:     { email: string; password: string }
Response: { token: string; userId: string }
Errors:
  400  { error: "email and password are required" }
  400  { error: "Password must be at least 8 characters" }
  409  { error: "Email already registered" }
```

Creates a new user row with `email` + `password_hash`. Issues a JWT (sub = userId, 30d). Does NOT create a device_id (set to a generated UUID so the NOT NULL constraint is satisfied).

### `POST /api/auth/login`

```ts
Body:     { email: string; password: string }
Response: { token: string; userId: string }
Errors:
  400  { error: "email and password are required" }
  401  { error: "Invalid email or password" }
```

Finds user by email, verifies bcrypt hash, issues JWT signed with `user.jwt_secret`.

### `GET /api/auth/me`

```ts
Header:   Authorization: Bearer <token>
Response: { userId: string; email: string; plan: "free" | "basic" | "pro" }
Errors:
  401  { error: "Unauthorized" }
```

Returns identity + current subscription plan. Uses existing `authMiddleware` for JWT verification. Queries `subscriptions` table to determine plan.

---

## 4. JWT Format

Same as device tokens: signed with per-user `jwt_secret` (HS256, 30 days). `sub` = userId. No new fields needed — existing `authMiddleware` works unchanged.

---

## 5. Credits-Client SDK

Add three methods to `packages/credits-client/src/index.ts`:

```ts
register(email: string, password: string): Promise<{ token: string; userId: string }>
login(email: string, password: string): Promise<{ token: string; userId: string }>
me(token: string): Promise<{ userId: string; email: string; plan: string }>
```

---

## 6. Desktop Proxy

Add to `apps/desktop/src/api-routes/credits-routes.ts`:

```
POST /api/auth/register  →  creditsClient.register(email, password)
POST /api/auth/login     →  creditsClient.login(email, password)
GET  /api/auth/me        →  creditsClient.me(token)
```

These routes do NOT require an existing credits token — they are pre-auth endpoints.

---

## 7. Panel UI

### Token Storage

After login/register, store the JWT in `localStorage["credits-token"]`.  
On page load, `fetchQuota()` / subscription calls read this key.  
Logout = `localStorage.removeItem("credits-token")`.

### Auth State Hook

New hook `useCreditsAuth()` in `apps/panel/src/hooks/useCreditsAuth.ts`:

```ts
{
  token: string | null;
  userId: string | null;
  email: string | null;
  plan: string | null;
  login(email, password): Promise<void>;
  register(email, password): Promise<void>;
  logout(): void;
}
```

On mount, reads token from localStorage and calls `/api/auth/me` to verify + get plan.

### CreditsAuthModal

New component `apps/panel/src/components/CreditsAuthModal.tsx`:

- Two tabs: 登录 / 注册
- Email + password fields
- Submit calls `login()` or `register()` from `useCreditsAuth()`
- On success: closes modal, parent refreshes quota

### CreditsPage Integration

- `useCreditsAuth()` called at top of CreditsPage
- If not logged in: subscription "订阅" buttons show "登录后订阅", clicking opens CreditsAuthModal
- If logged in: show email + plan in the quota card header; show "退出登录" link
- After login success: quota refetched, subscription cards re-render

---

## 8. Out of Scope

- Password reset / forgot password
- Email verification
- Phone + SMS login
- WeChat QR code login
- Session revocation / refresh tokens
- Rate limiting on login attempts
