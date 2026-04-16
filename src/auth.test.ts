import { describe, expect, it, vi, beforeEach } from 'vitest';
import { app } from './index';
import { getDbMock } from '../test/setup';

describe('Auth Endpoints', () => {
    let dbMock: any;

    beforeEach(() => {
        dbMock = getDbMock();
        vi.clearAllMocks();
    });

    it('should return 400 if signup email already exists', async () => {
        dbMock.get.mockResolvedValueOnce({ id: '1', email: 'test@test.com' }); // Mock existing user
        
        const req = new Request('http://localhost/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'test@test.com',
                password: 'Password123!',
                name: 'Test'
            })
        });

        const res = await app.handle(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data).toHaveProperty('error', 'Email already exists');
    });

    it('should successfully signup and return user', async () => {
        dbMock.get.mockResolvedValueOnce(null); // No existing user
        dbMock.insert.mockReturnValue(dbMock);
        dbMock.values.mockResolvedValueOnce({}); // User insert
        dbMock.values.mockResolvedValueOnce({}); // Session insert
        dbMock.values.mockResolvedValueOnce({}); // Stats insert
        
        const req = new Request('http://localhost/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'new@test.com',
                password: 'Password123!',
                name: 'New User'
            })
        });

        const res = await app.handle(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.user).toBeDefined();
        expect(data.user.email).toBe('new@test.com');
        expect(data.user.name).toBe('New User');
    });
});
