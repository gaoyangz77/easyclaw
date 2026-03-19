/**
 * Extract a display initial (single uppercase letter) from a user object.
 * Prefers `name`, falls back to `email`. Returns "?" if both are empty/null.
 */
export function getUserInitial(user: { name?: string | null; email?: string | null }): string {
    const source = (user.name || user.email || "").trim();
    if (!source) return "?";
    return source.charAt(0).toUpperCase();
}
