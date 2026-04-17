import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from './index';
import { getDbMock } from '../test/setup';

describe('Board Endpoints', () => {
    let dbMock: any;

    beforeEach(() => {
        dbMock = getDbMock();
        vi.clearAllMocks();
    });

    const mockAuthGet = (userOverrides = {}) => {
        dbMock.get.mockResolvedValueOnce({ id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 100000) });
        dbMock.get.mockResolvedValueOnce({ id: 'u1', email: 'test@t.com', isAdmin: false, ...userOverrides });
    };

    it('should create a board successfully', async () => {
        mockAuthGet(); // 2 gets for auth

        const req = new Request('http://localhost/boards', {
            method: 'POST',
            headers: { 'Cookie': 'session_id=s1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'New Board', visibility: 'public' })
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.title).toBe('New Board');
        expect(dbMock.insert).toHaveBeenCalledTimes(2); // once for board, once for owner membership
    });

    it('should fetch a board successfully', async () => {
        mockAuthGet(); // 2 gets

        // Board query
        dbMock.get.mockResolvedValueOnce({ id: 'b1', title: 'Test Board', visibility: 'public', ownerId: 'u1' });
        
        // Members query (directMember)
        dbMock.get.mockResolvedValueOnce({ role: 'owner' });

        // `db.select().from(lists)...orderBy()` calls orderBy last.
        dbMock.orderBy.mockResolvedValueOnce([{ id: 'l1', title: 'List 1', boardId: 'b1' }]); // lists
        
        // `db.select().from(cards)...orderBy()`
        dbMock.orderBy.mockResolvedValueOnce([{ id: 'c1', content: 'Card', listId: 'l1' }]); // cards

        // The remaining queries end with `where(...)` directly resolving to an array instead of `.get()`
        let whereCount = 0;
        dbMock.where.mockImplementation(() => {
            whereCount++;
            // Note: Auth session where, Auth user where, Board where, Direct Member where
            // and the lists/cards also have 'where', making total where calls quite high.
            // Let's just track the 'innerJoin' or simply provide resolved values if no `.get()` is chained.
            
            // To be safe, if we return `dbMock`, `.get()` works for single objects, 
            // but for array resolutions after `where`, we can just mock `where` entirely for the members/labels queries.
            if (whereCount === 7) return Promise.resolve([{ id: 'u1', name: 'User 1', email: 'test@t.com', role: 'owner', isAdmin: false }]); // directBoardMembers
            if (whereCount === 8) return Promise.resolve([]); // cardLabels
            if (whereCount === 9) return Promise.resolve([]); // cardMembers
            return dbMock;
        });

        const req = new Request('http://localhost/boards/b1', {
            method: 'GET',
            headers: { 'Cookie': 'session_id=s1' }
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);
        
        const data = await res.json();
        expect(data.title).toBe('Test Board');
        expect(data.lists).toHaveLength(1);
        expect(data.members).toHaveLength(1);
    });

    it('should update a board if authorized', async () => {
        mockAuthGet(); // 2 gets

        // Board query
        dbMock.get.mockResolvedValueOnce({ id: 'b1', title: 'Test Board', visibility: 'public', ownerId: 'u1' });
        
        // Direct member query
        dbMock.get.mockResolvedValueOnce({ role: 'owner' });

        const req = new Request('http://localhost/boards/b1', {
            method: 'PATCH',
            headers: { 'Cookie': 'session_id=s1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Updated Title' })
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbMock.update).toHaveBeenCalled();
    });

    it('should prevent deleting a board if unauthorized', async () => {
        // Authenticate as a different user
        mockAuthGet({ id: 'u2', email: 'other@t.com' });

        // Board query, owned by u1
        dbMock.get.mockResolvedValueOnce({ id: 'b1', title: 'Test Board', visibility: 'public', ownerId: 'u1' });

        const req = new Request('http://localhost/boards/b1', {
            method: 'DELETE',
            headers: { 'Cookie': 'session_id=s1' }
        });

        const res = await app.handle(req);
        expect(res.status).toBe(403);
    });
});
