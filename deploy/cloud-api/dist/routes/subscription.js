import { Hono } from "hono";
import { getActiveSubscription } from "../db/quota.js";
export const subscriptionRoute = new Hono();
const TIER_TOKENS = {
    basic: 5_000_000,
    pro: 20_000_000,
};
subscriptionRoute.get("/", async (c) => {
    const userId = c.get("userId");
    const sub = await getActiveSubscription(userId);
    return c.json({ subscription: sub });
});
subscriptionRoute.post("/create", async (c) => {
    let body;
    try {
        body = await c.req.json();
    }
    catch {
        return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!body.tier || !TIER_TOKENS[body.tier]) {
        return c.json({ error: "tier must be 'basic' or 'pro'" }, 400);
    }
    // Payment integration TBD — stub response
    return c.json({ status: "pending", message: "支付功能即将上线，敬请期待" });
});
//# sourceMappingURL=subscription.js.map