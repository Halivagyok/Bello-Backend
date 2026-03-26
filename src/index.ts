// backend/src/index.ts
import { Elysia, t } from 'elysia';
// import { websocket } from '@elysiajs/websocket'; its deprecated, built-in now
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { lists, cards, users, sessions, boards, boardMembers, projects, projectMembers, images, labels, cardLabels } from './db/schema';
import { eq, asc, and, desc, sql, inArray, like, or, isNull } from 'drizzle-orm';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 1. Setup Database
const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

const initializeDefaultLabels = async () => {
    try {
        const existingGlobalLabels = await db.select().from(labels).where(isNull(labels.projectId));
        if (existingGlobalLabels.length === 0) {
            await db.insert(labels).values([
                { id: crypto.randomUUID(), title: 'Priority', color: '#ef4444' }, // Red
                { id: crypto.randomUUID(), title: 'Help Required', color: '#f59e0b' }, // Amber/Orange
                { id: crypto.randomUUID(), title: 'Bug', color: '#dc2626' }, // Dark Red
                { id: crypto.randomUUID(), title: 'Feature', color: '#3b82f6' }, // Blue
                { id: crypto.randomUUID(), title: 'Design', color: '#ec4899' }, // Pink
                { id: crypto.randomUUID(), title: 'Done', color: '#10b981' } // Green
            ]);
            console.log('Default global labels initialized successfully.');
        }
    } catch (e) {
        console.error('Failed to initialize default labels. Did you run the database migration?', e);
    }
};
initializeDefaultLabels();

const UPLOADS_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR);
}

const rolePriority: Record<string, number> = { 'owner': 4, 'admin': 3, 'member': 2, 'viewer': 1 };

