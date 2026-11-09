import type { FrotaDto } from "../../src/contracts/api.ts";
import { chaveDoTime } from "./times-da-barra.ts";

type Bot = FrotaDto["agentes"][number];

/**
 * Arrastar na barra lateral (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): um grupo é a grade de fixados
 * ou uma seção ("" = Meus agentes). Soltar manda ao servidor a ordem inteira do grupo de destino (0041) e a barra se
 * reorganiza na hora, sem esperar a frota voltar.
 */
export type Destino = { grupo: "fixados" } | { grupo: "secao"; secao: string };

// NOD-437: o time casa pela chave do nome ("produção" e "Produção" são o mesmo time).
const noGrupo = (b: Bot, destino: Destino): boolean => (destino.grupo === "fixados" ? b.fixado : !b.fixado && chaveDoTime(b.secao ?? "") === chaveDoTime(destino.secao));

/** A mesma ordem do servidor: fixados primeiro, depois a posição (null por último), depois a criação. */
export function compararNaBarra(x: Bot, y: Bot): number {
  return Number(y.fixado) - Number(x.fixado) || (x.posicao ?? Infinity) - (y.posicao ?? Infinity) || x.criadoEm - y.criadoEm;
}

/** Os ids do grupo de destino na ordem da barra, com o bot solto em `indice` (fora do alcance = no fim). */
export function ordemAoSoltar(agentes: readonly Bot[], pessoaId: string, id: string, destino: Destino, indice: number): string[] {
  // ADR-081: o Nod não entra na ordem de grupo nenhum — a barra o desenha à parte (primeiro dos fixados, ou na barra de cima).
  const grupo = agentes.filter((b) => b.ownerId === pessoaId && b.id !== id && !b.excluidoEm && b.papel !== "nod" && noGrupo(b, destino)).map((b) => b.id);
  grupo.splice(Math.max(0, Math.min(indice, grupo.length)), 0, id);
  return grupo;
}

/** A frota como ela fica depois de soltar: o bot muda de grupo e o grupo inteiro ganha as posições novas. */
export function frotaAoSoltar(agentes: readonly Bot[], id: string, destino: Destino, ordem: readonly string[]): Bot[] {
  const posicao = new Map(ordem.map((x, i) => [x, i]));
  return agentes
    .map((b) => {
      const movido = b.id !== id ? b : destino.grupo === "fixados" ? { ...b, fixado: true } : { ...b, fixado: false, secao: destino.secao };
      return posicao.has(b.id) ? { ...movido, posicao: posicao.get(b.id) ?? null } : movido;
    })
    .sort(compararNaBarra);
}

/**
 * Rolagem automática ao arrastar (definido em 2026-10-06, pedido do Marlon): arrastando para o fim da lista, ela não
 * rolava — a do Chromium só reage a poucos pixels da borda, e a borda de baixo encosta no rodapé do Marketplace. Perto
 * da borda (na faixa), a lista rola na direção dela, mais rápido quanto mais perto; passando da borda (o rodapé, a
 * busca), rola no máximo. Pixels por quadro: negativo sobe, positivo desce.
 */
export const FAIXA_AUTO_ROLAGEM = 56;
export const ROLAGEM_MAX_POR_QUADRO = 16;

export function velocidadeAutoRolagem(y: number, topo: number, base: number, faixa = FAIXA_AUTO_ROLAGEM, max = ROLAGEM_MAX_POR_QUADRO): number {
  if (base - topo <= 0) return 0;
  const f = Math.min(faixa, (base - topo) / 2);
  if (y >= base) return max;
  if (y <= topo) return -max;
  if (y > base - f) return Math.ceil((max * (y - (base - f))) / f);
  if (y < topo + f) return -Math.ceil((max * (topo + f - y)) / f);
  return 0;
}
