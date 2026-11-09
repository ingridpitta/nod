import type { MotivoNegacao } from "../contracts/motivos.ts";
import {
  aposAcessoRecusado,
  aposSondaFalha,
  aposSondaOk,
  aposTimeoutDaChamada,
  deveRessondar,
  mesmoEstado,
  normalizar,
  promover,
  temFalha,
  type EstadoDisjuntor,
  type FalhaDoConector,
} from "../domain/disjuntor-conector.ts";
import { log } from "../obs/log.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * definido em 2026-10-26 (NOD-374): o disjuntor por app (src/domain/disjuntor-conector.ts) no banco. Cada caso de uso roda
 * numa tx CURTA com a linha do conector travada (FOR UPDATE), e nenhum chama o app: a sonda roda fora de tx
 * (src/adapters/fundo/disjuntor-conectores.ts) e só o resultado entra aqui. Só a dona do conector escreve (owner_id).
 */

/** Como a falha da chamada ao app pesa no disjuntor. */
export type TipoFalhaDaChamada = "acesso_recusado" | "timeout" | "queda";

/**
 * O erro do app em motivo da negação (o mapeamento de sempre, NOD-157) e em tipo do disjuntor: 401/403 → acesso recusado
 * (falha_tecnica com causa); timeout_transporte → timeout; o resto → queda (conector_indisponivel).
 */
export function classificarFalhaDaChamada(e: unknown): { tipo: TipoFalhaDaChamada; motivo: MotivoNegacao } {
  if (e instanceof Error && "status" in e && (e.status === 401 || e.status === 403)) return { tipo: "acesso_recusado", motivo: "falha_tecnica" };
  if (e instanceof Error && e.message === "timeout_transporte") return { tipo: "timeout", motivo: "timeout_transporte" };
  return { tipo: "queda", motivo: "conector_indisponivel" };
}

async function aplicar(deps: Deps, conectorId: string, f: (e: EstadoDisjuntor) => EstadoDisjuntor): Promise<{ antes: EstadoDisjuntor; depois: EstadoDisjuntor } | null> {
  const lido = await deps.repos.conectores.estadoFalhaTravado(conectorId);
  if (!lido) return null;
  const antes = normalizar(lido);
  const depois = f(antes);
  if (!mesmoEstado(lido, depois)) await deps.repos.conectores.gravarEstadoFalha(conectorId, depois);
  return { antes, depois };
}

export type EntradaFalhaDaChamada = { conectorId: string; tipo: TipoFalhaDaChamada; aleatorio?: number };

/**
 * A chamada falhou (fase 2). 401/403 aparece na hora; o timeout só conta (o 5º seguido abre e mostra); a queda não escreve
 * no conector — quem decide é a sonda de confirmação. Devolve se a confirmação deve rodar.
 */
export const registrarFalhaDaChamada: CasoDeUso<EntradaFalhaDaChamada, { confirmar: boolean }> = async (deps, input) => {
  const agora = deps.agora();
  if (input.tipo === "acesso_recusado") {
    await aplicar(deps, input.conectorId, (e) => aposAcessoRecusado(e, agora));
    return { data: { confirmar: false } };
  }
  if (input.tipo === "timeout") await aplicar(deps, input.conectorId, (e) => aposTimeoutDaChamada(e, agora, input.aleatorio ?? Math.random()));
  return { data: { confirmar: true } };
};

/** A recuperação automática na trilha (uma linha por bot que teve negação do app na falha) e no log. Nunca silêncio (ADR-029). */
async function registrarRecuperacao(deps: Deps, p: { conectorId: string; slug: string; falha: FalhaDoConector | null; agentes: readonly string[]; via: "sonda" | "chamada" }): Promise<void> {
  const agora = deps.agora();
  // Desde um minuto antes da falha: a negação da chamada que abriu a falha é gravada logo antes dela.
  const desde = (p.falha?.em ?? agora) - 60_000;
  const agentes = new Set([...p.agentes, ...(await deps.repos.trilha.agentesComNegacaoDoConector(p.conectorId, desde))]);
  for (const agenteId of agentes) {
    await deps.repos.trilha.registrar({ agenteId, conectorId: p.conectorId, ferramenta: p.slug, kind: "conector_recuperado", motivo: p.falha?.motivo ?? null, regra: "regra:disjuntor_conector", regraVersao: 1, em: agora });
  }
  log("info", "conector_recuperado", { conector_id: p.conectorId, slug: p.slug, via: p.via, motivo: p.falha?.motivo ?? null, fora_ms: p.falha ? agora - p.falha.em : null, bots: agentes.size });
}

export type EntradaSucessoDaChamada = { conectorId: string; slug: string; agenteId: string };

/**
 * Uma chamada deu certo num app que tinha falha (a fase 1 já viu): zera tudo e, se havia falha aberta, registra a volta.
 * O UPDATE é condicional — se outra chamada já limpou, nada se escreve.
 */
