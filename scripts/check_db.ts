import { createClient } from '@libsql/client';
const client = createClient({ url: 'file:bello.db' });
async function check() {
    try {
        const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table';");
        console.log("Tables in database:");
        result.rows.forEach(row => console.log(`- ${row.name}`));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
check();
