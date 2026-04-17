import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from './index';
import { getDbMock } from '../test/setup';

describe('Card Endpoints', () => {
    let dbMock: any;

    beforeEach(() => {
        dbMock = getDbMock();
        vi.clearAllMocks();
    });

    const mockAuthGet = (userOverrides = {}) => {
        dbMock.get.mockResolvedValueOnce({ id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 100000) });
        dbMock.get.mockResolvedValueOnce({ id: 'u1', email: 'test@t.com', isAdmin: false, ...userOverrides });
    };

    it('should create a card successfully', async () => {
        mockAuthGet(); // 2 gets

        // List lookup
        dbMock.get.mockResolvedValueOnce({ id: 'l1', boardId: 'b1' });
        // Board lookup
        dbMock.get.mockResolvedValueOnce({ id: 'b1', title: 'Test Board' });
        // Direct member
        dbMock.get.mockResolvedValueOnce({ role: 'owner' });

        const req = new Request('http://localhost/cards', {
            method: 'POST',
            headers: { 'Cookie': 'session_id=s1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'New Card', listId: 'l1', position: 10 })
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.content).toBe('New Card');
        expect(data.listId).toBe('l1');
        expect(dbMock.insert).toHaveBeenCalledTimes(1);
    });

    it('should prevent creating a card if not authorized', async () => {
        mockAuthGet({ id: 'u2' }); // user 2

        // List lookup
        dbMock.get.mockResolvedValueOnce({ id: 'l1', boardId: 'b1' });
        // Board lookup
        dbMock.get.mockResolvedValueOnce({ id: 'b1', title: 'Test Board' });
        // Direct member lookup (fails, not a member)
        dbMock.get.mockResolvedValueOnce(null);

        const req = new Request('http://localhost/cards', {
            method: 'POST',
            headers: { 'Cookie': 'session_id=s1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'New Card', listId: 'l1', position: 10 })
        });

        const res = await app.handle(req);
        // Expecting 403 because u2 has no role on board b1
        expect(res.status).toBe(403);
    });

    it('should update a card if authorized', async () => {
        mockAuthGet(); // 2 gets

        // Card lookup
        dbMock.get.mockResolvedValueOnce({ id: 'c1', listId: 'l1' });
        // List lookup
        dbMock.get.mockResolvedValueOnce({ id: 'l1', boardId: 'b1' });
        // Board lookup
        dbMock.get.mockResolvedValueOnce({ id: 'b1', title: 'Test Board' });
        // Direct member lookup
        dbMock.get.mockResolvedValueOnce({ role: 'member' });

        dbMock.update.mockReturnValueOnce({
            set: vi.fn().mockReturnValueOnce({
                where: vi.fn().mockReturnValueOnce({
                    returning: vi.fn().mockResolvedValueOnce([{ id: 'c1', content: 'Updated Card' }])
                })
            })
        });

        const req = new Request('http://localhost/cards/c1', {
            method: 'PATCH',
            headers: { 'Cookie': 'session_id=s1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'Updated Card' })
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.content).toBe('Updated Card');
        expect(dbMock.update).toHaveBeenCalled();
    });

    it('should delete a card if authorized', async () => {
        mockAuthGet(); // 2 gets

        // Card lookup
        dbMock.get.mockResolvedValueOnce({ id: 'c1', listId: 'l1' });
        // List lookup
        dbMock.get.mockResolvedValueOnce({ id: 'l1', boardId: 'b1' });
        // Board lookup
        dbMock.get.mockResolvedValueOnce({ id: 'b1', title: 'Test Board' });
        // Direct member lookup
        dbMock.get.mockResolvedValueOnce({ role: 'admin' });

        const req = new Request('http://localhost/cards/c1', {
            method: 'DELETE',
            headers: { 'Cookie': 'session_id=s1' }
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbMock.delete).toHaveBeenCalled();
    });
});
