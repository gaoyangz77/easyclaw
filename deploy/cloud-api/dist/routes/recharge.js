import { Hono } from "hono";
export const rechargeRoute = new Hono();
// Stub — returns a placeholder response. Payment integration to be added later.
rechargeRoute.post("/create", async (c) => {
    return c.json({
        orderId: null,
        status: "unavailable",
        message: "充值功能即将上线，敬请期待",
    });
});
//# sourceMappingURL=recharge.js.map