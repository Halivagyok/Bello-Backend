import { createClient } from '@libsql/client';
const client = createClient({ url: 'file:bello.db' });
async function fix() {
    try {
        console.log("Adding new columns to personal_tasks...");
        try { await client.execute("ALTER TABLE personal_tasks ADD COLUMN date text;"); } catch(e) {}
        try { await client.execute("ALTER TABLE personal_tasks ADD COLUMN location text;"); } catch(e) {}
        try { await client.execute("ALTER TABLE personal_tasks ADD COLUMN image_url text;"); } catch(e) {}
        
        console.log("✅ Columns added successfully!");
    } catch (e) {
        console.error("❌ Failed to update table:");
        console.error(e);
    }
    process.exit(0);
}
fix();
