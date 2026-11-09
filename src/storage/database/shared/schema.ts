import { pgTable, serial, varchar, integer, timestamp, text, index } from "drizzle-orm/pg-core"

// 社团表
export const clubs = pgTable(
  "clubs",
  {
    id: serial().notNull().primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    grade: varchar("grade", { length: 20 }),
    description: text("description"),
    totalQuota: integer("total_quota").notNull().default(50),
    remainingQuota: integer("remaining_quota").notNull().default(50),
    manager: varchar("manager", { length: 50 }), // 社团负责人
    managerContact: varchar("manager_contact", { length: 100 }), // 社团负责人联系方式
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [
    index("clubs_name_idx").on(table.name),
  ]
);

// 学生信息表
export const students = pgTable(
  "students",
  {
    id: serial().notNull().primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    idCard: varchar("id_card", { length: 18 }).notNull().unique(), // 身份证号
    className: varchar("class_name", { length: 100 }).notNull(),
    grade: varchar("grade", { length: 10 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index("students_id_card_idx").on(table.idCard),
    index("students_name_idx").on(table.name),
  ]
);

// 报名记录表
export const registrations = pgTable(
  "registrations",
  {
    id: serial().notNull().primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    idCardHash: varchar("id_card_hash", { length: 64 }).notNull(), // SHA-256 加密后的身份证号
    className: varchar("class_name", { length: 100 }).notNull(),
    clubId: integer("club_id").notNull().references(() => clubs.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  },
  (table) => [
    index("registrations_club_id_idx").on(table.clubId),
    index("registrations_id_card_hash_idx").on(table.idCardHash),
  ]
);

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});
