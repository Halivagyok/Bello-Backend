// backend/src/index.ts
import { Elysia, t } from 'elysia';
// import { websocket } from '@elysiajs/websocket'; its deprecated, built-in now
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { lists, cards, users, sessions, boards, boardMembers, projects, projectMembers } from './db/schema';
import { eq, asc, and, desc, sql, inArray } from 'drizzle-orm';

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

const broadcastProjectUpdate = (projectId: string) => {
    app.server?.publish(`project-${projectId}`, JSON.stringify({ type: 'project-update' }));
};

const broadcastUserUpdate = (userId: string) => {
    app.server?.publish(`user-${userId}`, JSON.stringify({ type: 'user-update' }));
};

app
    .use(swagger())
    // --- WEBSOCKET ---
    // .use(websocket()) // Built-in now
    .ws('/ws', {
        open(ws) {
            console.log('WS Connected');
        },
        message(ws, rawMessage: any) {
            const message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
            if (message.type === 'subscribe' && message.boardId) {
                ws.subscribe(`board-${message.boardId}`);
                console.log(`Subscribed to board-${message.boardId}`);
            }
            if (message.type === 'subscribe-project' && message.projectId) {
                ws.subscribe(`project-${message.projectId}`);
                console.log(`Subscribed to project-${message.projectId}`);
            }
            if (message.type === 'subscribe-user' && message.userId) {
                ws.subscribe(`user-${message.userId}`);
                console.log(`Subscribed to user-${message.userId}`);
            }
            if (message.type === 'unsubscribe' && message.boardId) {
                ws.unsubscribe(`board-${message.boardId}`);
            }
            if (message.type === 'unsubscribe-project' && message.projectId) {
                ws.unsubscribe(`project-${message.projectId}`);
            }
            if (message.type === 'unsubscribe-user' && message.userId) {
                ws.unsubscribe(`user-${message.userId}`);
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
            return { user: { id: user.id, email: user.email, name: user.name, isAdmin: false } };
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

            if (user.isBanned) {
                set.status = 403;
                return { error: 'Your account has been banned.' };
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
            return { user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } };
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
            if (user.isBanned) return { user: null };

            return { user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } };
        })
    )

    // --- PROTECTED ROUTES ---
    .derive(async ({ cookie, set }) => {
        const sessionId = cookie.session_id?.value;
        if (!sessionId || typeof sessionId !== 'string') return { user: null };

        const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
        if (!session || session.expiresAt < new Date()) return { user: null };

        const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
        if (user?.isBanned) return { user: null };
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
            const members = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: projectMembers.role,
                isAdmin: users.isAdmin
            })
                .from(projectMembers)
                .innerJoin(users, eq(users.id, projectMembers.userId))
                .where(eq(projectMembers.projectId, params.id));

            return { ...project, members };
        })

        .post('/:id/invite', async ({ params, body, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Check Access (Owner or Member) - simplified, generally members can invite
            const isMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();

            if (project.ownerId !== user!.id && !isMember) {
                set.status = 403; return { error: 'Forbidden' };
            }

            const targetUser = await db.select().from(users).where(eq(users.email, body.email)).get();
            if (!targetUser) { set.status = 404; return { error: 'User not found' }; }

            // Check if already member
            const existing = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, targetUser.id))).get();

            if (existing) return { message: 'Already a member' };

            await db.insert(projectMembers).values({
                projectId: params.id,
                userId: targetUser.id,
                role: 'member'
            });

            // Broadcast to all boards in project
            const projectBoards = await db.select().from(boards).where(eq(boards.projectId, params.id));
            for (const board of projectBoards) {
                broadcastUpdate(board.id);
            }
            broadcastProjectUpdate(params.id);
            broadcastUserUpdate(targetUser.id);

            return { success: true };
        }, {
            body: t.Object({
                email: t.String()
            })
        })

        .delete('/:id/members/:userId', async ({ params, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Allow if Project Owner OR System Admin
            if (project.ownerId !== user!.id && !user!.isAdmin) {
                set.status = 403;
                return { error: 'Forbidden' };
            }

            // Prevent removing the owner
            if (project.ownerId === params.userId) {
                set.status = 400;
                return { error: 'Cannot remove project owner' };
            }

            await db.delete(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, params.userId)));

            // Find all boards in this project and broadcast update to potentially kick users out of open boards
            const projectBoards = await db.select().from(boards).where(eq(boards.projectId, params.id));
            for (const board of projectBoards) {
                broadcastUpdate(board.id);
            }
            broadcastProjectUpdate(params.id);
            broadcastUserUpdate(params.userId);

            return { success: true };
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
                ? await db.select().from(cards).where(inArray(cards.listId, listIds)).orderBy(asc(cards.position))
                : [];

            const members = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: boardMembers.role,
                isAdmin: users.isAdmin
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

            broadcastUpdate(params.id);
            broadcastUserUpdate(targetUser.id);

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
                boardId: params.id,
                color: body.color
            };
            await db.insert(lists).values(newList);
            broadcastUpdate(params.id);
            return newList;
        }, {
            body: t.Object({
                title: t.String(),
                position: t.Optional(t.Number()),
                color: t.Optional(t.String())
            })
        })

        .delete('/:id/members/:userId', async ({ params, user, set }) => {
            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            if (!board) { set.status = 404; return { error: 'Board not found' }; }

            // Allow if Board Owner OR System Admin
            if (board.ownerId !== user!.id && !user!.isAdmin) {
                set.status = 403;
                return { error: 'Forbidden' };
            }

            // Prevent removing the owner
            if (board.ownerId === params.userId) {
                set.status = 400;
                return { error: 'Cannot remove board owner' };
            }

            await db.delete(boardMembers)
                .where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, params.userId)));

            broadcastUpdate(params.id);
            broadcastUserUpdate(params.userId);

            return { success: true };
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
                if (!newList || !newList.boardId) { set.status = 404; return { error: 'Target list not found' }; }
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
            if (!list || !list.boardId) { set.status = 404; return { error: 'List error' }; }

            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            await db.delete(cards).where(eq(cards.id, params.id));
            broadcastUpdate(list.boardId);
            return { success: true };
        })
    )

    // Lists (Delete/Update/Duplicate/Move/Sort)
    .group('/lists', (app) => app
        .post('/:id/duplicate', async ({ params, body, user, set }) => {
            const sourceList = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!sourceList || !sourceList.boardId) { set.status = 404; return { error: 'List not found' }; }

            const listBoardId = sourceList.boardId;
            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, listBoardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            const newList = {
                id: crypto.randomUUID(),
                title: body.title || `Copy of ${sourceList.title}`,
                position: sourceList.position + 100,
                boardId: listBoardId,
                color: sourceList.color
            };
            await db.insert(lists).values(newList);

            const sourceCards = await db.select().from(cards).where(eq(cards.listId, params.id));
            if (sourceCards.length > 0) {
                const newCards = sourceCards.map(c => ({
                    id: crypto.randomUUID(),
                    content: c.content,
                    listId: newList.id,
                    position: c.position,
                    createdAt: new Date()
                }));
                await db.insert(cards).values(newCards);
            }

            broadcastUpdate(listBoardId);
            return newList;
        }, {
            body: t.Object({ title: t.Optional(t.String()) })
        })

        .post('/:id/move-cards', async ({ params, body, user, set }) => {
            const sourceList = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!sourceList || !sourceList.boardId) { set.status = 404; return { error: 'List not found' }; }

            const targetList = await db.select().from(lists).where(eq(lists.id, body.targetListId)).get();
            if (!targetList || !targetList.boardId) { set.status = 404; return { error: 'Target list not found' }; }

            const isMemberSource = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, sourceList.boardId), eq(boardMembers.userId, user!.id))).get();
            const isMemberTarget = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, targetList.boardId), eq(boardMembers.userId, user!.id))).get();

            if (!isMemberSource || !isMemberTarget) { set.status = 403; return { error: 'Forbidden' }; }

            await db.update(cards)
                .set({ listId: body.targetListId })
                .where(eq(cards.listId, params.id));

            broadcastUpdate(sourceList.boardId);
            if (sourceList.boardId !== targetList.boardId) {
                broadcastUpdate(targetList.boardId);
            }
            return { success: true };
        }, {
            body: t.Object({ targetListId: t.String() })
        })

        .post('/:id/sort', async ({ params, body, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }

            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            const listCards = await db.select().from(cards).where(eq(cards.listId, params.id));

            if (body.sortBy === 'oldest') {
                listCards.sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) || a.id.localeCompare(b.id));
            } else if (body.sortBy === 'newest') {
                listCards.sort((a, b) => (b.createdAt.getTime() - a.createdAt.getTime()) || b.id.localeCompare(a.id));
            } else if (body.sortBy === 'abc') {
                listCards.sort((a, b) => a.content.localeCompare(b.content));
            }

            // Update positions
            const updates = [];
            for (let i = 0; i < listCards.length; i++) {
                updates.push(
                    db.update(cards).set({ position: (i + 1) * 1000 }).where(eq(cards.id, listCards[i].id))
                );
            }
            await Promise.all(updates);

            broadcastUpdate(list.boardId);
            return { success: true };
        }, {
            body: t.Object({ sortBy: t.String() })
        })

        .patch('/:id', async ({ params, body, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }

            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            // If changing board, check target board access
            if (body.boardId && body.boardId !== list.boardId) {
                const targetMember = await db.select().from(boardMembers)
                    .where(and(eq(boardMembers.boardId, body.boardId), eq(boardMembers.userId, user!.id))).get();
                if (!targetMember) { set.status = 403; return { error: 'Forbidden on target board' }; }
            }

            const [updated] = await db.update(lists)
                .set(body)
                .where(eq(lists.id, params.id))
                .returning();

            broadcastUpdate(list.boardId);
            if (body.boardId && body.boardId !== list.boardId) {
                broadcastUpdate(body.boardId);
            }
            return updated;
        }, {
            body: t.Object({
                title: t.Optional(t.String()),
                position: t.Optional(t.Number()),
                color: t.Optional(t.String()),
                boardId: t.Optional(t.String())
            })
        })

        .delete('/:id', async ({ params, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }

            const isMember = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            if (!isMember) { set.status = 403; return { error: 'Forbidden' }; }

            await db.delete(lists).where(eq(lists.id, params.id));
            broadcastUpdate(list.boardId);
            return { success: true };
        })
    )

    // --- ADMIN ---
    .group('/admin', (app) => app
        .onBeforeHandle(({ user, set }) => {
            if (!user?.isAdmin) {
                set.status = 403;
                return { error: 'Admin access required' };
            }
        })

        .get('/users', async ({ set }) => {
            try {
                const allUsers = await db.select().from(users);

                // Optimization: Use SQL aggregation instead of fetching all members
                const projectCounts = await db.select({
                    userId: projectMembers.userId,
                    count: sql<number>`count(*)`
                })
                    .from(projectMembers)
                    .groupBy(projectMembers.userId);

                const boardCounts = await db.select({
                    userId: boardMembers.userId,
                    count: sql<number>`count(*)`
                })
                    .from(boardMembers)
                    .groupBy(boardMembers.userId);

                // Create maps for O(1) lookup
                const projectCountMap = new Map(projectCounts.map(p => [p.userId, p.count]));
                const boardCountMap = new Map(boardCounts.map(b => [b.userId, b.count]));

                const usersWithStats = allUsers.map(u => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    isAdmin: u.isAdmin,
                    isBanned: u.isBanned,
                    createdAt: u.createdAt,
                    projectsCount: projectCountMap.get(u.id) || 0,
                    boardsCount: boardCountMap.get(u.id) || 0
                }));

                return usersWithStats;
            } catch (e) {
                console.error(e);
                set.status = 500;
                return { error: 'Internal Server Error' };
            }
        })

        .get('/users/:id/access', async ({ params, set }) => {
            const memberProjects = await db.select({
                projectId: projectMembers.projectId,
                title: projects.title
            })
                .from(projectMembers)
                .innerJoin(projects, eq(projects.id, projectMembers.projectId))
                .where(eq(projectMembers.userId, params.id));

            if (memberProjects.length === 0) {
                // Check if user exists if no projects found (optimization: only check on empty)
                const userExists = await db.select().from(users).where(eq(users.id, params.id)).get();
                if (!userExists) { set.status = 404; return { error: 'User not found' }; }
            }

            const memberBoards = await db.select({
                boardId: boardMembers.boardId,
                title: boards.title
            })
                .from(boardMembers)
                .innerJoin(boards, eq(boards.id, boardMembers.boardId))
                .where(eq(boardMembers.userId, params.id));

            return { projects: memberProjects, boards: memberBoards };
        })

        .post('/users/:id/ban', async ({ params, set, user: adminUser }) => {
            const user = await db.select().from(users).where(eq(users.id, params.id)).get();
            if (!user) { set.status = 404; return { error: 'User not found' }; }

            // Prevent self-ban
            if (params.id === adminUser!.id) {
                set.status = 400;
                return { error: 'Cannot ban yourself' };
            }

            // Toggle ban
            await db.update(users)
                .set({ isBanned: !user.isBanned })
                .where(eq(users.id, params.id));

            broadcastUserUpdate(params.id);

            return { success: true, isBanned: !user.isBanned };
        })

        .patch('/users/:id/name', async ({ params, body, set }) => {
            const user = await db.select().from(users).where(eq(users.id, params.id)).get();
            if (!user) { set.status = 404; return { error: 'User not found' }; }

            await db.update(users)
                .set({ name: body.name })
                .where(eq(users.id, params.id));
            return { success: true };
        }, {
            body: t.Object({ name: t.String() })
        })

        // Force Remove Access (Admin) - though specialized endpoints exist, these might be useful shortcuts or bulk
        // But plan said to add them:
        .delete('/users/:id/projects/:projectId', async ({ params, set }) => {
            const existing = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.userId, params.id), eq(projectMembers.projectId, params.projectId))).get();
            if (!existing) { set.status = 404; return { error: 'Membership not found' }; }

            await db.delete(projectMembers)
                .where(and(eq(projectMembers.userId, params.id), eq(projectMembers.projectId, params.projectId)));

            broadcastProjectUpdate(params.projectId);

            // Find all boards in this project and broadcast update
            const projectBoards = await db.select().from(boards).where(eq(boards.projectId, params.projectId));
            for (const board of projectBoards) {
                broadcastUpdate(board.id);
            }
            broadcastUserUpdate(params.id);
            return { success: true };
        })

        .delete('/users/:id/boards/:boardId', async ({ params, set }) => {
            const existing = await db.select().from(boardMembers)
                .where(and(eq(boardMembers.userId, params.id), eq(boardMembers.boardId, params.boardId))).get();
            if (!existing) { set.status = 404; return { error: 'Membership not found' }; }

            await db.delete(boardMembers)
                .where(and(eq(boardMembers.userId, params.id), eq(boardMembers.boardId, params.boardId)));
            broadcastUpdate(params.boardId);
            broadcastUserUpdate(params.id);
            return { success: true };
        })
    )

    .get('/api/ping', () => ({ message: "Backend Connected! 🚀" }))

    .listen(3000);

export type App = typeof app;

console.log(`🦊 Backend running at http://localhost:3000`);