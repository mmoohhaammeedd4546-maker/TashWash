import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./auth";

describe("local password authentication", () => {
  it("hashes a password without storing the plaintext", async () => {
    const password = "TashWash@2026!";
    const stored = await hashPassword(password);
    expect(stored).not.toContain(password);
    expect(stored.split(":")).toHaveLength(2);
    await expect(verifyPassword(password, stored)).resolves.toBe(true);
  });

  it("rejects an incorrect password and malformed hash", async () => {
    const stored = await hashPassword("correct-password");
    await expect(verifyPassword("wrong-password", stored)).resolves.toBe(false);
    await expect(verifyPassword("correct-password", "not-a-valid-hash")).resolves.toBe(false);
  });
});
