import { describe, expect, it, vi, beforeEach } from 'vitest';
import { app } from './index';
import { getDbMock } from '../test/setup';

describe('Project Endpoints', () => {
    let dbMock: any;

    beforeEach(() => {
        dbMock = getDbMock();
        vi.clearAllMocks();
    });

    it('should prevent access to unauthenticated requests', async () => {
        const req = new Request('http://localhost/projects/', {
            method: 'GET'
        });

        const res = await app.handle(req);
        // Custom auth middleware returns 401
        expect(res.status).toBe(401);
    });

    it('should return projects for authenticated user', async () => {
        // Mock session and user
        dbMock.get.mockResolvedValueOnce({ id: 'session1', userId: 'user1', expiresAt: new Date(Date.now() + 100000) });
        dbMock.get.mockResolvedValueOnce({ id: 'user1', email: 'test@t.com', isBanned: false });
        
        // Mock project members
        dbMock.where.mockReturnValue(dbMock);
        // It returns an array of member projects, then all projects
        dbMock.select.mockReturnValueOnce(dbMock); // For memberProjects
        dbMock.from.mockReturnValueOnce(dbMock); // From projectMembers
        // Mock resolved values for the query execution
        // We know we did select().from().where() without get() meaning it awaits the array
        const memberProjectsPromise = Promise.resolve([{ projectId: 'proj1' }]);
        (memberProjectsPromise as any).where = dbMock.where;
        dbMock.where.mockResolvedValueOnce([{ projectId: 'proj1' }]);
        
        dbMock.select.mockReturnValueOnce(dbMock); // For allProjects
        dbMock.from.mockResolvedValueOnce([
            { id: 'proj1', ownerId: 'other' },
            { id: 'proj2', ownerId: 'user1' },
            { id: 'proj3', ownerId: 'someone_else' }
        ]);

        const req = new Request('http://localhost/projects/', {
            method: 'GET',
            headers: {
                'Cookie': 'session_id=session1;'
            }
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);
        const projects = await res.json();
        // Should only see proj1 (member) and proj2 (owner)
        expect(projects).toHaveLength(2);
        expect(projects.map((p: any) => p.id)).toEqual(['proj1', 'proj2']);
    });
});
