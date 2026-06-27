// src/common/types/entry-type.enum.ts

/**
 * Re-export EntryType from Prisma client so feature modules
 * import from our common layer, not directly from @prisma/client.
 * This decouples feature code from the ORM.
 */
export { EntryType, EntryStatus, TransactionType, TransactionStatus } from '@prisma/client';
