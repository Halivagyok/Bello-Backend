import { vi } from 'vitest';

const dbMock = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    get: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
};

// Fluent chaining setup
dbMock.select.mockReturnValue(dbMock);
dbMock.from.mockReturnValue(dbMock);
dbMock.where.mockReturnValue(dbMock);
dbMock.insert.mockReturnValue(dbMock);
dbMock.values.mockReturnValue(dbMock);
dbMock.update.mockReturnValue(dbMock);
dbMock.set.mockReturnValue(dbMock);
dbMock.delete.mockReturnValue(dbMock);
dbMock.innerJoin.mockReturnValue(dbMock);
dbMock.orderBy.mockReturnValue(dbMock);

vi.mock('drizzle-orm/libsql', () => ({
    drizzle: vi.fn(() => dbMock)
}));

vi.mock('@libsql/client', () => ({
    createClient: vi.fn()
}));

vi.mock('../src/services/email', () => ({
    sendWelcomeEmail: vi.fn(),
    sendResetPasswordEmail: vi.fn(),
    sendInviteEmail: vi.fn()
}));

// Export the mock so tests can assert on it
export const getDbMock = () => dbMock;

// Mock Bun globals
globalThis.Bun = {
    env: process.env || {},
    gc: vi.fn(),
    password: {
        hash: vi.fn().mockResolvedValue('hashed_password'),
        verify: vi.fn().mockResolvedValue(true)
    },
    write: vi.fn()
} as any;
