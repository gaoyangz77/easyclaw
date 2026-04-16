import postgres from "postgres";
// sql is a tagged-template query function — always use it as sql`...`
export const sql = postgres(process.env.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
});
//# sourceMappingURL=client.js.map