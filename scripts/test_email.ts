import { sendWelcomeEmail } from '../src/services/email';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const testEmail = process.argv[2];

if (!testEmail) {
    console.error('Usage: bun scripts/test_email.ts <email>');
    process.exit(1);
}

console.log(`Sending test email to ${testEmail}...`);
sendWelcomeEmail(testEmail, 'Test User')
    .then(() => console.log('Done.'))
    .catch(console.error);
