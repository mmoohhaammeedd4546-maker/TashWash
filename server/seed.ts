import { eq } from "drizzle-orm";
import { services, settings, users } from "../drizzle/schema";
import { hashPassword } from "./auth";
import { getDb } from "./db";

async function main() {
  const database = await getDb();
  if (!database) throw new Error("DATABASE_URL is required for seeding");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") throw new Error("Seeding is disabled in production unless ALLOW_SEED=true");

  const admin = await database.select().from(users).where(eq(users.username, "admin")).limit(1);
  if (!admin[0]) {
    await database.insert(users).values({ openId: "local:admin", username: "admin", name: "مدير النظام", passwordHash: await hashPassword("admin123"), role: "admin", active: true, mustChangePassword: true, loginMethod: "password" });
    console.log("Created initial admin user: admin / admin123");
  } else {
    console.log("Admin user already exists; no password was changed.");
  }

  await database.insert(settings).values({ id: 1, washName: "طش ورش", taxRateBasisPoints: 1500, invoiceFooter: "شكرًا لزيارتكم" }).onDuplicateKeyUpdate({ set: { washName: "طش ورش" } });
  const starterServices = [
    ["غسيل خارجي", "تنظيف الهيكل الخارجي", 2500],
    ["غسيل داخلي", "تنظيف المقصورة والفرش", 3000],
    ["غسيل كامل", "غسيل داخلي وخارجي", 5000],
    ["تلميع", "تلميع احترافي للهيكل", 12000],
    ["تنظيف مكيف", "تنظيف وتعقيم فتحات المكيف", 7500],
    ["تنظيف محرك", "تنظيف آمن لحوض المحرك", 9000],
  ] as const;
  for (const [name, description, priceCents] of starterServices) {
    const exists = await database.select({ id: services.id }).from(services).where(eq(services.name, name)).limit(1);
    if (!exists[0]) await database.insert(services).values({ name, description, priceCents, active: true });
  }
  console.log("TashWash seed completed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
