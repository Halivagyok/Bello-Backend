import { migrate } from 'drizzle-orm/libsql/migrator';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

// Create a custom client wrapper that intercepts errors
const originalClient = createClient({ url: 'file:bello.db' });

const safeClient = new Proxy(originalClient, {
    get(target, prop, receiver) {
        // Intercept 'execute'
        if (prop === 'execute') {
            return async (stmt: any) => {
                try {
                    return await target.execute(stmt);
                } catch (err: any) {
                    const msg = err.message || "";
                    if (msg.includes("duplicate column name") || msg.includes("already exists")) {
                        console.warn(`⚠️  ignoring error: ${msg}`);
                        return { rows: [], columns: [], rowsAffected: 0, lastInsertRowid: undefined };
                    }
                    throw err;
                }
            };
        }

        // Intercept 'batch'
        if (prop === 'batch') {
            return async (stmts: any[], mode?: any) => {
                try {
                    return await target.batch(stmts, mode);
                } catch (err: any) {
                    const msg = err.message || "";
                    if (msg.includes("duplicate column name") || msg.includes("already exists")) {
                        console.warn(`⚠️  ignoring batch error: ${msg}`);
                        return stmts.map(() => ({ rows: [], columns: [], rowsAffected: 0, lastInsertRowid: undefined }));
                    }
                    throw err;
                }
            };
        }

        // Intercept 'migrate' (used by LibSQL adapter)
        if (prop === 'migrate') {
            return async (stmts: any[]) => {
                try {
                    return await target.migrate(stmts);
                } catch (err: any) {
                    const msg = err.message || "";
                    // SQLite error for table exists is often just "already exists" or "table ... already exists"
                    if (msg.includes("duplicate column name") || msg.includes("already exists")) {
                        console.warn(`⚠️  ignoring migration error: ${msg}`);
                        // Migrate usually returns an array of results results, one for each statement
                        return stmts.map(() => ({ rows: [], columns: [], rowsAffected: 0, lastInsertRowid: undefined }));
                    }
                    throw err;
                }
            }
        }

        // Forward everything else, but BIND functions to the original target
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
            return value.bind(target);
        }
        return value;
    }
});

// @ts-ignore - safeClient is a close-enough proxy
const db = drizzle(safeClient);

async function main() {
    console.log('⏳ Running SAFE migrations...');

    try {
        await migrate(db, { migrationsFolder: 'drizzle' });
        console.log('✅ Migrations completed successfully (with potential skips)!');
    } catch (err) {
        console.error('❌ Migration failed!');
        console.error(err);
        process.exit(1);
    }

    process.exit(0);
}

main();
