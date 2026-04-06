import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { authRoute } from "./routes/auth.js";
import { creditsRoute } from "./routes/credits.js";
import { proxyRoute } from "./routes/proxy.js";
import { rechargeRoute } from "./routes/recharge.js";

const app = new Hono();

app.route("/api/auth", authRoute);
app.route("/api/credits", creditsRoute);
app.route("/api/proxy", proxyRoute);
app.route("/api/recharge", rechargeRoute);

app.get("/health", (c) => c.json({ ok: true }));

export default app;

// Only start the server when run directly (not during tests)
if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3100);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`cloud-api listening on port ${port}`);
  });
}
