// Uso local: npm run setup  (usa DATABASE_URL e ADMIN_PASSWORD do .env)
import { config } from "dotenv"; config();
import { runMigrations, seedBase } from "../src/db/setup";
import { sql } from "../src/db";
runMigrations().then(() => seedBase(process.env.ADMIN_PASSWORD ?? "Status2026!")).then(async log => { console.log(log.join("\n") || "Banco já configurado."); await sql.end(); }).catch(e => { console.error(e); process.exit(1); });