export const limparFalhaAposSucesso: CasoDeUso<EntradaSucessoDaChamada, { limpou: boolean }> = async (deps, input) => {
  const antes = await deps.repos.conectores.limparFalha(input.conectorId);
  if (antes === false) return { data: { limpou: false } };
  if (antes !== null) await registrarRecuperacao(deps, { conectorId: input.conectorId, slug: input.slug, falha: antes, agentes: [input.agenteId], via: "chamada" });
  return { data: { limpou: true } };
};

/**
 * definido em 2026-10-27 (revisão 7 do PR #538): a ação aprovada (ou do lote automático) que deu certo também fecha a
 * falha do app — o caminho da aprovação chama o conector por `executarItens`, fora do proxy. Chamado na fase 2 (tx da
 * dona). App sem falha: só a leitura que a fase já faz, nenhuma escrita (NOD-263). Um app por vez, sem repetir.
 */
export async function limparFalhasDosExecutados(deps: Deps, itens: readonly { slug: string; desfecho: string | null }[], agenteId: string): Promise<void> {
  // Em ordem de slug (revisão 8): duas fases 2 com os mesmos apps travam as linhas na mesma ordem — sem deadlock.
  const slugs = [...new Set(itens.filter((i) => i.desfecho === "executado").map((i) => i.slug))].sort();
  for (const slug of slugs) {
    const c = await deps.repos.conectores.buscarPorSlug(slug);
    if (!c) continue;
    const estado = { ultimaFalha: c.ultimaFalha, falhasSeguidas: c.falhasSeguidas ?? 0, timeoutsSeguidos: c.timeoutsSeguidos ?? 0, proximaSondaEm: c.proximaSondaEm ?? null, foraDoArDesde: c.foraDoArDesde ?? null };
    if (temFalha(estado)) await limparFalhaAposSucesso(deps, { conectorId: c.id, slug, agenteId });
  }
}

export type ResultadoDaSondaDeFundo = { ok: true } | { ok: false; motivo: MotivoNegacao; causa?: "acesso_recusado" };
export type EntradaResultadoDaSonda = { conectorId: string; slug: string; resultado: ResultadoDaSondaDeFundo; aleatorio?: number };
export type SaidaResultadoDaSonda = { recuperado: boolean; estado: EstadoDisjuntor | null };

/**
 * O resultado da sonda (de confirmação ou do laço). Falhou: abre/mantém a falha e marca a próxima. Respondeu com falha
 * aberta: o app voltou sozinho. Respondeu sem falha aberta (o timeout isolado): nada se escreve.
 */
export const aplicarResultadoDaSonda: CasoDeUso<EntradaResultadoDaSonda, SaidaResultadoDaSonda> = async (deps, input) => {
  const agora = deps.agora();
  const r = input.resultado;
  const aleatorio = input.aleatorio ?? Math.random();
  const feito = await aplicar(deps, input.conectorId, (e) => {
    if (r.ok) return aposSondaOk(e, agora, aleatorio);
    // 401/403 na sonda (credencial revogada que só a sonda viu): aparece na hora, com o texto de reconectar.
    if (r.causa === "acesso_recusado") return aposAcessoRecusado(e, agora);
    // Acesso recusado: a sonda que falha por outro motivo não troca a causa. Sai reconectando, com uma chamada que dá certo
    // ou com a sonda que responde (o `tools/list` autenticado prova que o acesso voltou); o laço não o re-sonda.
    if (e.ultimaFalha?.causa === "acesso_recusado") return e;
    return aposSondaFalha(e, r.motivo, agora, aleatorio);
  });
  if (!feito) return { data: { recuperado: false, estado: null } };
  const recuperado = feito.antes.ultimaFalha !== null && feito.depois.ultimaFalha === null;
  if (recuperado) await registrarRecuperacao(deps, { conectorId: input.conectorId, slug: input.slug, falha: feito.antes.ultimaFalha, agentes: [], via: "sonda" });
  return { data: { recuperado, estado: feito.depois } };
};

/** O laço, sem sondar: promove a falha que já persistiu e diz se a sonda venceu. */
export const promoverFalha: CasoDeUso<{ conectorId: string }, { sondar: boolean; promovida: boolean }> = async (deps, input) => {
  const agora = deps.agora();
  const feito = await aplicar(deps, input.conectorId, (e) => promover(e, agora));
  const promovida = feito !== null && feito.antes.foraDoArDesde === null && feito.depois.foraDoArDesde !== null;
  if (promovida) log("info", "conector_fora_do_ar", { conector_id: input.conectorId, motivo: feito.depois.ultimaFalha?.motivo ?? null, falhas_seguidas: feito.depois.falhasSeguidas });
  return { data: { sondar: feito !== null && deveRessondar(feito.depois, agora), promovida } };
};
