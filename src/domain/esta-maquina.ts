import { PLATAFORMAS_MAQUINA } from "../contracts/maquina.ts";
import type { EstaMaquina } from "../contracts/desktop-esta-maquina.ts";

/**
 * ADA-243 (definido em 2026-11-07): o que o processo principal do app (Mac e Windows) devolve na ponte `estaMaquina`.
 * Pura. Sem id = null (esta instalação ainda não conectou); plataforma fora da lista vira darwin (o app do Mac). Mora
 * aqui e não no contrato, que é só tipos (EMENDA 26). A web confere o formato com `lerEstaMaquina` (web/telas/maquinas.ts).
 */
export function estaMaquinaDe(o: { id: string | null | undefined; nome: string; plataforma: string }): EstaMaquina | null {
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  const plataforma = PLATAFORMAS_MAQUINA.find((p) => p === o.plataforma) ?? "darwin";
  return { id, nome: o.nome.trim().slice(0, 120) || "este computador", plataforma };
}
