import { PrismaClient } from '@prisma/client';

/**
 * Prisma-Singleton. In der Entwicklung überlebt der Client Hot-Reloads über
 * globalThis, damit nicht bei jeder Änderung neue Verbindungen entstehen.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
