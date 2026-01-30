// backend/src/index.ts
import { Elysia, t } from 'elysia';
// import { websocket } from '@elysiajs/websocket'; its deprecated, built-in now
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { lists, cards, users, sessions, boards, boardMembers, projects, projectMembers } from './db/schema';
import { eq, asc, and, desc } from 'drizzle-orm';

// 1. Setup Database
const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

// 2. Initialize App
// 2. Initialize App
const app = new Elysia()
    .use(cors({
        origin: 'http://localhost:5173', // Vite default port
        credentials: true,
        allowedHeaders: ['Content-Type', 'Cookie']
    }));

const broadcastUpdate = (boardId: string) => {
    app.server?.publish(`board-${boardId}`, JSON.stringify({ type: 'update' }));
};

app
    .use(swagger())
    // --- WEBSOCKET ---
    // .use(websocket()) // Built-in now
    .ws('/ws', {
        open(ws) {
            console.log('WS Connected');
        },
        message(ws, message: any) {
            if (message.type === 'subscribe' && message.boardId) {
                ws.subscribe(`board-${message.boardId}`);
                console.log(`Subscribed to board-${message.boardId}`);
            }
            if (message.type === 'unsubscribe' && message.boardId) {
                ws.unsubscribe(`board-${message.boardId}`);
            }
        },
        close(ws) {
            console.log('WS Closed');
        }
    })

    // --- AUTHENTICATION ---
    .group('/auth', (app) => app
        .post('/signup', async ({ body, set }) => {
            const existing = await db.select().from(users).where(eq(users.email, body.email)).get();
            if (existing) {
                set.status = 400;
                return { error: 'Email already exists' };
            }

            const hashedPassword = await Bun.password.hash(body.password);
            const user = {
                id: crypto.randomUUID(),
                email: body.email,
                password: hashedPassword,
                name: body.name
            };

            await db.insert(users).values(user);

            // Create Session
            const session = {
                id: crypto.randomUUID(),
                userId: user.id,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // 7 days
            };
            await db.insert(sessions).values(session);

            set.headers['Set-Cookie'] = `session_id=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
            return { user: { id: user.id, email: user.email, name: user.name } };
        }, {
            body: t.Object({
                email: t.String(),
                password: t.String(),
                name: t.Optional(t.String())
            })
        })

        .post('/login', async ({ body, set }) => {
            const user = await db.select().from(users).where(eq(users.email, body.email)).get();
            if (!user) {
                set.status = 400;
                return { error: 'Invalid credentials' };
            }

            const valid = await Bun.password.verify(body.password, user.password);
            if (!valid) {
                set.status = 400;
                return { error: 'Invalid credentials' };
            }

            // Create Session
            const session = {
                id: crypto.randomUUID(),
                userId: user.id,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // 7 days
            };
            await db.insert(sessions).values(session);

            set.headers['Set-Cookie'] = `session_id=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
            return { user: { id: user.id, email: user.email, name: user.name } };
        }, {
            body: t.Object({
                email: t.String(),
                password: t.String()
            })
        })

        .post('/logout', async ({ cookie, set }) => {
            const sessionId = cookie.session_id?.value;
            if (sessionId && typeof sessionId === 'string') {
                await db.delete(sessions).where(eq(sessions.id, sessionId));
            }
            set.headers['Set-Cookie'] = `session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
            return { success: true };
        })

        .get('/me', async ({ cookie }) => {
            const sessionId = cookie.session_id?.value;
            if (!sessionId || typeof sessionId !== 'string') return { user: null };

            const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
            if (!session || session.expiresAt < new Date()) return { user: null };

            const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
            if (!user) return { user: null };

            return { user: { id: user.id, email: user.email, name: user.name } };
        })
    )

    // --- PROTECTED ROUTES ---
    .derive(async ({ cookie, set }) => {
        const sessionId = cookie.session_id?.value;
        if (!sessionId || typeof sessionId !== 'string') return { user: null };

        const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
        if (!session || session.expiresAt < new Date()) return { user: null };

        const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
        return { user };
    })
    .onBeforeHandle(({ user, set }) => {
        if (!user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }
    })

    // --- PROJECTS ---
    .group('/projects', (app) => app
        .get('/', async ({ user }) => {
            // Get projects where user is owner or member
            const memberProjects = await db.select({
                projectId: projectMembers.projectId
            }).from(projectMembers).where(eq(projectMembers.userId, user!.id));

            const projectIds = memberProjects.map(m => m.projectId);

            const allProjects = await db.select().from(projects);
            return allProjects.filter(p => p.ownerId === user!.id || projectIds.includes(p.id));
        })

        .post('/', async ({ body, user }) => {
            const newProject = {
                id: crypto.randomUUID(),
                title: body.title,
                description: body.description,
                ownerId: user!.id,
            };
            await db.insert(projects).values(newProject);
            // Add owner as admin member
            await db.insert(projectMembers).values({ projectId: newProject.id, userId: user!.id, role: 'admin' });
            return newProject;
        }, {
            body: t.Object({
                title: t.String(),
                description: t.Optional(t.String())
            })
        })

        // Get Project Details (including BOARDS in that project)
        .get('/:id', async ({ params, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Check Access
            const isMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();

            if (project.ownerId !== user!.id && !isMember) {
                set.status = 403; return { error: 'Forbidden' };
            }
            return project;
        })
    )

    // --- BOARDS ---
    .group('/boards', (app) => app
        .get('/', async ({ user }) => {
            // Get boards where user is owner OR member
            const memberBoards = await db.select({
                boardId: boardMembers.boardId
            }).from(boardMembers).where(eq(boardMembers.userId, user!.id));

            const boardIds = memberBoards.map(m => m.boardId);

            const allBoards = await db.select().from(boards);

            // Return all relevant boards. Frontend will group them.
            return allBoards.filter(b => b.ownerId === user!.id || boardIds.includes(b.id));
        })

        .post('/', async ({ body, user }) => {
            const newBoard = {
                id: crypto.randomUUID(),
                title: body.title,
                projectId: body.projectId,
                ownerId: user!.id,
            };
            await db.insert(boards).values(newBoard);
            // Add owner as member
            await db.insert(boardMembers).values({ boardId: newBoard.id, userId: user!.id, role: 'admin' });

            return newBoard;
        }, {
            body: t.Object({
                title: t.String(),
                projectId: t.Optional(t.String())
            })
        })

        .get('/:id', async ({ params, user, set }) => {
            // Check Access
            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user!.id))).get();

            if (!isMember) {
                set.status = 403;
                return { error: 'Forbidden' };
            }

            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            const allLists = await db.select().from(lists).where(eq(lists.boardId, params.id)).orderBy(asc(lists.position));

            const listIds = allLists.map(l => l.id);
            const allCards = listIds.length > 0
                // This is a bit inefficient, usually we'd do a join or whereIn
                // But Drizzle SQLite whereIn can be tricky if list is empty
                ? (await db.select().from(cards)).filter(c => listIds.includes(c.listId)).sort((a, b) => a.position - b.position)
                : [];

            const members = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: boardMembers.role
            })
                .from(boardMembers)
                .innerJoin(users, eq(users.id, boardMembers.userId))
                .where(eq(boardMembers.boardId, params.id));

            return {
                ...board,
                members,
                lists: allLists.map(list => ({
                    ...list,
                    cards: allCards.filter(card => card.listId === list.id)
                }))
            };
        })

        .post('/:id/invite', async ({ params, body, user, set }) => {
            // Check if user is admin/owner
            const memberFn = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user!.id))).get();

            if (!memberFn || memberFn.role !== 'admin') {
                set.status = 403;
                return { error: 'Only admins can invite' };
            }

            const targetUser = await db.select().from(users).where(eq(users.email, body.email)).get();
            if (!targetUser) {
                set.status = 404;
                return { error: 'User not found' };
            }

            // Check if already member
            const existing = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, targetUser.id))).get();

            if (existing) return { message: 'User already a member' };

            await db.insert(boardMembers).values({
                boardId: params.id,
                userId: targetUser.id,
                role: 'member'
            });

            return { success: true };

        }, {
            body: t.Object({ email: t.String() })
        })

        // --- LISTS (Scoped to Board) ---
        .post('/:id/lists', async ({ params, body, user, set }) => {
            // Check Access
            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            const newList = {
                id: crypto.randomUUID(),
                title: body.title,
                position: body.position ?? Date.now(),
                boardId: params.id
            };
            await db.insert(lists).values(newList);
            broadcastUpdate(params.id);
            return newList;
        }, {
            body: t.Object({
                title: t.String(),
                position: t.Optional(t.Number())
            })
        })
    )

    // --- CARDS (Global or Scoped?) ---
    // Ideally we should scope card changes to boards too for security.
    // simpler: check if user is member of the list's board.
    .group('/cards', (app) => app
        .post('/', async ({ body, user, set }) => {
            // Get List to find Board
            const list = await db.select().from(lists).where(eq(lists.id, body.listId)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }

            // Check Access
            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            const newCard = {
                id: crypto.randomUUID(),
                content: body.content,
                listId: body.listId,
                position: body.position ?? Date.now()
            };
            await db.insert(cards).values(newCard);

            // Broadcast
            broadcastUpdate(list.boardId);

            return newCard;
        }, {
            body: t.Object({
                content: t.String(),
                listId: t.String(),
                position: t.Optional(t.Number())
            })
        })

        .patch('/:id', async ({ params, body, user, set }) => {
            const card = await db.select().from(cards).where(eq(cards.id, params.id)).get();
            if (!card) { set.status = 404; return { error: 'Card not found' }; }

            const list = await db.select().from(lists).where(eq(lists.id, card.listId)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; } // should not happen

            // Check Access to current board
            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            // If moving to another list, check access to that list's board (if different - usually same board)
            if (body.listId) {
                const newList = await db.select().from(lists).where(eq(lists.id, body.listId)).get();
                if (!newList || !newList.boardId) return { error: 'Target list not found' };
                const isMemberNew = await db.select().from(boardMembers)
                    .where(and(eq(boardMembers.boardId, newList.boardId), eq(boardMembers.userId, user!.id))).get();
                if (!isMemberNew) { set.status = 403; return { error: 'Forbidden' }; }
            }

            const [updated] = await db.update(cards)
                .set(body)
                .where(eq(cards.id, params.id))
                .returning();

            // Broadcast
            broadcastUpdate(list.boardId);
            if (body.listId && body.listId !== card.listId) {
                // Potentially broadcast to old board if moving boards, but for now assum same board
            }

            return updated;
        }, {
            body: t.Object({
                content: t.Optional(t.String()),
                listId: t.Optional(t.String()),
                position: t.Optional(t.Number())
            })
        })

        .delete('/:id', async ({ params, user, set }) => {
            const card = await db.select().from(cards).where(eq(cards.id, params.id)).get();
            if (!card) { set.status = 404; return { error: 'Card not found' }; }

            const list = await db.select().from(lists).where(eq(lists.id, card.listId)).get();
            if (!list || !list.boardId) return { error: 'List error' };

            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            await db.delete(cards).where(eq(cards.id, params.id));
            broadcastUpdate(list.boardId);
            return { success: true };
        })
    )

    // Lists (Delete/Update)
    .group('/lists', (app) => app
        .patch('/:id', async ({ params, body, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) return { error: 'List not found' };

            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            const [updated] = await db.update(lists)
                .set(body)
                .where(eq(lists.id, params.id))
                .returning();
            broadcastUpdate(list.boardId);
            return updated;
        }, {
            body: t.Object({
                title: t.Optional(t.String()),
                position: t.Optional(t.Number())
            })
        })

        .delete('/:id', async ({ params, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) return { error: 'List not found' };

            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            await db.delete(lists).where(eq(lists.id, params.id));
            broadcastUpdate(list.boardId);
            return { success: true };
        })
    )

    .get('/api/ping', () => ({ message: "Backend Connected! 🚀" }))

    .listen(3000);

export type App = typeof app;

console.log(`🦊 Backend running at http://localhost:3000`);