import { createClient } from '@libsql/client';
const client = createClient({ url: 'file:bello.db' });
async function check() {
    try {
        const result = await client.execute("SELECT id, content, due_date FROM cards WHERE due_date IS NOT NULL LIMIT 5;");
        console.log("Cards with due dates:");
        result.rows.forEach(row => {
            console.log(`- ${row.id}: ${row.content} | due_date: ${row.due_date} (type: ${typeof row.due_date})`);
        });
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
check();
