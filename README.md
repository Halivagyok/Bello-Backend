# 🔧 Bello — Backend

The backend API server for **[Bello](https://projectbello.hu)**, a real-time collaborative project management application.

Built with **Bun + Elysia + Drizzle ORM + SQLite**.

🌐 **[Live Site](https://projectbello.hu)** · 🔗 **[Frontend Repository](https://github.com/Halivagyok/Bello)**

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0 or later)

### Installation

```bash
bun install
```

### Environment Setup

Create a `.env` file in the backend root directory:

```env
# SMTP Configuration (for email features: welcome emails, invites, password resets)
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="Bello" <noreply@yourdomain.com>

# Frontend URL (for CORS and email links)
FRONTEND_URL=http://localhost:5173
```

### Database Setup

```bash
# Run database migrations
bun run db:migrate
```

### Running

```bash
# Development (with watch mode)
bun run dev

# Production
bun run src/index.ts
```

The server starts on `http://localhost:3000`.

### Running Tests

```bash
bun run vitest --run
```

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **Bun** | JavaScript runtime |
| **Elysia** | HTTP framework with WebSocket support |
| **Drizzle ORM** | Type-safe SQL ORM |
| **SQLite (LibSQL)** | Embedded database |
| **Nodemailer** | SMTP email sending |
| **React Email** | Email template rendering |

---

For full documentation including API endpoints, database schema, and feature details, see the **[Frontend Repository README](https://github.com/Halivagyok/Bello)**.
