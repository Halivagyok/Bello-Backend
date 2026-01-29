import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const lists = sqliteTable("lists", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    position: real("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
});

export const cards = sqliteTable("cards", {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    listId: text("list_id").notNull().references(() => lists.id, { onDelete: 'cascade' }),
    position: real("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
});
