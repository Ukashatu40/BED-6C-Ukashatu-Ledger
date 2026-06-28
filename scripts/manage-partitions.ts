// scripts/manage-partitions.ts
// Usage: npm run partitions:manage -- --action list
// Usage: npm run partitions:manage -- --action create --months 3
// Usage: npm run partitions:manage -- --action archive --partition ledger_entries_2025_01
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config();

interface PartitionRow {
  partition_name: string;
  row_count: string;
  size: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const actionIdx = args.indexOf('--action');
  const action = actionIdx >= 0 ? args[actionIdx + 1] : 'list';
  const monthsIdx = args.indexOf('--months');
  const months = monthsIdx >= 0 ? parseInt(args[monthsIdx + 1] ?? '3', 10) : 3;
  const partIdx = args.indexOf('--partition');
  const partitionName = partIdx >= 0 ? args[partIdx + 1] : undefined;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);

  const prisma = new PrismaClient({ adapter });

  try {
    switch (action) {
      case 'list':
        await listPartitions(prisma);
        break;
      case 'create':
        await createFuturePartitions(prisma, months);
        break;
      case 'archive':
        if (!partitionName) {
          console.error('--partition is required for archive action');
          process.exit(1);
        }
        await archivePartition(prisma, partitionName);
        break;
      default:
        console.error(`Unknown action: ${action ?? 'undefined'}. Use list, create, or archive.`);
        process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function listPartitions(prisma: PrismaClient): Promise<void> {
  console.log('\n📂 Ledger Entry Partitions\n');

  const rows = await prisma.$queryRaw<PartitionRow[]>`
    SELECT
      child.relname                                    AS partition_name,
      pg_stat_get_live_tuples(child.oid)::TEXT         AS row_count,
      pg_size_pretty(pg_relation_size(child.oid))      AS size
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
    WHERE parent.relname = 'ledger_entries'
    ORDER BY child.relname
  `;

  if (rows.length === 0) {
    console.log('No partitions found — table may not be partitioned yet.');
    return;
  }

  console.log('Partition Name'.padEnd(40) + 'Rows'.padStart(12) + 'Size'.padStart(12));
  console.log('─'.repeat(64));
  for (const row of rows) {
    console.log(row.partition_name.padEnd(40) + row.row_count.padStart(12) + row.size.padStart(12));
  }
  console.log();
}

async function createFuturePartitions(prisma: PrismaClient, monthsAhead: number): Promise<void> {
  console.log(`\n🗓  Creating ${monthsAhead.toString()} future partition(s)...\n`);

  const now = new Date();

  for (let i = 0; i <= monthsAhead; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const nextDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const partSuffix = `${date.getFullYear().toString()}_${String(date.getMonth() + 1).padStart(2, '0')}`;
    const partName = `ledger_entries_${partSuffix}`;
    const fromStr = date.toISOString().slice(0, 10);
    const toStr = nextDate.toISOString().slice(0, 10);

    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${partName}
        PARTITION OF ledger_entries
        FOR VALUES FROM ('${fromStr}') TO ('${toStr}')
      `);
      console.log(`  ✅ Created partition ${partName} (${fromStr} → ${toStr})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) {
        console.log(`  ⏭  Partition ${partName} already exists`);
      } else {
        throw err;
      }
    }
  }
  console.log();
}

async function archivePartition(prisma: PrismaClient, partitionName: string): Promise<void> {
  console.log(`\n📦 Archiving partition: ${partitionName}\n`);

  // Export to CSV first
  const csvPath = `/tmp/${partitionName}_archive.csv`;
  await prisma.$executeRawUnsafe(`
    COPY (SELECT * FROM ${partitionName}) TO '${csvPath}' WITH CSV HEADER
  `);
  console.log(`  ✅ Exported to ${csvPath}`);

  // Detach from parent table (data preserved in the child table)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE ledger_entries DETACH PARTITION ${partitionName}
  `);
  console.log(`  ✅ Detached ${partitionName} from ledger_entries`);
  console.log(`\n  📝 The partition table still exists as a standalone table.`);
  console.log(
    `     Copy the CSV to cold storage then DROP TABLE ${partitionName} when confirmed.\n`,
  );
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
