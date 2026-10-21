import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { connectDatabase } from './db';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const database=connectDatabase(process.env.DATABASE_URL);
try { await migrate(database.db,{migrationsFolder:'./db/migrations'}); console.info('Migrations applied.'); }
finally { await database.sql.close(); }
