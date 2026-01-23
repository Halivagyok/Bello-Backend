// backend/src/index.ts
import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';

const app = new Elysia()
    .use(cors())       // 🔓 Allow Frontend to access Backend
    .use(swagger())    // 📄 Auto-generate Documentation

    // 🟢 Simple Test Route
    .get('/api/ping', () => {
        return {
            message: "Pong! Backend is working 🚀",
            time: new Date().toISOString()
        };
    })

    .listen(3000);

console.log(`🦊 Backend running at http://localhost:3000`);
console.log(`📄 Swagger docs at http://localhost:3000/swagger`);