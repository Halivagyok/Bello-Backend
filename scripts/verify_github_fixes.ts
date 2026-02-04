
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { users, projects, boards, lists, cards, sessions } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const API_URL = 'http://localhost:3000';
const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

async function main() {
    console.log('🧪 Starting Verification of GitHub Fixes...');

    // 1. Setup User
    const email = `test_gh_${Date.now()}@test.com`;
    const password = 'password123';
    await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'Tester' })
    });

    // Login
    let res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const cookie = res.headers.get('set-cookie')!;
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' };

    // 2. Test Schema Defaults (Create Project)
    console.log('Testing Schema Default (createdAt)...');
    res = await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Test Project' })
    });
    const project = await res.json();
    const createdAt = new Date(project.createdAt);
    const now = new Date();
    if (Math.abs(now.getTime() - createdAt.getTime()) > 5000) {
        throw new Error(`createdAt seems stale or wrong: ${createdAt.toISOString()} vs ${now.toISOString()}`);
    }
    console.log('✅ Schema DefaultFn works (createdAt is recent)');

    // 3. Test Status Codes for Missing Items
    console.log('Testing Status Codes...');

    // Test List Delete 404
    const fakeId = '00000000-0000-0000-0000-000000000000';
    res = await fetch(`${API_URL}/lists/${fakeId}`, {
        method: 'DELETE',
        headers
    });
    if (res.status !== 404) {
        throw new Error(`Expected 404 for missing list DELETE, got ${res.status}`);
    }
    console.log('✅ /lists/:id DELETE returns 404');

    res = await fetch(`${API_URL}/lists/${fakeId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title: 'New' })
    });
    if (res.status !== 404) {
        throw new Error(`Expected 404 for missing list PATCH, got ${res.status}`);
    }
    console.log('✅ /lists/:id PATCH returns 404');

    // 4. Test Board Loading with optimized query
    console.log('Testing Board Loading...');
    // Create Board
    res = await fetch(`${API_URL}/boards`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Test Board', projectId: project.id })
    });
    const board = await res.json();

    // Create List
    res = await fetch(`${API_URL}/boards/${board.id}/lists`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'List 1' })
    });
    const list = await res.json();

    // Create Card
    res = await fetch(`${API_URL}/cards`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: 'Card 1', listId: list.id })
    });
    const card = await res.json();

    // Fetch Board
    res = await fetch(`${API_URL}/boards/${board.id}`, { headers });
    const boardData = await res.json();

    if (!boardData.lists[0].cards || boardData.lists[0].cards.length !== 1) {
        throw new Error('Cards not loaded correcty in board view');
    }
    if (boardData.lists[0].cards[0].id !== card.id) {
        throw new Error('Card ID mismatch');
    }
    console.log('✅ Board loading with optimized query works');

    console.log('🎉 All GitHub fixes verified!');
    process.exit(0);
}

main().catch(e => {
    console.error('❌ Verification Failed:', e);
    process.exit(1);
});
