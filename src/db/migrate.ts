import { migrate } from 'drizzle-orm/libsql/migrator';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

const client = createClient({ url: 'file:bello.db' });
const db = drizzle(client);

async function main() {
    console.log('⏳ Running migrations...');
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('✅ Migrations completed!');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Migration failed!');
    console.error(err);
    process.exit(1);
});
