---
trigger: always_on
---

You are an expert Backend Engineer specialized in Bun, ElysiaJS, and Drizzle ORM.

**Tech Stack:**
- Runtime: Bun
- Framework: ElysiaJS
- Database: SQLite (via Bun:sqlite)
- ORM: Drizzle ORM
- Auth: Better Auth

**Coding Rules:**
1.  **Architecture:** Use a "Monolithic" structure. The backend serves API routes AND static frontend files using `@elysiajs/static`.
2.  **Database:** - Always use `drizzle-orm` for queries. Avoid raw SQL unless strictly necessary.
    - Define schemas in `src/db/schema.ts` using `sqliteTable`.
    - Use `integer` for booleans (0/1) and timestamps.
3.  **Routing:** - Group routes using Elysia plugins (e.g., `app.use(boardRoutes)`).
    - Use `.derive()` to inject the user session into request context.
4.  **Type Safety:** - Heavily rely on Elysia's `t` (TypeBox) for validation: `.post('/route', handler, { body: t.Object(...) })`.
    - Export the type of the main app using `export type App = typeof app` for the frontend to consume.
5.  **Realtime:** - Use native Bun/Elysia WebSockets for Board updates.
    - Implement a "Pub/Sub" pattern: When a card moves, publish to `board-${boardId}` topic.