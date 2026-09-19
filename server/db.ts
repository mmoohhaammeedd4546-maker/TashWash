import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditLogs,
  backups,
  invoiceCounters,
  invoiceItems,
  invoices,
  services,
  settings,
  users,
  type InsertUser,
  type User,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0];
}

export function publicUser(user: User | null | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    lastSignedIn: user.lastSignedIn,
  };
}

export async function getSettings() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(settings).values({ id: 1, washName: "طش ورش", invoiceFooter: "شكرًا لزيارتكم" });
  const created = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return created[0] ?? null;
}

export async function writeAudit(input: {
  userId?: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  details?: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    userId: input.userId ?? null,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId == null ? null : String(input.entityId),
    details: input.details == null ? null : JSON.stringify(input.details),
  });
}

export async function getLatestBackups(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: backups.id, filename: backups.filename, createdAt: backups.createdAt, createdBy: backups.createdBy }).from(backups).orderBy(desc(backups.createdAt)).limit(limit);
}

export async function getLatestAuditLogs(limit = 8) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

export { desc, eq, invoiceCounters, invoiceItems, invoices, services, settings, users, backups };
