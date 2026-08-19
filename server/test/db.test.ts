import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db';

describe('createDb', () => {
  it('creates the users and jobs tables', () => {
    const db = createDb(':memory:');

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual(['jobs', 'users']);
  });
});
