// backend/src/index.ts
import { Elysia, t } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { lists, cards } from './db/schema';
import { eq, asc } from 'drizzle-orm';

// 1. Setup Database
const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

// 2. Initialize App
const app = new Elysia()
    .use(cors())
    .use(swagger())

    // --- LISTS ROUTES ---

    // Get All Lists (with Cards)
    .get('/lists', async () => {
        const allLists = await db.select().from(lists).orderBy(asc(lists.position));
        const allCards = await db.select().from(cards).orderBy(asc(cards.position));

        // Combine manually (or use Drizzle query builder if relations were mapped)
        return allLists.map(list => ({
            ...list,
            cards: allCards.filter(card => card.listId === list.id)
        }));
    })

    // Create List
    .post('/lists', async ({ body }) => {
        const newList = {
            id: crypto.randomUUID(),
            title: body.title,
            position: body.position ?? Date.now(), // Default to end
        };
        await db.insert(lists).values(newList);
        return newList;
    }, {
        body: t.Object({
            title: t.String(),
            position: t.Optional(t.Number())
        })
    })

    // Update List (Title)
    .patch('/lists/:id', async ({ params, body }) => {
        const [updated] = await db.update(lists)
            .set(body)
            .where(eq(lists.id, params.id))
            .returning();
        return updated;
    }, {
        body: t.Object({
            title: t.Optional(t.String()),
            position: t.Optional(t.Number())
        })
    })

    // Delete List
    .delete('/lists/:id', async ({ params }) => {
        await db.delete(lists).where(eq(lists.id, params.id));
        return { success: true };
    })

    // --- CARDS ROUTES ---

    // Create Card
    .post('/cards', async ({ body }) => {
        const newCard = {
            id: crypto.randomUUID(),
            content: body.content,
            listId: body.listId,
            position: body.position ?? Date.now()
        };
        await db.insert(cards).values(newCard);
        return newCard;
    }, {
        body: t.Object({
            content: t.String(),
            listId: t.String(),
            position: t.Optional(t.Number())
        })
    })

    // Update Card (Content or Move)
    .patch('/cards/:id', async ({ params, body }) => {
        const [updated] = await db.update(cards)
            .set(body)
            .where(eq(cards.id, params.id))
            .returning();
        return updated;
    }, {
        body: t.Object({
            content: t.Optional(t.String()),
            listId: t.Optional(t.String()), // Allow moving to another list
            position: t.Optional(t.Number())
        })
    })

    // Delete Card
    .delete('/cards/:id', async ({ params }) => {
        await db.delete(cards).where(eq(cards.id, params.id));
        return { success: true };
    })

    // Health Check
    .get('/api/ping', () => ({ message: "Backend Connected! 🚀" }))

    .listen(3000);

// Export type for Eden
export type App = typeof app;

console.log(`🦊 Backend running at http://localhost:3000`);