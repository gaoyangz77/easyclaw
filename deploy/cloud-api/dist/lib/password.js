import bcrypt from "bcryptjs";
const COST = 12;
export function hashPassword(plain) {
    return bcrypt.hash(plain, COST);
}
export function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}
//# sourceMappingURL=password.js.map