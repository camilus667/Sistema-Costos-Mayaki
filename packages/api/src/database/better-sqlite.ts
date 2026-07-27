import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import * as path from 'path';

// Crear directorio de database si no existe
const dbPath = path.join(__dirname, '../../../database.sqlite');

const sqlite = Database(dbPath);
export const db = drizzle(sqlite, { schema });
