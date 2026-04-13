import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

const id = process.argv[2];

if (!id) {
    console.error('Please provide an id as an argument.');
    console.error('Usage: bun run scripts/give_admin_by_id.ts <id>');
    process.exit(1);
}

async function main(targetId: string) {
    const user = await db.select().from(users).where(eq(users.id, targetId)).get();

    if (!user) {
        console.error(`User with id ${targetId} not found.`);
        process.exit(1);
    }

    await db.update(users)
        .set({ isAdmin: true })
        .where(eq(users.id, targetId));

    console.log(`Successfully made ${user.email} an admin! 👑`);
}

main(id).catch(console.error);
