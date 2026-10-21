import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';
export function connectDatabase(url: string) {
  const sql = new SQL(url, { max: 5, idleTimeout: 20, connectionTimeout: 5 });
  return { sql, db: drizzle({ client: sql, schema }) };
}
export type Database = ReturnType<typeof connectDatabase>;
