import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type AppDatabase = DatabaseSync;

export function createDb(filePath: string): AppDatabase {
  if (filePath !== ':memory:') {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}
