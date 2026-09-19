import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres.js só conecta na primeira consulta, então o build não exige banco.
const url = process.env.DATABASE_URL ?? "postgresql://status:status@localhost:5432/status_people";
const globalForDb = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
export const sql = globalForDb.__sql ?? postgres(url, { max: 5, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;
export const db = drizzle(sql, { schema });
export { schema };
