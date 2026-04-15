import { Hono } from "hono";
import { stream } from "hono/streaming";
import { sql } from "../db/client.js";

export const releasesRoute = new Hono();

// In-memory subscriber list for SSE push
type Subscriber = (release: { version: string; downloadUrl?: string }) => void;
const subscribers = new Set<Subscriber>();

/** Notify all connected SSE clients about a new release. */
function notifySubscribers(release: { version: string; downloadUrl?: string }) {
  for (const cb of subscribers) {
    try { cb(release); } catch { /* client gone */ }
  }
}

// --- GET /latest — return the latest published release ---
releasesRoute.get("/latest", async (c) => {
  const rows = await sql`
    SELECT version, download_url, notes, platform, published_at
    FROM app_releases
    ORDER BY published_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) {
    return c.json({ version: null }, 200);
  }
  const r = rows[0];
  return c.json({
    version: r.version,
    downloadUrl: r.download_url,
    notes: r.notes,
    platform: r.platform,
    publishedAt: r.published_at,
  });
});

// --- GET /subscribe — SSE stream, pushes when a new release is published ---
releasesRoute.get("/subscribe", (c) => {
  const clientVersion = c.req.query("v") ?? "0.0.0";

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (s) => {
    // Send current latest on connect so client gets immediate state
    const rows = await sql`
      SELECT version, download_url FROM app_releases
      ORDER BY published_at DESC LIMIT 1
    `;
    if (rows.length > 0 && rows[0].version !== clientVersion) {
      await s.write(`data: ${JSON.stringify({ version: rows[0].version, downloadUrl: rows[0].download_url })}\n\n`);
    }

    // Register for future pushes
    const onRelease: Subscriber = async (release) => {
      try {
        await s.write(`data: ${JSON.stringify(release)}\n\n`);
      } catch { subscribers.delete(onRelease); }
    };
    subscribers.add(onRelease);

    // Keep-alive ping every 30s
    const keepalive = setInterval(async () => {
      try { await s.write(": keepalive\n\n"); } catch { /* stream closed */ }
    }, 30_000);

    // Wait until client disconnects
    await new Promise<void>((resolve) => {
      s.onAbort(() => resolve());
    });

    clearInterval(keepalive);
    subscribers.delete(onRelease);
  });
});

// --- POST / — publish a new release (admin) ---
releasesRoute.post("/", async (c) => {
  const adminKey = c.req.header("X-Admin-Key");
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { version: string; downloadUrl?: string; notes?: string; platform?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.version) {
    return c.json({ error: "version is required" }, 400);
  }

  await sql`
    INSERT INTO app_releases (version, download_url, notes, platform)
    VALUES (
      ${body.version},
      ${body.downloadUrl ?? null},
      ${body.notes ?? null},
      ${body.platform ?? "all"}
    )
    ON CONFLICT (version) DO UPDATE SET
      download_url = EXCLUDED.download_url,
      notes = EXCLUDED.notes,
      platform = EXCLUDED.platform,
      published_at = now()
  `;

  // Push to all connected SSE clients
  notifySubscribers({ version: body.version, downloadUrl: body.downloadUrl });

  return c.json({ ok: true, version: body.version });
});
