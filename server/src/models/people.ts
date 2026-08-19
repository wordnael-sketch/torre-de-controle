import type { AppDatabase } from '../db';

export interface Person {
  id: number;
  name: string;
  area: string;
  active: boolean;
}

interface PersonRow {
  id: number;
  name: string;
  area: string;
  active: boolean;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    active: row.active,
  };
}

export async function listPeople(
  db: AppDatabase,
  opts: { activeOnly?: boolean } = {},
): Promise<Person[]> {
  const query = opts.activeOnly
    ? 'SELECT * FROM people WHERE active = true ORDER BY area, name'
    : 'SELECT * FROM people ORDER BY area, name';
  const result = await db.query<PersonRow>(query);
  return result.rows.map(toPerson);
}

export async function createPerson(
  db: AppDatabase,
  input: { name: string; area: string },
): Promise<Person> {
  const result = await db.query<PersonRow>(
    'INSERT INTO people (name, area) VALUES ($1, $2) RETURNING *',
    [input.name, input.area],
  );
  return toPerson(result.rows[0]);
}

export async function setPersonActive(
  db: AppDatabase,
  id: number,
  active: boolean,
): Promise<Person> {
  const result = await db.query<PersonRow>(
    'UPDATE people SET active = $1 WHERE id = $2 RETURNING *',
    [active, id],
  );
  return toPerson(result.rows[0]);
}
