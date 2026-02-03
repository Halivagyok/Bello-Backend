
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const API_URL = 'http://localhost:3000';
const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

async function main() {
    console.log('🧪 Starting Verification...');

    // 1. Create Admin User
    const adminEmail = `admin_${Date.now()}@test.com`;
    const password = 'password123';

    console.log(`Creating admin: ${adminEmail}`);
    let res = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password, name: 'Admin' })
    });
    let data = await res.json();
    if (!res.ok) throw new Error(`Signup failed: ${JSON.stringify(data)}`);
    const adminId = data.user.id;

    // Elevate to Admin manually
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, adminId));

    // Login to get cookie
    res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password })
    });
    const cookie = res.headers.get('set-cookie');
    if (!cookie) throw new Error('No cookie received');
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' };

    // 2. Create Regular User
    const userEmail = `user_${Date.now()}@test.com`;
    console.log(`Creating user: ${userEmail}`);
    res = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password, name: 'User' })
    });
    data = await res.json();
    const userId = data.user.id;

    // 3. Test Admin Stats (Transformation/Optimization Check)
    console.log('Testing /admin/users stats...');
    res = await fetch(`${API_URL}/admin/users`, { headers });
    data = await res.json();
    if (!Array.isArray(data)) throw new Error('Expected array from /admin/users');
    const adminUserStats = data.find((u: any) => u.id === adminId);
    if (typeof adminUserStats.projectsCount !== 'number') throw new Error('Missing projectsCount');
    console.log('✅ Admin stats structure verified');

    // 4. Test Self-Ban Prevention
    console.log('Testing Self-Ban Prevention...');
    res = await fetch(`${API_URL}/admin/users/${adminId}/ban`, {
        method: 'POST',
        headers
    });
    if (res.ok) throw new Error('Self-ban should fail');
    data = await res.json();
    if (res.status !== 400 || data.error !== 'Cannot ban yourself') {
        throw new Error(`Unexpected response for self-ban: ${res.status} ${JSON.stringify(data)}`);
    }
    console.log('✅ Self-ban prevented');

    // 5. Test User Ban
    console.log('Testing User Ban...');
    res = await fetch(`${API_URL}/admin/users/${userId}/ban`, {
        method: 'POST',
        headers
    });
    if (!res.ok) throw new Error(`User ban failed: ${res.status}`);
    data = await res.json();
    if (data.isBanned !== true) throw new Error('User not banned');
    console.log('✅ User banned successfully');

    console.log('🎉 All verifications passed!');
    process.exit(0);
}

main().catch(e => {
    console.error('❌ Verification Failed:', e);
    process.exit(1);
});
