import { config } from "dotenv"; config();
import { runMigrations, seedBase } from "../src/db/setup";
import { sql } from "../src/db";
runMigrations().then(async r => { console.log("aplicadas", r.aplicadas, "falhas", r.falhas.length); for (const f of r.falhas) console.log("FALHA:", f.erro, "\n   ", f.sql.slice(0, 220)); const log = await seedBase(process.env.ADMIN_PASSWORD ?? "Status2026!"); console.log(log.join("\n")); await sql.end(); }).catch(async e => { console.error(e); await sql.end(); process.exit(1); });
