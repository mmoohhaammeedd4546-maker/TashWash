import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [salt, encoded] = stored.split(":");
  if (!salt || !encoded) return false;
  try {
    const expected = Buffer.from(encoded, "hex");
    const actual = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function assertStrongPassword(password: string): void {
  if (password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
}
