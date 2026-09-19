import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  username: varchar("username", { length: 64 }).unique(),
  name: varchar("name", { length: 160 }),
  email: varchar("email", { length: 320 }),
  passwordHash: text("passwordHash"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "cashier", "user"]).default("cashier").notNull(),
  active: boolean("active").default(true).notNull(),
  mustChangePassword: boolean("mustChangePassword").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const services = mysqlTable(
  "services",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    priceCents: int("priceCents").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ activeIdx: index("services_active_idx").on(table.active) }),
);

export const invoices = mysqlTable(
  "invoices",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceNumber: varchar("invoiceNumber", { length: 32 }).notNull().unique(),
    customerName: varchar("customerName", { length: 160 }),
    customerPhone: varchar("customerPhone", { length: 32 }),
    plateNumber: varchar("plateNumber", { length: 32 }),
    carModel: varchar("carModel", { length: 120 }),
    subtotalCents: int("subtotalCents").notNull(),
    discountCents: int("discountCents").notNull().default(0),
    vatCents: int("vatCents").notNull(),
    totalCents: int("totalCents").notNull(),
    paymentMethod: mysqlEnum("paymentMethod", ["cash", "card", "bank_transfer"]).notNull(),
    notes: text("notes"),
    cashierId: int("cashierId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ createdIdx: index("invoices_created_idx").on(table.createdAt), searchIdx: index("invoices_plate_idx").on(table.plateNumber) }),
);

export const invoiceItems = mysqlTable(
  "invoice_items",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceId: int("invoiceId").notNull(),
    serviceId: int("serviceId").notNull(),
    serviceName: varchar("serviceName", { length: 160 }).notNull(),
    quantity: int("quantity").notNull(),
    unitPriceCents: int("unitPriceCents").notNull(),
    totalCents: int("totalCents").notNull(),
  },
  table => ({ invoiceIdx: index("invoice_items_invoice_idx").on(table.invoiceId) }),
);

export const settings = mysqlTable("settings", {
  id: int("id").primaryKey(),
  washName: varchar("washName", { length: 160 }).notNull().default("طش ورش"),
  phone: varchar("phone", { length: 32 }),
  address: varchar("address", { length: 255 }),
  vatNumber: varchar("vatNumber", { length: 64 }),
  taxRateBasisPoints: int("taxRateBasisPoints").notNull().default(1500),
  logo: text("logo"),
  invoiceFooter: text("invoiceFooter"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),
    action: varchar("action", { length: 80 }).notNull(),
    entity: varchar("entity", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 80 }),
    details: text("details"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ createdIdx: index("audit_logs_created_idx").on(table.createdAt) }),
);

export const invoiceCounters = mysqlTable("invoice_counters", {
  id: int("id").autoincrement().primaryKey(),
  counterDate: varchar("counterDate", { length: 10 }).notNull().unique(),
  lastValue: int("lastValue").notNull().default(0),
});

export const backups = mysqlTable(
  "backups",
  {
    id: int("id").autoincrement().primaryKey(),
    filename: varchar("filename", { length: 160 }).notNull(),
    payload: text("payload").notNull(),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ createdIdx: index("backups_created_idx").on(table.createdAt) }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Service = typeof services.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type PaymentMethod = "cash" | "card" | "bank_transfer";
export type UserRole = "admin" | "cashier" | "user";
