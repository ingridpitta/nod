import type { DefinicaoAcao, RiscoAcao } from "../../contracts/acoes.ts";
import { ONDAS } from "../../contracts/acoes.ts";
import type { AcaoLote, TipoAcaoLote } from "../../contracts/ferramentas-do-nod.ts";
import { ACOES_ACESSOS } from "./acessos.ts";
import { ACOES_APPS } from "./apps.ts";
import { ACOES_BOTS } from "./bots.ts";
import { ACOES_CANVAS } from "./canvas.ts";
import { ACOES_CONTA } from "./conta.ts";
import { ACOES_CONTAS_IA } from "./contas-ia.ts";
import { ACOES_CONVERSA } from "./conversa.ts";
import { ACOES_MAQUINAS } from "./maquinas.ts";
import { ACOES_QUADRO } from "./quadro.ts";
import { ACOES_ROTINAS } from "./rotinas.ts";
import { ACOES_TELA } from "./tela.ts";
import { ACOES_TIMES } from "./times.ts";

/**
 * O registro único de ações (definido em 2026-10-28, NOD-391, ADR-135): a lista FECHADA das ações de pessoa que mudam
 * algo, um arquivo por domínio. `IdAcao` sai daqui: a rota que declara um id fora do registro não compila.
 */
export const REGISTRO_DE_ACOES = [...ACOES_BOTS, ...ACOES_ROTINAS, ...ACOES_ACESSOS, ...ACOES_CONTAS_IA, ...ACOES_MAQUINAS, ...ACOES_CONVERSA, ...ACOES_CONTA, ...ACOES_TELA, ...ACOES_QUADRO, ...ACOES_APPS, ...ACOES_TIMES, ...ACOES_CANVAS] as const;

export type IdAcao = (typeof REGISTRO_DE_ACOES)[number]["id"];

/** `dominio.verbo`: minúsculas, dígitos e sublinhado, um ponto só. */
export const FORMATO_ID_ACAO = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** O que há de errado no registro; vazio = ok. Puro, para o teste unitário provar cada regra com um registro de mentira. */
export function validarRegistro(registro: readonly DefinicaoAcao[]): string[] {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  const tiposNoLote = new Set<TipoAcaoLote>();
  for (const a of registro) {
    if (!FORMATO_ID_ACAO.test(a.id)) problemas.push(`${a.id}: fora do formato dominio.verbo`);
    if (vistos.has(a.id)) problemas.push(`${a.id}: id repetido`);
    vistos.add(a.id);
    if (a.titulo.trim() === "") problemas.push(`${a.id}: sem título`);
    const c = a.chat;
    if ((c.estado === "vivo" || c.estado === "parcial") && !a.schema) problemas.push(`${a.id}: ${c.estado} sem schema`);
    if (c.estado === "vivo" && c.contrato.trim() === "") problemas.push(`${a.id}: vivo sem teste de contrato`);
    if (c.estado === "vivo" && !a.casoDeUso) problemas.push(`${a.id}: vivo sem executor único (casoDeUso)`);
    if (c.estado === "parcial" && c.falta.trim() === "") problemas.push(`${a.id}: parcial sem dizer o que falta`);
    if (c.estado === "falta" && !(ONDAS as readonly string[]).includes(c.onda)) problemas.push(`${a.id}: onda ${c.onda} desconhecida`);
    if (c.estado === "nunca" && c.motivo.trim() === "") problemas.push(`${a.id}: nunca sem motivo`);
    if (a.lote) {
      if (tiposNoLote.has(a.lote.tipo)) problemas.push(`${a.id}: tipo do lote ${a.lote.tipo} em dois ids`);
      tiposNoLote.add(a.lote.tipo);
      if ((c.estado === "vivo" || c.estado === "parcial") && c.via.tipoNoLote !== a.lote.tipo) problemas.push(`${a.id}: a via do chat não é o tipo do lote`);
    }
  }
  return problemas;
}

const POR_ID = new Map<string, DefinicaoAcao>(REGISTRO_DE_ACOES.map((a) => [a.id, a]));
const POR_TIPO_DO_LOTE = new Map<TipoAcaoLote, DefinicaoAcao>(REGISTRO_DE_ACOES.flatMap((a): [TipoAcaoLote, DefinicaoAcao][] => ("lote" in a && a.lote ? [[a.lote.tipo, a]] : [])));

export function buscarAcao(id: string): DefinicaoAcao | undefined {
  return POR_ID.get(id);
}

/** A ação do registro que o tipo do lote executa (todo tipo de TIPOS_ACAO_LOTE tem uma; o teste de lista fechada prova). */
export function acaoDoTipoDoLote(tipo: TipoAcaoLote): DefinicaoAcao {
  const a = POR_TIPO_DO_LOTE.get(tipo);
  if (!a) throw new Error(`tipo do lote sem ação no registro: ${tipo}`);
  return a;
}

/** Os tipos do lote no registro (o teste de lista fechada os compara com TIPOS_ACAO_LOTE). */
export function tiposDoLoteNoRegistro(): TipoAcaoLote[] {
  return [...POR_TIPO_DO_LOTE.keys()];
}

/** O risco desta chamada do lote, pelo registro: o `riscoDe` do id, senão o risco fixo. */
export function riscoNoLote(a: Pick<AcaoLote, "tipo" | "descricao" | "titulo" | "modo" | "nivel_lote">): RiscoAcao {
  const def = acaoDoTipoDoLote(a.tipo);
  return def.lote?.riscoDe?.(a) ?? def.risco;
}

/** A cerca 3 do id para esta chamada do lote (ADR-082): depois de conteúdo de fora, vira cartão? */
export function deForaNoLote(a: Pick<AcaoLote, "tipo" | "descricao" | "titulo" | "modo" | "nivel_lote">, s: { alvoTemAcessos: boolean }): boolean {
  return acaoDoTipoDoLote(a.tipo).lote?.deFora?.(a, s) ?? false;
}
