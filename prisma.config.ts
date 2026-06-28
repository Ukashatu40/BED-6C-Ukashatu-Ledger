// prisma.config.ts
import * as path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Explicitly force dot-env to locate your file using the project's root working directory [1]
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Explicitly reference the environment variable to ensure Prisma reads it correctly [1]
    url: process.env.DATABASE_URL,
  },
});
