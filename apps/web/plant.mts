import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from '@parea/core';
import { storeCode } from './src/accounts';
const client = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const db = drizzle(client, { schema }) as never;
await storeCode(db, 'local-check', process.argv[2]!, '424242');
console.log('planted for', process.argv[2]);
await client.end();
