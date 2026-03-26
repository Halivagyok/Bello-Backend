import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    email: text("email").unique().notNull(),
    password: text("password").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
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
    boardIds: text("board_ids", { mode: "json" }).$type<string[]>(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const projectMembers = sqliteTable("project_members", {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: 'cascade' }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text("role").notNull().default('member'), // 'owner' | 'admin' | 'member' | 'viewer'
});

export const boards = sqliteTable("boards", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    projectId: text("project_id").references(() => projects.id, { onDelete: 'set null' }),
    visibility: text("visibility").notNull().default('workspace'), // 'private' | 'workspace' | 'public'
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const boardMembers = sqliteTable("board_members", {
    boardId: text("board_id").notNull().references(() => boards.id, { onDelete: 'cascade' }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text("role").notNull().default('member'), // 'owner' | 'admin' | 'member' | 'viewer'
});

export const lists = sqliteTable("lists", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    position: real("position").notNull().default(0),
    boardId: text("board_id").references(() => boards.id, { onDelete: 'cascade' }), // Made nullable for migration safety, but logic should enforce it
    ownerId: text("owner_id").references(() => users.id, { onDelete: 'set null' }),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const cards = sqliteTable("cards", {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    description: text("description"),
    dueDate: integer("due_date", { mode: "timestamp" }),
    dueDateMode: text("due_date_mode").default('full'), // 'full', 'date-only', 'time-only'
    imageUrl: text("image_url"),
    location: text("location"),
    locationLat: real("location_lat"),
    locationLng: real("location_lng"),
    listId: text("list_id").notNull().references(() => lists.id, { onDelete: 'cascade' }),
    position: real("position").notNull().default(0),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const images = sqliteTable("images", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const labels = sqliteTable("labels", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    color: text("color").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const cardLabels = sqliteTable("card_labels", {
    cardId: text("card_id").notNull().references(() => cards.id, { onDelete: 'cascade' }),
    labelId: text("label_id").notNull().references(() => labels.id, { onDelete: 'cascade' }),
});
