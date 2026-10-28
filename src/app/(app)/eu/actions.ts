"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, strOrNull } from "@/lib/utils";

const go = (k: "ok" | "erro", msg: string) => `/eu?${k}=${encodeURIComponent(msg)}#contato`;
/** T-104 · O colaborador atualiza o próprio contato (telefone, e-mail, endereço, contato de emergência) — nada além disso; trilha com antes e depois. */
export async function atualizarContato(fd: FormData) {
  const s = await requireSession();
  try {
    assert(!!s.employeeId, "Seu acesso não está ligado a uma ficha de colaborador."); assert(s.role !== "LEITURA", "Acesso somente leitura.");
    const telefone = strOrNull(fd, "telefone"), email = strOrNull(fd, "email"), endereco = strOrNull(fd, "endereco"), emerg = strOrNull(fd, "contatoEmergencia");
    if (telefone) assert(telefone.replace(/\D/g, "").length >= 10 && telefone.replace(/\D/g, "").length <= 13, "Telefone: informe DDD e número.");
    if (email) assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "E-mail inválido.");
    assert((endereco ?? "").length <= 300 && (emerg ?? "").length <= 200, "Texto longo demais.");
    const [antes] = await sql<{ telefone: string | null; email: string | null; endereco: string | null; contato_emergencia: string | null }[]>`SELECT telefone, email, endereco, contato_emergencia FROM employees WHERE id=${s.employeeId!}`;
    await sql`UPDATE employees SET telefone=${telefone}, email=${email}, endereco=${endereco}, contato_emergencia=${emerg}, updated_at=now() WHERE id=${s.employeeId!}`;
    await audit(s, "atualizar o próprio contato (portal do colaborador)", "employees", s.employeeId!, antes ?? null, { telefone, email, endereco, contato_emergencia: emerg });
  } catch (e) { redirect(go("erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("ok", "Contato atualizado. O RH vê a mudança na sua ficha."));
}
