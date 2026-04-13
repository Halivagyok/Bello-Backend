import { createClient } from '@libsql/client';
const client = createClient({ url: 'file:bello.db' });
async function fix() {
    try {
        console.log("Creating personal_tasks table...");
        await client.execute(`
            CREATE TABLE IF NOT EXISTS \`personal_tasks\` (
                \`id\` text PRIMARY KEY NOT NULL,
                \`user_id\` text NOT NULL,
                \`title\` text NOT NULL,
                \`description\` text,
                \`due_time\` text,
                \`days_of_week\` text,
                \`created_at\` integer NOT NULL,
                FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
            );
        `);
        
        console.log("Creating personal_task_completions table...");
        await client.execute(`
            CREATE TABLE IF NOT EXISTS \`personal_task_completions\` (
                \`id\` text PRIMARY KEY NOT NULL,
                \`task_id\` text NOT NULL,
                \`completed_date\` text NOT NULL,
                \`created_at\` integer NOT NULL,
                FOREIGN KEY (\`task_id\`) REFERENCES \`personal_tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade
            );
        `);
        
        console.log("✅ Tables created successfully!");
    } catch (e) {
        console.error("❌ Failed to create tables:");
        console.error(e);
    }
    process.exit(0);
}
fix();
