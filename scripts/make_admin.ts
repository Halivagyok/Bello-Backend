import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

const email = process.argv[2];

if (!email) {
    console.error('Please provide an email address as an argument.');
    console.error('Usage: bun run scripts/make_admin.ts <email>');
    process.exit(1);
}

async function main(targetEmail: string) {
    const user = await db.select().from(users).where(eq(users.email, targetEmail)).get();

    if (!user) {
        console.error(`User with email ${targetEmail} not found.`);
        process.exit(1);
    }

    await db.update(users)
        .set({ isAdmin: true })
        .where(eq(users.email, targetEmail));

    console.log(`Successfully made ${targetEmail} an admin! 👑`);
}

main(email).catch(console.error);
