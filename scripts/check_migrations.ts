import { createClient } from '@libsql/client';
const client = createClient({ url: 'file:bello.db' });
async function check() {
    try {
        const result = await client.execute("SELECT * FROM __drizzle_migrations;");
        console.log("Migrations in database:");
        result.rows.forEach(row => console.log(`- ${row.id}: ${row.hash} (at ${row.created_at})`));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
check();
