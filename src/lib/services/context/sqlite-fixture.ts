/** Isolated SQLite fixture from the generated schema; never opens the user's DB. */
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export async function createContextTestDatabase(): Promise<PrismaClient> {
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: ':memory:' }) });
  const schema = readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  for (const model of Prisma.dmmf.datamodel.models.filter((model) => ['User', 'ContextEvent', 'ContextGrant'].includes(model.name))) {
    const fields = model.fields.filter((field) => field.kind !== 'object');
    const columns = fields.map((field) => {
      const type = ['Int', 'Boolean'].includes(field.type) ? 'INTEGER' : field.type === 'Float' ? 'REAL' : 'TEXT';
      let fallback = '';
      if (field.default !== undefined && field.default !== null) {
        if (typeof field.default === 'string') fallback = ` DEFAULT '${field.default.replaceAll("'", "''")}'`;
        else if (typeof field.default === 'number') fallback = ` DEFAULT ${field.default}`;
        else if (typeof field.default === 'boolean') fallback = ` DEFAULT ${Number(field.default)}`;
        else if (typeof field.default === 'object' && 'name' in field.default && field.default.name === 'now') fallback = ' DEFAULT CURRENT_TIMESTAMP';
      }
      return `${quote(field.name)} ${type}${field.isId ? ' PRIMARY KEY' : ''}${field.isRequired ? ' NOT NULL' : ''}${field.isUnique ? ' UNIQUE' : ''}${fallback}`;
    });
    // Prisma 7's reduced runtime DMMF omits compound indexes.
    const modelSource = schema.split(`model ${model.name} {`)[1]?.split('\n}')[0] ?? '';
    const constraints = [...modelSource.matchAll(/@@unique\(\[([^\]]+)\]/g)].map((match) =>
      `UNIQUE (${match[1].split(',').map((name) => quote(name.trim())).join(',')})`);
    await db.$executeRawUnsafe(`CREATE TABLE ${quote(model.name)} (${[...columns, ...constraints].join(',')})`);
  }
  return db;
}
