import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    email: text("email").unique().notNull(),
    password: text("password").notNull(),
    name: text("name"),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
});

export const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull()
});

export const projects = sqliteTable("projects", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
});

export const projectMembers = sqliteTable("project_members", {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text("role").notNull().default('member'), // 'admin' | 'member'
});

export const boards = sqliteTable("boards", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    projectId: text("project_id").references(() => projects.id, { onDelete: 'set null' }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
});

export const boardMembers = sqliteTable("board_members", {
    boardId: text("board_id").notNull().references(() => boards.id, { onDelete: 'cascade' }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text("role").notNull().default('member'), // 'admin' | 'member'
});

export const lists = sqliteTable("lists", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    position: real("position").notNull().default(0),
    boardId: text("board_id").references(() => boards.id, { onDelete: 'cascade' }), // Made nullable for migration safety, but logic should enforce it
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
});

export const cards = sqliteTable("cards", {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    listId: text("list_id").notNull().references(() => lists.id, { onDelete: 'cascade' }),
    position: real("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
});