// 2. Initialize App
const app = new Elysia()
    .use(cors({
        origin: true, // Mirror the requester's origin for development
        credentials: true,
        allowedHeaders: ['Content-Type', 'Cookie']
    }))
    .use(staticPlugin({
        assets: 'uploads',
        prefix: '/uploads',
        alwaysStatic: false,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000',
            'Cross-Origin-Resource-Policy': 'cross-origin'
        }
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
            // 4. Return new user
            return { user: { id: user.id, email: body.email, name: body.name, avatarUrl: null, isAdmin: false } };
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

            return { user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, isAdmin: user.isAdmin } };
        })

        .patch('/me', async ({ body, cookie, set }) => {
            const sessionId = cookie.session_id?.value;
            if (!sessionId || typeof sessionId !== 'string') { set.status = 401; return { error: 'Unauthorized' }; }

            const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
            if (!session || session.expiresAt < new Date()) { set.status = 401; return { error: 'Unauthorized' }; }

            await db.update(users).set(body).where(eq(users.id, session.userId));
            const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
            return { user: { id: user!.id, email: user!.email, name: user!.name, avatarUrl: user!.avatarUrl, isAdmin: user!.isAdmin } };
        }, {
            body: t.Object({
                name: t.Optional(t.String()),
                email: t.Optional(t.String()),
                avatarUrl: t.Optional(t.Nullable(t.String()))
            })
        })

        .patch('/password', async ({ body, cookie, set }) => {
            const sessionId = cookie.session_id?.value;
            if (!sessionId || typeof sessionId !== 'string') { set.status = 401; return { error: 'Unauthorized' }; }

            const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
            if (!session || session.expiresAt < new Date()) { set.status = 401; return { error: 'Unauthorized' }; }

            const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
            if (!user) { set.status = 404; return { error: 'User not found' }; }

            // Verify current password
            const isMatch = await Bun.password.verify(body.currentPassword, user.password);
            if (!isMatch) { set.status = 400; return { error: 'Incorrect current password' }; }

            // Hash and update new password
            const hashedPassword = await Bun.password.hash(body.newPassword);
            await db.update(users).set({ password: hashedPassword }).where(eq(users.id, user.id));

            return { success: true };
        }, {
            body: t.Object({
                currentPassword: t.String(),
                newPassword: t.String()
            })
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
    .onBeforeHandle(({ path, request, user, set }) => {
        if (path.startsWith('/uploads') || path.startsWith('/auth') || path === '/api/ping') {
            return;
        }
        const isPublicBoardRequest = path.match(/^\/boards\/[^\/]+$/) && request.method === 'GET';
        if (isPublicBoardRequest) {
            return;
        }
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
            // Add owner as 'owner' role
            await db.insert(projectMembers).values({ projectId: newProject.id, userId: user!.id, role: 'owner' });
            return newProject;
        }, {
            body: t.Object({
                title: t.String(),
                description: t.Optional(t.String())
            })
        })

        .get('/:id/labels', async ({ params, user, set }) => {
            const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!projectMember && project?.ownerId !== user!.id && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }
            return await db.select().from(labels).where(or(eq(labels.projectId, params.id), isNull(labels.projectId)));
        })

        .post('/:id/labels', async ({ params, body, user, set }) => {
            const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!projectMember && project?.ownerId !== user!.id && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }
            const newLabel = {
                id: crypto.randomUUID(),
                title: body.title,
                color: body.color,
                projectId: params.id
            };
            await db.insert(labels).values(newLabel);
            broadcastProjectUpdate(params.id);
            return newLabel;
        }, {
            body: t.Object({ title: t.String(), color: t.String() })
        })

        // Get Project Details (including BOARDS in that project)
        .get('/:id', async ({ params, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Check Access
            const isMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();

            if (project.ownerId !== user!.id && !isMember && !user!.isAdmin) {
                set.status = 403; return { error: 'Forbidden' };
            }
            const members = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
                avatarUrl: users.avatarUrl,
                role: projectMembers.role,
                isAdmin: users.isAdmin
            })
                .from(projectMembers)
                .innerJoin(users, eq(users.id, projectMembers.userId))
                .where(eq(projectMembers.projectId, params.id));

            return { ...project, members };
        })

        .patch('/:id', async ({ params, body, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Check Access
            const isMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();

            // Only 'owner' or 'admin' can rename/edit project settings
            const role = isMember?.role;
            const canEdit = (project.ownerId === user!.id) || (role === 'owner' || role === 'admin') || user!.isAdmin;

            if (!canEdit) {
                set.status = 403; return { error: 'Forbidden' };
            }

            await db.update(projects)
                .set(body)
                .where(eq(projects.id, params.id));

            broadcastProjectUpdate(params.id);
            return { success: true };
        }, {
            body: t.Object({
                boardIds: t.Optional(t.Array(t.String())),
                title: t.Optional(t.String()),
                description: t.Optional(t.String())
            })
        })

        .post('/:id/invite', async ({ params, body, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Check Access (Owner or Admin Member)
            const isMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();

            const requesterRole = isMember?.role;
            // Only 'owner' or 'admin' can invite
            const canInvite = (project.ownerId === user!.id) || (requesterRole === 'owner' || requesterRole === 'admin') || user!.isAdmin;

            if (!canInvite) {
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
                role: body.role || 'member'
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
                email: t.String(),
                role: t.Optional(t.String())
            })
        })

        .patch('/:id/members/:userId', async ({ params, body, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Only Owner or Admin can change roles
            const requesterMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();

            const requesterRole = requesterMember?.role;
            const targetMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, params.userId))).get();
            
            if (!targetMember) { set.status = 404; return { error: 'Member not found' }; }

            // Hierarchy Check: requester must have higher priority than target AND must be owner/admin
            const reqPrio = (project.ownerId === user!.id) ? 5 : (rolePriority[requesterRole!] || 0);
            const targetPrio = (project.ownerId === params.userId) ? 5 : (rolePriority[targetMember.role!] || 0);

            if (reqPrio < 3 || reqPrio <= targetPrio) {
                if (!user!.isAdmin) {
                    set.status = 403;
                    return { error: 'Forbidden: Insufficient role hierarchy' };
                }
            }

            // ONLY owners can grant owner role
            if (body.role === 'owner' && reqPrio < 4 && !user!.isAdmin) {
                set.status = 403;
                return { error: 'Only owners can grant owner role' };
            }

            // Cannot change primary owner's role
            if (project.ownerId === params.userId) {
                set.status = 400;
                return { error: 'Cannot change project owner role' };
            }

            await db.update(projectMembers)
                .set({ role: body.role })
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, params.userId)));

            broadcastProjectUpdate(params.id);
            return { success: true };
        }, {
            body: t.Object({ role: t.String() })
        })

        .delete('/:id/members/:userId', async ({ params, user, set }) => {
            const project = await db.select().from(projects).where(eq(projects.id, params.id)).get();
            if (!project) { set.status = 404; return { error: 'Project not found' }; }

            // Allow if Project Owner OR Admin Member OR System Admin
            const requesterMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, user!.id))).get();

            const requesterRole = requesterMember?.role;
            const targetMember = await db.select().from(projectMembers)
                .where(and(eq(projectMembers.projectId, params.id), eq(projectMembers.userId, params.userId))).get();
            
            if (!targetMember) { set.status = 404; return { error: 'Member not found' }; }

            const reqPrio = (project.ownerId === user!.id) ? 5 : (rolePriority[requesterRole!] || 0);
            const targetPrio = (project.ownerId === params.userId) ? 5 : (rolePriority[targetMember.role!] || 0);

            // Special case: users can remove themselves unless they are primary owner
            const isSelf = user!.id === params.userId;

            if (!isSelf && (reqPrio < 3 || reqPrio <= targetPrio) && !user!.isAdmin) {
                set.status = 403;
                return { error: 'Forbidden' };
            }

            // Prevent removing the primary owner
            if (project.ownerId === params.userId) {
                set.status = 400;
                return { error: 'Cannot remove primary project owner' };
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
            const memberBoards = await db.select({ boardId: boardMembers.boardId }).from(boardMembers).where(eq(boardMembers.userId, user!.id));
            const boardIds = memberBoards.map(m => m.boardId);

            const memberProjects = await db.select({ projectId: projectMembers.projectId, role: projectMembers.role }).from(projectMembers).where(eq(projectMembers.userId, user!.id));
            const projectRoles = new Map(memberProjects.map(m => [m.projectId, m.role]));

            const allBoards = await db.select({
                id: boards.id,
                title: boards.title,
                ownerId: boards.ownerId,
                projectId: boards.projectId,
                visibility: boards.visibility,
                createdAt: boards.createdAt,
                ownerAvatarUrl: users.avatarUrl,
                ownerName: users.name
            })
                .from(boards)
                .innerJoin(users, eq(users.id, boards.ownerId));

            return allBoards.filter(b => {
                if (b.ownerId === user!.id) return true;
                if (boardIds.includes(b.id)) return true;
                
                if (b.projectId && projectRoles.has(b.projectId)) {
                    if (b.visibility === 'private') {
                        const pRole = projectRoles.get(b.projectId);
                        return pRole === 'owner' || pRole === 'admin';
                    }
                    return true;
                }
                return false;
            });
        })

        .post('/', async ({ body, user, set }) => {
            if (body.projectId) {
                const project = await db.select().from(projects).where(eq(projects.id, body.projectId)).get();
                if (!project) { set.status = 404; return { error: 'Project not found' }; }

                const member = await db.select().from(projectMembers)
                    .where(and(eq(projectMembers.projectId, body.projectId), eq(projectMembers.userId, user!.id))).get();
                
                const role = member?.role;
                const canCreate = (project.ownerId === user!.id) || (role === 'owner' || role === 'admin') || user!.isAdmin;

                if (!canCreate) {
                    set.status = 403;
                    return { error: 'Forbidden: Only project owners or admins can create boards' };
                }
            }

            const newBoard = {
                id: crypto.randomUUID(),
                title: body.title,
                projectId: body.projectId,
                ownerId: user!.id,
                visibility: body.visibility || 'workspace',
            };
            await db.insert(boards).values(newBoard);
            // Add owner as 'owner' role
            await db.insert(boardMembers).values({ boardId: newBoard.id, userId: user!.id, role: 'owner' });

            if (newBoard.projectId) {
                broadcastProjectUpdate(newBoard.projectId);
            }

            return newBoard;
        }, {
            body: t.Object({
                title: t.String(),
                projectId: t.Optional(t.String()),
                visibility: t.Optional(t.String())
            })
        })

        .get('/:id', async ({ params, user, set }) => {
            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            if (!board) { set.status = 404; return { error: 'Board not found' }; }

            if (board.visibility !== 'public' && !user) {
                set.status = 401; return { error: 'Unauthorized' };
            }

            let role: string | undefined | null = null;
            if (user) {
                const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user.id))).get();
                role = directMember?.role;
    
                if (board.projectId) {
                    const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user.id))).get();
                    if (projectMember) {
                        if (board.visibility === 'private') {
                            if (projectMember.role === 'owner' || projectMember.role === 'admin') {
                                if (!role || (rolePriority[projectMember.role] || 0) > (rolePriority[role] || 0)) {
                                    role = projectMember.role;
                                }
                            }
                        } else {
                            if (!role || (rolePriority[projectMember.role] || 0) > (rolePriority[role] || 0)) {
                                role = projectMember.role;
                            }
                        }
                    }
                }
    
                if (!role && board.ownerId === user.id) role = 'owner';
                if (!role && user.isAdmin) role = 'owner';
            }

            if (board.visibility !== 'public' && !role) { set.status = 403; return { error: 'Forbidden' }; }

            const allLists = await db.select().from(lists).where(eq(lists.boardId, params.id)).orderBy(asc(lists.position));
            const listIds = allLists.map(l => l.id);
            const allCards = listIds.length > 0 ? await db.select().from(cards).where(inArray(cards.listId, listIds)).orderBy(asc(cards.position)) : [];

            const directBoardMembers = await db.select({
                id: users.id,
                name: users.name,
                email: users.email,
                avatarUrl: users.avatarUrl,
                role: boardMembers.role,
                isAdmin: users.isAdmin
            })
                .from(boardMembers)
                .innerJoin(users, eq(users.id, boardMembers.userId))
                .where(eq(boardMembers.boardId, params.id));

            const memberMap = new Map();
            for (const m of directBoardMembers) {
                memberMap.set(m.id, m);
            }

            // If it's a project board, also include project members
            if (board.projectId) {
                const projectMembersList = await db.select({
                    id: users.id,
                    name: users.name,
                    email: users.email,
                    avatarUrl: users.avatarUrl,
                    role: projectMembers.role,
                    isAdmin: users.isAdmin
                })
                    .from(projectMembers)
                    .innerJoin(users, eq(users.id, projectMembers.userId))
                    .where(eq(projectMembers.projectId, board.projectId));
                
                for (const pm of projectMembersList) {
                    if (!memberMap.has(pm.id)) {
                        memberMap.set(pm.id, pm);
                    } else {
                        // Keep the highest role between direct board role and project role
                        const existing = memberMap.get(pm.id);
                        if ((rolePriority[existing.role] || 0) < (rolePriority[pm.role] || 0)) {
                            memberMap.set(pm.id, pm);
                        }
                    }
                }
            }

            const cardIds = allCards.map(c => c.id);
            const allCardLabels = cardIds.length > 0 ? await db.select({
                cardId: cardLabels.cardId,
                labelId: labels.id,
                title: labels.title,
                color: labels.color
            }).from(cardLabels)
              .innerJoin(labels, eq(labels.id, cardLabels.labelId))
              .where(inArray(cardLabels.cardId, cardIds)) : [];

            return {
                ...board,
                role,
                members: Array.from(memberMap.values()),
                lists: allLists.map(list => ({
                    ...list,
                    cards: allCards.filter(card => card.listId === list.id).map(card => ({
                        ...card,
                        labels: allCardLabels.filter(cl => cl.cardId === card.id).map(cl => ({
                            id: cl.labelId,
                            title: cl.title,
                            color: cl.color
                        }))
                    }))
                }))
            };
        })

        .patch('/:id', async ({ params, body, user, set }) => {
            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            if (!board) { set.status = 404; return { error: 'Board not found' }; }

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (rolePriority[role!] < 3 && board.ownerId !== user!.id && !user!.isAdmin) {
                set.status = 403; return { error: 'Forbidden' };
            }

            await db.update(boards).set(body).where(eq(boards.id, params.id));
            broadcastUpdate(params.id);
            if (board.projectId) broadcastProjectUpdate(board.projectId);
            return { success: true };
        }, {
            body: t.Object({
                title: t.Optional(t.String()),
                projectId: t.Optional(t.String()),
                visibility: t.Optional(t.String())
            })
        })

        .delete('/:id', async ({ params, user, set }) => {
            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            if (!board) { set.status = 404; return { error: 'Board not found' }; }

            if (board.ownerId !== user!.id && !user!.isAdmin) {
                set.status = 403; return { error: 'Forbidden' };
            }

            await db.delete(boards).where(eq(boards.id, params.id));
            if (board.projectId) broadcastProjectUpdate(board.projectId);
            return { success: true };
        })

        .post('/:id/lists', async ({ params, body, user, set }) => {
            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            if (!board) { set.status = 404; return { error: 'Board not found' }; }

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Viewers cannot add lists' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            const newList = {
                id: crypto.randomUUID(),
                title: body.title,
                position: body.position ?? Date.now(),
                boardId: params.id,
                ownerId: user!.id,
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

        .patch('/:id/members/:userId', async ({ params, body, user, set }) => {
            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            if (!board) { set.status = 404; return { error: 'Board not found' }; }

            // Resolve role of the requester
            const requesterDirect = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user!.id))).get();
            let requesterRole = requesterDirect?.role;
            if (!requesterRole && board.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                requesterRole = projectMember?.role;
            }

            const reqPrio = (board.ownerId === user!.id) ? 5 : (rolePriority[requesterRole!] || 0);

            // Check if target is a direct board member or project member
            const targetDirect = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, params.userId))).get();
            let targetPrio = 0;
            let isProjectMember = false;

            if (targetDirect) {
                targetPrio = (board.ownerId === params.userId) ? 5 : (rolePriority[targetDirect.role] || 0);
            } else if (board.projectId) {
                const targetProject = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, params.userId))).get();
                if (targetProject) {
                    isProjectMember = true;
                    targetPrio = (rolePriority[targetProject.role] || 0);
                }
            }

            if (!targetDirect && !isProjectMember) {
                set.status = 404; return { error: 'Member not found' };
            }

            // Hierarchy Check
            if (reqPrio < 3 || reqPrio <= targetPrio) {
                if (!user!.isAdmin) { set.status = 403; return { error: 'Forbidden: Insufficient role hierarchy' }; }
            }

            // ONLY owners can grant owner role
            if (body.role === 'owner' && reqPrio < 4 && !user!.isAdmin) {
                set.status = 403; return { error: 'Only owners can grant owner role' };
            }

            if (board.ownerId === params.userId) { set.status = 400; return { error: 'Cannot change board owner role' }; }

            if (targetDirect) {
                await db.update(boardMembers).set({ role: body.role }).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, params.userId)));
            } else {
                // If they are only a project member, update their role at the project level (workspace role)
                await db.update(projectMembers).set({ role: body.role }).where(and(eq(projectMembers.projectId, board.projectId!), eq(projectMembers.userId, params.userId)));
                broadcastProjectUpdate(board.projectId!);
            }

            broadcastUpdate(params.id);
            return { success: true };
        }, {
            body: t.Object({ role: t.String() })
        })

        .delete('/:id/members/:userId', async ({ params, user, set }) => {
            const board = await db.select().from(boards).where(eq(boards.id, params.id)).get();
            if (!board) { set.status = 404; return { error: 'Board not found' }; }

            const requesterMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, user!.id))).get();
            let role = requesterMember?.role;
            if (!role && board.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            const targetMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, params.userId))).get();
            if (!targetMember) { set.status = 404; return { error: 'Member not found' }; }

            const reqPrio = (board.ownerId === user!.id) ? 5 : (rolePriority[role!] || 0);
            const targetPrio = (board.ownerId === params.userId) ? 5 : (rolePriority[targetMember.role!] || 0);

            const isSelf = user!.id === params.userId;
            if (!isSelf && (reqPrio < 3 || reqPrio <= targetPrio) && !user!.isAdmin) {
                set.status = 403; return { error: 'Forbidden' };
            }

            if (board.ownerId === params.userId) { set.status = 400; return { error: 'Cannot remove board owner' }; }

            await db.delete(boardMembers).where(and(eq(boardMembers.boardId, params.id), eq(boardMembers.userId, params.userId)));
            broadcastUpdate(params.id);
            broadcastUserUpdate(params.userId);
            return { success: true };
        })
    )

    // --- CARDS ---
    .group('/cards', (app) => app
        .get('/search', async ({ query, user, set }) => {
            const q = query.q?.trim().toLowerCase() || '';
            const dueSoon = query.dueSoon === 'true';

            if (!q && !dueSoon) return [];

            // 1. Get member boards
            const memberBoards = await db.select({ boardId: boardMembers.boardId }).from(boardMembers).where(eq(boardMembers.userId, user!.id));
            const boardIds = memberBoards.map(m => m.boardId);

            // 2. Get member projects
            const memberProjects = await db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, user!.id));
            const projectIds = memberProjects.map(m => m.projectId);

            // 3. Find accessible boards
            const allBoardsList = await db.select({ id: boards.id, ownerId: boards.ownerId, projectId: boards.projectId }).from(boards);
            const accessibleBoardIds = allBoardsList
                .filter(b => b.ownerId === user!.id || boardIds.includes(b.id) || (b.projectId && projectIds.includes(b.projectId)))
                .map(b => b.id);

            if (accessibleBoardIds.length === 0) return [];

            // 4. Find lists in accessible boards
            const accessibleLists = await db.select({ id: lists.id }).from(lists).where(inArray(lists.boardId, accessibleBoardIds));
            const accessibleListIds = accessibleLists.map(l => l.id);

            if (accessibleListIds.length === 0) return [];

            // 5. Build dynamic search conditions
            const conditions: any[] = [inArray(cards.listId, accessibleListIds)];
            
            if (q) {
                conditions.push(
                    or(
                        like(cards.content, `%${q}%`),
                        like(cards.description, `%${q}%`),
                        like(labels.title, `%${q}%`)
                    )
                );
            }

            if (dueSoon) {
                const soonThreshold = new Date();
                soonThreshold.setDate(soonThreshold.getDate() + 7); // Due within the next 7 days or overdue
                
                conditions.push(
                    and(
                        eq(cards.completed, false),
                        sql`${cards.dueDate} IS NOT NULL`,
                        sql`${cards.dueDate} <= ${soonThreshold.getTime()}`
                    )
                );
            }

            // 6. Execute search
            const rawCards = await db.select({
                id: cards.id,
                content: cards.content,
                description: cards.description,
                dueDate: cards.dueDate,
                dueDateMode: cards.dueDateMode,
                imageUrl: cards.imageUrl,
                location: cards.location,
                locationLat: cards.locationLat,
                locationLng: cards.locationLng,
                listId: cards.listId,
                position: cards.position,
                completed: cards.completed,
                createdAt: cards.createdAt
            })
                .from(cards)
                .leftJoin(cardLabels, eq(cardLabels.cardId, cards.id))
                .leftJoin(labels, eq(labels.id, cardLabels.labelId))
                .where(and(...conditions))
                .groupBy(cards.id);

            // Fetch labels for the matching cards
            const cardIds = rawCards.map(c => c.id);
            const allCardLabels = cardIds.length > 0 ? await db.select({
                cardId: cardLabels.cardId,
                labelId: labels.id,
                title: labels.title,
                color: labels.color
            }).from(cardLabels)
              .innerJoin(labels, eq(labels.id, cardLabels.labelId))
              .where(inArray(cardLabels.cardId, cardIds)) : [];

            return rawCards.map(card => ({
                ...card,
                labels: allCardLabels.filter(cl => cl.cardId === card.id).map(cl => ({
                    id: cl.labelId,
                    title: cl.title,
                    color: cl.color
                }))
            }));
        }, {
            query: t.Object({
                q: t.Optional(t.String()),
                dueSoon: t.Optional(t.String())
            })
        })
        
        .post('/', async ({ body, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, body.listId)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }
            const board = await db.select().from(boards).where(eq(boards.id, list.boardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Viewers cannot add cards' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            const newCard = {
                id: crypto.randomUUID(),
                content: body.content,
                listId: body.listId,
                position: body.position ?? Date.now()
            };
            await db.insert(cards).values(newCard);
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
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }
            const board = await db.select().from(boards).where(eq(boards.id, list.boardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Viewers cannot edit cards' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            // Source list permission check
            const reqPrio = (board?.ownerId === user!.id) ? 5 : (rolePriority[role!] || 0);
            if (list.ownerId && list.ownerId !== user!.id && !user!.isAdmin && reqPrio < 3) {
                const ownerMembership = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, list.ownerId))).get();
                const ownerPrio = (board?.ownerId === list.ownerId) ? 5 : (rolePriority[ownerMembership?.role || 'member'] || 0);
                if (reqPrio < ownerPrio) { set.status = 403; return { error: 'Insufficient permissions on source list' }; }
            }

            if (body.listId) {
                const newList = await db.select().from(lists).where(eq(lists.id, body.listId)).get();
                if (!newList || !newList.boardId) { set.status = 404; return { error: 'Target list not found' }; }
                
                // Get role on target board
                const targetBoard = await db.select().from(boards).where(eq(boards.id, newList.boardId)).get();
                const directMemberNew = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, newList.boardId), eq(boardMembers.userId, user!.id))).get();
                let roleNew = directMemberNew?.role;
                if (!roleNew && targetBoard?.projectId) {
                    const projectMemberNew = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, targetBoard.projectId), eq(projectMembers.userId, user!.id))).get();
                    roleNew = projectMemberNew?.role;
                }
                
                if (roleNew === 'viewer' || (!roleNew && !user!.isAdmin)) { set.status = 403; return { error: 'Forbidden on target board' }; }

                // Target list ownership check
                const reqPrioNew = (targetBoard?.ownerId === user!.id) ? 5 : (rolePriority[roleNew!] || 0);
                if (newList.ownerId && newList.ownerId !== user!.id && !user!.isAdmin && reqPrioNew < 3) {
                    const ownerMembershipNew = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, newList.boardId), eq(boardMembers.userId, newList.ownerId))).get();
                    const ownerPrioNew = (targetBoard?.ownerId === newList.ownerId) ? 5 : (rolePriority[ownerMembershipNew?.role || 'member'] || 0);
                    if (reqPrioNew < ownerPrioNew) { set.status = 403; return { error: 'Insufficient permissions on target list' }; }
                }
            }

            const [updated] = await db.update(cards).set(body).where(eq(cards.id, params.id)).returning();
            broadcastUpdate(list.boardId);
            return updated;
        }, {
            body: t.Object({
                content: t.Optional(t.String()),
                description: t.Optional(t.Nullable(t.String())),
                dueDate: t.Optional(t.Nullable(t.Date())),
                dueDateMode: t.Optional(t.Nullable(t.String())),
                imageUrl: t.Optional(t.Nullable(t.String())),
                location: t.Optional(t.Nullable(t.String())),
                locationLat: t.Optional(t.Nullable(t.Number())),
                locationLng: t.Optional(t.Nullable(t.Number())),
                listId: t.Optional(t.String()),
                position: t.Optional(t.Number()),
                completed: t.Optional(t.Boolean())
            })
        })

        .delete('/:id', async ({ params, user, set }) => {
            const card = await db.select().from(cards).where(eq(cards.id, params.id)).get();
            if (!card) { set.status = 404; return { error: 'Card not found' }; }

            const list = await db.select().from(lists).where(eq(lists.id, card.listId)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List error' }; }
            const board = await db.select().from(boards).where(eq(boards.id, list.boardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Forbidden' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            await db.delete(cards).where(eq(cards.id, params.id));
            broadcastUpdate(list.boardId);
            return { success: true };
        })

        .post('/:id/labels', async ({ params, body, user, set }) => {
            const card = await db.select().from(cards).where(eq(cards.id, params.id)).get();
            if (!card) { set.status = 404; return { error: 'Card not found' }; }
            
            const list = await db.select().from(lists).where(eq(lists.id, card.listId)).get();
            const board = await db.select().from(boards).where(eq(boards.id, list?.boardId!)).get();
            
            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, board!.id), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }
            if (role === 'viewer' || (!role && !user!.isAdmin)) { set.status = 403; return { error: 'Forbidden' }; }

            const existing = await db.select().from(cardLabels).where(and(eq(cardLabels.cardId, params.id), eq(cardLabels.labelId, body.labelId))).get();
            if (!existing) {
                await db.insert(cardLabels).values({ cardId: params.id, labelId: body.labelId });
                broadcastUpdate(board!.id);
            }
            return { success: true };
        }, {
            body: t.Object({ labelId: t.String() })
        })

        .delete('/:id/labels/:labelId', async ({ params, user, set }) => {
            const card = await db.select().from(cards).where(eq(cards.id, params.id)).get();
            if (!card) { set.status = 404; return { error: 'Card not found' }; }
            
            const list = await db.select().from(lists).where(eq(lists.id, card.listId)).get();
            const board = await db.select().from(boards).where(eq(boards.id, list?.boardId!)).get();
            
            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, board!.id), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }
            if (role === 'viewer' || (!role && !user!.isAdmin)) { set.status = 403; return { error: 'Forbidden' }; }

            await db.delete(cardLabels).where(and(eq(cardLabels.cardId, params.id), eq(cardLabels.labelId, params.labelId)));
            broadcastUpdate(board!.id);
            return { success: true };
        })
    )

    // --- LISTS ---
    .group('/lists', (app) => app
        .post('/:id/duplicate', async ({ params, body, user, set }) => {
            const sourceList = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!sourceList || !sourceList.boardId) { set.status = 404; return { error: 'List not found' }; }

            const listBoardId = sourceList.boardId;
            const board = await db.select().from(boards).where(eq(boards.id, listBoardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, listBoardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Forbidden' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            const newList = {
                id: crypto.randomUUID(),
                title: body.title || `Copy of ${sourceList.title}`,
                position: sourceList.position + 100,
                boardId: listBoardId,
                ownerId: user!.id,
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

            const sourceBoard = await db.select().from(boards).where(eq(boards.id, sourceList.boardId)).get();
            const targetBoard = await db.select().from(boards).where(eq(boards.id, targetList.boardId)).get();

            const directMemberSrc = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, sourceList.boardId), eq(boardMembers.userId, user!.id))).get();
            let roleSrc = directMemberSrc?.role;
            if (!roleSrc && sourceBoard?.projectId) {
                const projectMemberSrc = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, sourceBoard.projectId), eq(projectMembers.userId, user!.id))).get();
                roleSrc = projectMemberSrc?.role;
            }

            const directMemberTgt = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, targetList.boardId), eq(boardMembers.userId, user!.id))).get();
            let roleTgt = directMemberTgt?.role;
            if (!roleTgt && targetBoard?.projectId) {
                const projectMemberTgt = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, targetBoard.projectId), eq(projectMembers.userId, user!.id))).get();
                roleTgt = projectMemberTgt?.role;
            }

            if (roleSrc === 'viewer' || roleTgt === 'viewer') { set.status = 403; return { error: 'Forbidden' }; }
            if ((!roleSrc || !roleTgt) && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            const reqPrio = (sourceBoard?.ownerId === user!.id) ? 5 : (rolePriority[roleSrc!] || 0);
            if (sourceList.ownerId && sourceList.ownerId !== user!.id && !user!.isAdmin && reqPrio < 3) {
                const ownerMembership = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, sourceList.boardId), eq(boardMembers.userId, sourceList.ownerId))).get();
                const ownerPrio = (sourceBoard?.ownerId === sourceList.ownerId) ? 5 : (rolePriority[ownerMembership?.role || 'member'] || 0);
                if (reqPrio <= ownerPrio) { set.status = 403; return { error: 'Insufficient permissions' }; }
            }

            await db.update(cards).set({ listId: body.targetListId }).where(eq(cards.listId, params.id));
            broadcastUpdate(sourceList.boardId);
            if (sourceList.boardId !== targetList.boardId) broadcastUpdate(targetList.boardId);
            return { success: true };
        }, {
            body: t.Object({ targetListId: t.String() })
        })

        .post('/:id/sort', async ({ params, body, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }
            const board = await db.select().from(boards).where(eq(boards.id, list.boardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Forbidden' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            const reqPrio = (board?.ownerId === user!.id) ? 5 : (rolePriority[role!] || 0);
            if (list.ownerId && list.ownerId !== user!.id && !user!.isAdmin && reqPrio < 3) {
                const ownerMembership = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, list.ownerId))).get();
                const ownerPrio = (board?.ownerId === list.ownerId) ? 5 : (rolePriority[ownerMembership?.role || 'member'] || 0);
                if (reqPrio <= ownerPrio) { set.status = 403; return { error: 'Insufficient permissions' }; }
            }

            const listCards = await db.select().from(cards).where(eq(cards.listId, params.id));
            if (body.sortBy === 'oldest') listCards.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
            else if (body.sortBy === 'newest') listCards.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
            else if (body.sortBy === 'abc') listCards.sort((a, b) => a.content.localeCompare(b.content));

            const updates = listCards.map((c, i) => db.update(cards).set({ position: (i + 1) * 1000 }).where(eq(cards.id, c.id)));
            await Promise.all(updates);
            broadcastUpdate(list.boardId);
            return { success: true };
        }, {
            body: t.Object({ sortBy: t.String() })
        })

        .patch('/:id', async ({ params, body, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }
            const board = await db.select().from(boards).where(eq(boards.id, list.boardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Forbidden' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            const reqPrio = (board?.ownerId === user!.id) ? 5 : (rolePriority[role!] || 0);
            if (list.ownerId && list.ownerId !== user!.id && !user!.isAdmin && reqPrio < 3) {
                const ownerMembership = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, list.ownerId))).get();
                const ownerPrio = (board?.ownerId === list.ownerId) ? 5 : (rolePriority[ownerMembership?.role || 'member'] || 0);
                if (reqPrio <= ownerPrio) { set.status = 403; return { error: 'Insufficient permissions' }; }
            }

            if (body.boardId && body.boardId !== list.boardId) {
                const targetBoard = await db.select().from(boards).where(eq(boards.id, body.boardId)).get();
                const directMemberTgt = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, body.boardId), eq(boardMembers.userId, user!.id))).get();
                let roleTgt = directMemberTgt?.role;
                if (!roleTgt && targetBoard?.projectId) {
                    const projectMemberTgt = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, targetBoard.projectId), eq(projectMembers.userId, user!.id))).get();
                    roleTgt = projectMemberTgt?.role;
                }
                if (roleTgt === 'viewer' || (!roleTgt && !user!.isAdmin)) { set.status = 403; return { error: 'Forbidden on target board' }; }
            }

            const [updated] = await db.update(lists).set(body).where(eq(lists.id, params.id)).returning();
            broadcastUpdate(list.boardId);
            if (body.boardId && body.boardId !== list.boardId) broadcastUpdate(body.boardId);
            return updated;
        }, {
            body: t.Object({
                title: t.Optional(t.String()),
                position: t.Optional(t.Number()),
                color: t.Optional(t.String()),
                boardId: t.Optional(t.String())
            })
        })

        .patch('/:id/owner', async ({ params, body, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }
            const board = await db.select().from(boards).where(eq(boards.id, list.boardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            const isBoardOwner = board?.ownerId === user!.id;
            const isBoardAdmin = (rolePriority[role!] || 0) >= 3;

            if (!isBoardOwner && !isBoardAdmin && !user!.isAdmin) {
                set.status = 403; return { error: 'Forbidden: Only board admins or higher can transfer list ownership' };
            }

            await db.update(lists).set({ ownerId: body.ownerId }).where(eq(lists.id, params.id));
            broadcastUpdate(list.boardId);
            return { success: true };
        }, {
            body: t.Object({ ownerId: t.String() })
        })

        .delete('/:id', async ({ params, user, set }) => {
            const list = await db.select().from(lists).where(eq(lists.id, params.id)).get();
            if (!list || !list.boardId) { set.status = 404; return { error: 'List not found' }; }
            const board = await db.select().from(boards).where(eq(boards.id, list.boardId)).get();

            const directMember = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, user!.id))).get();
            let role = directMember?.role;
            if (!role && board?.projectId) {
                const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, board.projectId), eq(projectMembers.userId, user!.id))).get();
                role = projectMember?.role;
            }

            if (role === 'viewer') { set.status = 403; return { error: 'Forbidden' }; }
            if (!role && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }

            const reqPrio = (board?.ownerId === user!.id) ? 5 : (rolePriority[role!] || 0);
            if (list.ownerId && list.ownerId !== user!.id && !user!.isAdmin && reqPrio < 3) {
                const ownerMembership = await db.select().from(boardMembers).where(and(eq(boardMembers.boardId, list.boardId), eq(boardMembers.userId, list.ownerId))).get();
                const ownerPrio = (board?.ownerId === list.ownerId) ? 5 : (rolePriority[ownerMembership?.role || 'member'] || 0);
                if (reqPrio <= ownerPrio) { set.status = 403; return { error: 'Insufficient permissions' }; }
            }

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
                const projectCounts = await db.select({ userId: projectMembers.userId, count: sql<number>`count(*)` }).from(projectMembers).groupBy(projectMembers.userId);
                const boardCounts = await db.select({ userId: boardMembers.userId, count: sql<number>`count(*)` }).from(boardMembers).groupBy(boardMembers.userId);

                const projectCountMap = new Map(projectCounts.map(p => [p.userId, p.count]));
                const boardCountMap = new Map(boardCounts.map(b => [b.userId, b.count]));

                return allUsers.map(u => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    isAdmin: u.isAdmin,
                    isBanned: u.isBanned,
                    createdAt: u.createdAt,
                    projectsCount: projectCountMap.get(u.id) || 0,
                    boardsCount: boardCountMap.get(u.id) || 0
                }));
            } catch (e) {
                console.error(e);
                set.status = 500;
                return { error: 'Internal Server Error' };
            }
        })

        .get('/users/:id/access', async ({ params, set }) => {
            const memberProjects = await db.select({ projectId: projectMembers.projectId, title: projects.title }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId)).where(eq(projectMembers.userId, params.id));
            const memberBoards = await db.select({ boardId: boardMembers.boardId, title: boards.title }).from(boardMembers).innerJoin(boards, eq(boards.id, boardMembers.boardId)).where(eq(boardMembers.userId, params.id));
            return { projects: memberProjects, boards: memberBoards };
        })

        .post('/users/:id/ban', async ({ params, set, user: adminUser }) => {
            const user = await db.select().from(users).where(eq(users.id, params.id)).get();
            if (!user) { set.status = 404; return { error: 'User not found' }; }
            if (params.id === adminUser!.id) { set.status = 400; return { error: 'Cannot ban yourself' }; }
            await db.update(users).set({ isBanned: !user.isBanned }).where(eq(users.id, params.id));
            broadcastUserUpdate(params.id);
            return { success: true, isBanned: !user.isBanned };
        })

        .patch('/users/:id/name', async ({ params, body, set }) => {
            const user = await db.select().from(users).where(eq(users.id, params.id)).get();
            if (!user) { set.status = 404; return { error: 'User not found' }; }
            await db.update(users).set({ name: body.name }).where(eq(users.id, params.id));
            return { success: true };
        }, {
            body: t.Object({ name: t.String() })
        })

        .delete('/users/:id/projects/:projectId', async ({ params, set }) => {
            await db.delete(projectMembers).where(and(eq(projectMembers.userId, params.id), eq(projectMembers.projectId, params.projectId)));
            broadcastProjectUpdate(params.projectId);
            const projectBoards = await db.select().from(boards).where(eq(boards.projectId, params.projectId));
            for (const board of projectBoards) broadcastUpdate(board.id);
            broadcastUserUpdate(params.id);
            return { success: true };
        })

        .delete('/:id/boards/:boardId', async ({ params, set }) => {
            await db.delete(boardMembers).where(and(eq(boardMembers.userId, params.id), eq(boardMembers.boardId, params.boardId)));
            broadcastUpdate(params.boardId);
            broadcastUserUpdate(params.id);
            return { success: true };
        })
        )

        // --- LABELS ---
        .group('/labels', (app) => app
            .patch('/:id', async ({ params, body, user, set }) => {
                const label = await db.select().from(labels).where(eq(labels.id, params.id)).get();
                if (!label) { set.status = 404; return { error: 'Label not found' }; }
                if (!label.projectId && !user!.isAdmin) { set.status = 403; return { error: 'Cannot modify global labels' }; }
                
                if (label.projectId) {
                    const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, label.projectId), eq(projectMembers.userId, user!.id))).get();
                    const project = await db.select().from(projects).where(eq(projects.id, label.projectId)).get();
                    if (!projectMember && project?.ownerId !== user!.id && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }
                }

                await db.update(labels).set(body as any).where(eq(labels.id, params.id));
                if (label.projectId) broadcastProjectUpdate(label.projectId);
                return { success: true };
            }, {
                body: t.Object({ title: t.Optional(t.String()), color: t.Optional(t.String()) })
            })

            .delete('/:id', async ({ params, user, set }) => {
                const label = await db.select().from(labels).where(eq(labels.id, params.id)).get();
                if (!label) { set.status = 404; return { error: 'Label not found' }; }
                if (!label.projectId && !user!.isAdmin) { set.status = 403; return { error: 'Cannot delete global labels' }; }
                
                if (label.projectId) {
                    const projectMember = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, label.projectId), eq(projectMembers.userId, user!.id))).get();
                    const project = await db.select().from(projects).where(eq(projects.id, label.projectId)).get();
                    if (!projectMember && project?.ownerId !== user!.id && !user!.isAdmin) { set.status = 403; return { error: 'Forbidden' }; }
                }

                await db.delete(labels).where(eq(labels.id, params.id));
                if (label.projectId) broadcastProjectUpdate(label.projectId);
                return { success: true };
            })
        )

        // --- IMAGES ---
        .group('/images', (app) => app
        .get('/', async ({ user }) => {
            return await db.select().from(images).where(eq(images.userId, user!.id)).orderBy(desc(images.createdAt));
        })

        .post('/', async ({ body, user, set }) => {
            const file = body.file as File;
            const id = crypto.randomUUID();
            const extension = file.name.split('.').pop();
            const filename = `${id}.${extension}`;
            const path = join(UPLOADS_DIR, filename);

            await Bun.write(path, file);

            const newImage = {
                id,
                userId: user!.id,
                filename,
                originalName: file.name,
                mimeType: file.type,
                size: file.size
            };

            await db.insert(images).values(newImage);
            return newImage;
        }, {
            body: t.Object({
                file: t.File()
            })
        })

        .delete('/:id', async ({ params, user, set }) => {
            const image = await db.select().from(images).where(and(eq(images.id, params.id), eq(images.userId, user!.id))).get();
            if (!image) { set.status = 404; return { error: 'Image not found' }; }

            const path = join(UPLOADS_DIR, image.filename);
            try {
                const { unlink } = await import('fs/promises');
                await unlink(path);
            } catch (e) {
                console.error('Failed to delete file:', e);
            }

            await db.delete(images).where(eq(images.id, params.id));
            return { success: true };
        })
        )

        .get('/api/ping', () => ({ message: "Backend Connected! 🚀" }))
    .listen(3000);

export type App = typeof app;
console.log(`🦊 Backend running at http://localhost:3000`);