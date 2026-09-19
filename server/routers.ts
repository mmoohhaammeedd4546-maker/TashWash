import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, assertStrongPassword, verifyPassword } from "./auth";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { systemRouter } from "./_core/systemRouter";
import { invoiceCounters, invoiceItems, invoices, services, settings, users, backups } from "../drizzle/schema";

const paymentMethod = z.enum(["cash", "card", "bank_transfer"]);
const role = z.enum(["admin", "cashier", "user"]);
const money = z.number().int().min(0);

const getRequiredDb = async () => {
  const database = await db.getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بقاعدة البيانات" });
  return database;
};

const dateKey = (date = new Date()) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

const dateStart = (value?: string) => {
  const d = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
  if (!value) d.setUTCHours(0, 0, 0, 0);
  return d;
};

const dateEnd = (value?: string) => {
  const d = value ? new Date(`${value}T23:59:59.999Z`) : new Date();
  if (!value) d.setUTCHours(23, 59, 59, 999);
  return d;
};

const publicInvoice = (row: any) => ({
  ...row.invoice,
  cashierName: row.cashier?.name ?? "—",
  subtotal: row.invoice.subtotalCents / 100,
  discount: row.invoice.discountCents / 100,
  vat: row.invoice.vatCents / 100,
  total: row.invoice.totalCents / 100,
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => db.publicUser(ctx.user)),
    login: publicProcedure
      .input(z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserByUsername(input.username);
        if (!user || !user.active || !(await verifyPassword(input.password, user.passwordHash))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
        }
        const token = await sdk.createSessionToken(user.openId, { expiresInMs: ONE_YEAR_MS, name: user.name ?? user.username ?? "" });
        ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
        await db.writeAudit({ userId: user.id, action: "LOGIN", entity: "auth" });
        return db.publicUser(user);
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.user) await db.writeAudit({ userId: ctx.user.id, action: "LOGOUT", entity: "auth" });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200), confirmPassword: z.string().min(8).max(200) }))
      .mutation(async ({ ctx, input }) => {
        assertStrongPassword(input.newPassword);
        if (input.newPassword !== input.confirmPassword) throw new TRPCError({ code: "BAD_REQUEST", message: "تأكيد كلمة المرور غير مطابق" });
        if (!(await verifyPassword(input.currentPassword, ctx.user.passwordHash))) throw new TRPCError({ code: "UNAUTHORIZED", message: "كلمة المرور الحالية غير صحيحة" });
        const database = await getRequiredDb();
        await database.update(users).set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false }).where(eq(users.id, ctx.user.id));
        await db.writeAudit({ userId: ctx.user.id, action: "CHANGE_PASSWORD", entity: "users", entityId: ctx.user.id });
        return { success: true } as const;
      }),
  }),

  dashboard: router({
    summary: protectedProcedure.query(async () => {
      const database = await getRequiredDb();
      const start = dateStart();
      const today = await database.select().from(invoices).where(gte(invoices.createdAt, start)).orderBy(desc(invoices.createdAt)).limit(5000);
      const totals = today.reduce((acc, item) => {
        acc.invoices += 1;
        acc.sales += item.totalCents;
        acc.vat += item.vatCents;
        acc.discount += item.discountCents;
        acc[item.paymentMethod] += item.totalCents;
        return acc;
      }, { invoices: 0, sales: 0, vat: 0, discount: 0, cash: 0, card: 0, bank_transfer: 0 });
      const recentRows = await database.select({ invoice: invoices, cashier: { name: users.name } }).from(invoices).leftJoin(users, eq(invoices.cashierId, users.id)).orderBy(desc(invoices.createdAt)).limit(6);
      return { ...totals, recent: recentRows.map(publicInvoice) };
    }),
  }),

  services: router({
    list: protectedProcedure.input(z.object({ activeOnly: z.boolean().default(false) }).optional()).query(async ({ input }) => {
      const database = await getRequiredDb();
      const rows = input?.activeOnly ? await database.select().from(services).where(eq(services.active, true)).orderBy(services.name) : await database.select().from(services).orderBy(desc(services.createdAt));
      return rows.map(item => ({ ...item, price: item.priceCents / 100 }));
    }),
    create: adminProcedure.input(z.object({ name: z.string().trim().min(2).max(160), description: z.string().max(500).optional(), priceCents: money })).mutation(async ({ ctx, input }) => {
      const database = await getRequiredDb();
      const result = await database.insert(services).values({ ...input, description: input.description ?? null });
      await db.writeAudit({ userId: ctx.user.id, action: "CREATE", entity: "services", entityId: result[0].insertId, details: input });
      return { success: true } as const;
    }),
    update: adminProcedure.input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(2).max(160), description: z.string().max(500).nullable().optional(), priceCents: money })).mutation(async ({ ctx, input }) => {
      const database = await getRequiredDb();
      await database.update(services).set({ name: input.name, description: input.description ?? null, priceCents: input.priceCents }).where(eq(services.id, input.id));
      await db.writeAudit({ userId: ctx.user.id, action: "UPDATE", entity: "services", entityId: input.id, details: input });
      return { success: true } as const;
    }),
    toggle: adminProcedure.input(z.object({ id: z.number().int().positive(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
      const database = await getRequiredDb();
      await database.update(services).set({ active: input.active }).where(eq(services.id, input.id));
      await db.writeAudit({ userId: ctx.user.id, action: input.active ? "ACTIVATE" : "DEACTIVATE", entity: "services", entityId: input.id });
      return { success: true } as const;
    }),
    remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const database = await getRequiredDb();
      const linked = await database.select({ id: invoiceItems.id }).from(invoiceItems).where(eq(invoiceItems.serviceId, input.id)).limit(1);
      if (linked.length) throw new TRPCError({ code: "CONFLICT", message: "لا يمكن حذف خدمة مرتبطة بفواتير سابقة. عطّلها بدلًا من ذلك." });
      await database.delete(services).where(eq(services.id, input.id));
      await db.writeAudit({ userId: ctx.user.id, action: "DELETE", entity: "services", entityId: input.id });
      return { success: true } as const;
    }),
  }),

  invoices: router({
    list: protectedProcedure.input(z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(5).max(50).default(10), search: z.string().trim().max(100).default("") })).query(async ({ input }) => {
      const database = await getRequiredDb();
      const term = input.search ? `%${input.search}%` : null;
      const where = term ? or(like(invoices.invoiceNumber, term), like(invoices.customerName, term), like(invoices.customerPhone, term), like(invoices.plateNumber, term)) : undefined;
      const rows = await database.select({ invoice: invoices, cashier: { name: users.name } }).from(invoices).leftJoin(users, eq(invoices.cashierId, users.id)).where(where).orderBy(desc(invoices.createdAt)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
      return rows.map(publicInvoice);
    }),
    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
      const database = await getRequiredDb();
      const row = await database.select({ invoice: invoices, cashier: { name: users.name } }).from(invoices).leftJoin(users, eq(invoices.cashierId, users.id)).where(eq(invoices.id, input.id)).limit(1);
      if (!row[0]) throw new TRPCError({ code: "NOT_FOUND", message: "الفاتورة غير موجودة" });
      const items = await database.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
      return { ...publicInvoice(row[0]), items: items.map(item => ({ ...item, unitPrice: item.unitPriceCents / 100, total: item.totalCents / 100 })) };
    }),
    create: protectedProcedure.input(z.object({ customerName: z.string().trim().max(160).optional(), customerPhone: z.string().trim().max(32).optional(), plateNumber: z.string().trim().min(1).max(32), carModel: z.string().trim().max(120).optional(), items: z.array(z.object({ serviceId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1).max(30), discountCents: money.default(0), paymentMethod, notes: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
      const database = await getRequiredDb();
      const uniqueIds = Array.from(new Set(input.items.map(item => item.serviceId)));
      const serviceRows = await database.select().from(services).where(or(...uniqueIds.map(id => eq(services.id, id))));
      const serviceById = new Map(serviceRows.map(item => [item.id, item]));
      const normalizedItems = input.items.map(item => ({ ...item, service: serviceById.get(item.serviceId) })).filter(item => item.service?.active);
      if (normalizedItems.length !== input.items.length) throw new TRPCError({ code: "BAD_REQUEST", message: "تحتوي الفاتورة على خدمة غير متاحة" });
      const subtotalCents = normalizedItems.reduce((sum, item) => sum + item.service!.priceCents * item.quantity, 0);
      if (input.discountCents > subtotalCents) throw new TRPCError({ code: "BAD_REQUEST", message: "الخصم لا يمكن أن يتجاوز قيمة الخدمات" });
      const appSettings = await db.getSettings();
      const taxRateBasisPoints = appSettings?.taxRateBasisPoints ?? 1500;
      const taxable = subtotalCents - input.discountCents;
      const vatCents = Math.round(taxable * taxRateBasisPoints / 10000);
      const totalCents = taxable + vatCents;
      const created = await database.transaction(async tx => {
        const today = dateKey();
        await tx.insert(invoiceCounters).values({ counterDate: today, lastValue: 1 }).onDuplicateKeyUpdate({ set: { lastValue: sql`${invoiceCounters.lastValue} + 1` } });
        const counter = await tx.select().from(invoiceCounters).where(eq(invoiceCounters.counterDate, today)).limit(1);
        const number = `TW-${today}-${String(counter[0]?.lastValue ?? 1).padStart(6, "0")}`;
        const invoiceResult = await tx.insert(invoices).values({ invoiceNumber: number, customerName: input.customerName ?? null, customerPhone: input.customerPhone ?? null, plateNumber: input.plateNumber, carModel: input.carModel ?? null, subtotalCents, discountCents: input.discountCents, vatCents, totalCents, paymentMethod: input.paymentMethod, notes: input.notes ?? null, cashierId: ctx.user.id });
        const invoiceId = Number(invoiceResult[0].insertId);
        await tx.insert(invoiceItems).values(normalizedItems.map(item => ({ invoiceId, serviceId: item.serviceId, serviceName: item.service!.name, quantity: item.quantity, unitPriceCents: item.service!.priceCents, totalCents: item.service!.priceCents * item.quantity })));
        return { id: invoiceId, invoiceNumber: number };
      });
      await db.writeAudit({ userId: ctx.user.id, action: "CREATE", entity: "invoices", entityId: created.id, details: { invoiceNumber: created.invoiceNumber, totalCents } });
      return { ...created, subtotalCents, discountCents: input.discountCents, vatCents, totalCents };
    }),
  }),

  reports: router({
    summary: protectedProcedure.input(z.object({ from: z.string().optional(), to: z.string().optional() })).query(async ({ input }) => {
      const database = await getRequiredDb();
      const rows = await database.select().from(invoices).where(and(gte(invoices.createdAt, dateStart(input.from)), lte(invoices.createdAt, dateEnd(input.to)))).orderBy(desc(invoices.createdAt)).limit(10000);
      const totals = rows.reduce((acc, item) => { acc.count += 1; acc.sales += item.totalCents; acc.discount += item.discountCents; acc.vat += item.vatCents; acc[item.paymentMethod] += item.totalCents; return acc; }, { count: 0, sales: 0, discount: 0, vat: 0, cash: 0, card: 0, bank_transfer: 0 });
      const items = await database.select({ item: invoiceItems, invoice: invoices }).from(invoiceItems).innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id)).where(and(gte(invoices.createdAt, dateStart(input.from)), lte(invoices.createdAt, dateEnd(input.to)))).limit(20000);
      const servicesReport = Object.values(items.reduce<Record<string, { name: string; count: number; salesCents: number }>>((acc, row) => { const key = String(row.item.serviceId); acc[key] ??= { name: row.item.serviceName, count: 0, salesCents: 0 }; acc[key].count += row.item.quantity; acc[key].salesCents += row.item.totalCents; return acc; }, {}));
      return { ...totals, services: servicesReport };
    }),
  }),

  settings: router({
    get: protectedProcedure.query(async () => {
      const row = await db.getSettings();
      return row ? { ...row, taxRate: row.taxRateBasisPoints / 100 } : null;
    }),
    update: adminProcedure.input(z.object({ washName: z.string().trim().min(2).max(160), phone: z.string().max(32).nullable().optional(), address: z.string().max(255).nullable().optional(), vatNumber: z.string().max(64).nullable().optional(), taxRate: z.number().min(0).max(100), invoiceFooter: z.string().max(500).nullable().optional(), logo: z.string().max(500000).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const database = await getRequiredDb();
      await database.insert(settings).values({ id: 1, washName: input.washName, phone: input.phone ?? null, address: input.address ?? null, vatNumber: input.vatNumber ?? null, taxRateBasisPoints: Math.round(input.taxRate * 100), invoiceFooter: input.invoiceFooter ?? null, logo: input.logo ?? null }).onDuplicateKeyUpdate({ set: { washName: input.washName, phone: input.phone ?? null, address: input.address ?? null, vatNumber: input.vatNumber ?? null, taxRateBasisPoints: Math.round(input.taxRate * 100), invoiceFooter: input.invoiceFooter ?? null, logo: input.logo ?? null } });
      await db.writeAudit({ userId: ctx.user.id, action: "UPDATE", entity: "settings" });
      return { success: true } as const;
    }),
  }),

  users: router({
    list: adminProcedure.query(async () => {
      const database = await getRequiredDb();
      const rows = await database.select().from(users).orderBy(desc(users.createdAt));
      return rows.map(db.publicUser);
    }),
    create: adminProcedure.input(z.object({ username: z.string().trim().min(3).max(64), name: z.string().trim().min(2).max(160), role, password: z.string().min(8).max(200) })).mutation(async ({ ctx, input }) => {
      assertStrongPassword(input.password);
      const database = await getRequiredDb();
      const passwordHash = await hashPassword(input.password);
      try {
        const result = await database.insert(users).values({ openId: `local:${input.username}`, username: input.username, name: input.name, passwordHash, role: input.role, active: true, mustChangePassword: true, loginMethod: "password" });
        await db.writeAudit({ userId: ctx.user.id, action: "CREATE", entity: "users", entityId: result[0].insertId });
        return { success: true } as const;
      } catch { throw new TRPCError({ code: "CONFLICT", message: "اسم المستخدم مستخدم بالفعل" }); }
    }),
    update: adminProcedure.input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(2).max(160), role, active: z.boolean(), password: z.string().min(8).max(200).optional() })).mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id && !input.active) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكنك تعطيل حسابك الحالي" });
      const database = await getRequiredDb();
      const patch: any = { name: input.name, role: input.role, active: input.active };
      if (input.password) { assertStrongPassword(input.password); patch.passwordHash = await hashPassword(input.password); patch.mustChangePassword = true; }
      await database.update(users).set(patch).where(eq(users.id, input.id));
      await db.writeAudit({ userId: ctx.user.id, action: "UPDATE", entity: "users", entityId: input.id });
      return { success: true } as const;
    }),
  }),

  backup: router({
    list: adminProcedure.query(() => db.getLatestBackups()),
    create: adminProcedure.mutation(async ({ ctx }) => {
      const database = await getRequiredDb();
      const [userRows, serviceRows, settingsRows, invoiceRows, itemRows] = await Promise.all([
        database.select({ id: users.id, username: users.username, name: users.name, role: users.role, active: users.active }).from(users),
        database.select().from(services),
        database.select().from(settings),
        database.select().from(invoices),
        database.select().from(invoiceItems),
      ]);
      const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), users: userRows, services: serviceRows, settings: settingsRows, invoices: invoiceRows, invoiceItems: itemRows });
      const filename = `tashwash-backup-${dateKey()}-${Date.now()}.json`;
      await database.insert(backups).values({ filename, payload, createdBy: ctx.user.id });
      await db.writeAudit({ userId: ctx.user.id, action: "BACKUP", entity: "backups", details: { filename } });
      return { filename, payload };
    }),
    download: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
      const database = await getRequiredDb();
      const row = await database.select({ filename: backups.filename, payload: backups.payload }).from(backups).where(eq(backups.id, input.id)).limit(1);
      if (!row[0]) throw new TRPCError({ code: "NOT_FOUND", message: "النسخة غير موجودة" });
      return row[0];
    }),
    validate: adminProcedure.input(z.object({ payload: z.string().min(10).max(10000000) })).mutation(({ input }) => {
      try {
        const parsed = JSON.parse(input.payload);
        const valid = parsed?.version === 1 && Array.isArray(parsed.services) && Array.isArray(parsed.invoices) && Array.isArray(parsed.invoiceItems);
        return { valid, message: valid ? "النسخة سليمة وقابلة للقراءة" : "ملف النسخة لا يطابق صيغة TashWash" };
      } catch { return { valid: false, message: "ملف النسخة غير صالح" }; }
    }),
    restore: adminProcedure.input(z.object({ payload: z.string().min(10).max(10000000), confirmation: z.literal("RESTORE") })).mutation(async ({ ctx, input }) => {
      let parsed: any;
      try { parsed = JSON.parse(input.payload); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "ملف النسخة غير صالح" }); }
      if (parsed?.version !== 1 || !Array.isArray(parsed.services) || !Array.isArray(parsed.invoices) || !Array.isArray(parsed.invoiceItems)) throw new TRPCError({ code: "BAD_REQUEST", message: "صيغة النسخة غير مدعومة" });
      const database = await getRequiredDb();
      const [currentServices, currentSettings, currentInvoices, currentItems] = await Promise.all([
        database.select().from(services), database.select().from(settings), database.select().from(invoices), database.select().from(invoiceItems),
      ]);
      const beforePayload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), services: currentServices, settings: currentSettings, invoices: currentInvoices, invoiceItems: currentItems });
      const beforeFilename = `tashwash-pre-restore-${dateKey()}-${Date.now()}.json`;
      await database.insert(backups).values({ filename: beforeFilename, payload: beforePayload, createdBy: ctx.user.id });
      await database.transaction(async tx => {
        await tx.delete(invoiceItems);
        await tx.delete(invoices);
        await tx.delete(invoiceCounters);
        await tx.delete(services);
        if (parsed.services.length) await tx.insert(services).values(parsed.services.map((item: any) => ({ id: Number(item.id), name: String(item.name), description: item.description ?? null, priceCents: Number(item.priceCents), active: item.active !== false })));
        if (Array.isArray(parsed.settings) && parsed.settings.length) {
          const item = parsed.settings[0];
          await tx.insert(settings).values({ id: 1, washName: String(item.washName || "طش ورش"), phone: item.phone ?? null, address: item.address ?? null, vatNumber: item.vatNumber ?? null, taxRateBasisPoints: Number(item.taxRateBasisPoints || 1500), logo: item.logo ?? null, invoiceFooter: item.invoiceFooter ?? null });
        }
        if (parsed.invoices.length) await tx.insert(invoices).values(parsed.invoices.map((item: any) => ({ id: Number(item.id), invoiceNumber: String(item.invoiceNumber), customerName: item.customerName ?? null, customerPhone: item.customerPhone ?? null, plateNumber: item.plateNumber ?? null, carModel: item.carModel ?? null, subtotalCents: Number(item.subtotalCents), discountCents: Number(item.discountCents), vatCents: Number(item.vatCents), totalCents: Number(item.totalCents), paymentMethod: item.paymentMethod, notes: item.notes ?? null, cashierId: Number(item.cashierId) })));
        if (parsed.invoiceItems.length) await tx.insert(invoiceItems).values(parsed.invoiceItems.map((item: any) => ({ id: Number(item.id), invoiceId: Number(item.invoiceId), serviceId: Number(item.serviceId), serviceName: String(item.serviceName), quantity: Number(item.quantity), unitPriceCents: Number(item.unitPriceCents), totalCents: Number(item.totalCents) })));
        const counters = new Map<string, number>();
        for (const item of parsed.invoices) { const key = dateKey(new Date(item.createdAt || Date.now())); counters.set(key, Math.max(counters.get(key) || 0, Number(String(item.invoiceNumber).split("-").pop()) || 0)); }
        if (counters.size) await tx.insert(invoiceCounters).values(Array.from(counters.entries()).map(([counterDate, lastValue]) => ({ counterDate, lastValue })));
      });
      await db.writeAudit({ userId: ctx.user.id, action: "RESTORE", entity: "backups", details: { beforeFilename } });
      return { success: true, beforeFilename } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
