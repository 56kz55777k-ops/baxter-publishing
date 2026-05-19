import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Server-side DB client.
 * Use the service-role connection string for trusted server contexts;
 * use the anon/RLS-bound connection from Supabase clients for user-scoped reads.
 */
const connectionString = process.env.DATABASE_URL ?? '';

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  prepare: false,
});

export const db = drizzle(client, { schema });

export type DB = typeof db;
