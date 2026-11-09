import type { Conn } from "../shared/types.ts";
import { data } from "./conversao.ts";

/**
 * ADR-090: a máquina-alvo do turno `t` (o alias é obrigatório), em ordem — o "desta vez" (ato da pessoa), a máquina do
 * bot, o padrão da pessoa. Cada nível só vale se a chave está viva e é da dona do turno (não revogada, não vencida); um
 * nível que não vale passa a vez ao próximo, e sem nenhum o alvo é nulo: qualquer máquina (com o servidor no Mac, ADR-092,
 * o Mac). A fila nunca prende um turno numa máquina que não pode mais aparecer.
 *
 * Revisto em 2026-10-09 (a tela fala por máquina): a mesma regra serve ao `reivindicar` (turnos.repo.ts) e à lista de
 * trabalhos (trabalhos.repo.ts, `extras`), que diz de qual máquina o trabalho na fila espera. Uma regra só, para a tela
 * nunca dizer uma máquina e a fila entregar a outra.
 *
 * NOD-293 (G11, definido em 2026-10-20): o turno de um trabalho (`t.trabalho_id`) ganha um nível logo abaixo do "desta
 * vez" e acima do bot e do padrão — a máquina em que a sessão do trabalho nasceu (`trabalhos.sessao_maquina_id`, 0079), se
 * a chave ainda vale. A frente segue onde estão a pasta e a sessão dela. O "desta vez" da conversa não chega a ela
 * (`rodarDestaVez` só marca a fala, A6); no turno de um trabalho, `maquina_desta_vez` só vem de um ato da pessoa sobre a
 * própria task ou o próprio turno (NOD-314: "Rodar em <outra> desta vez" do topo da task e do turno preso a uma máquina
 * sem contato), e por isso vence a sessão — senão o botão não tiraria a frente do Mac sem contato, que é onde a sessão
 * está. Sessão numa chave que não vale mais, ou trabalho sem sessão, cai na regra de antes. Quem monta um `t` sem turno
 * de verdade passa `trabalho_id`.
 *
 * NOD-94 (emenda 11 da ADR-090): a máquina só-computador não vale como alvo em nível nenhum (nunca pega turno); um bot que
 * a tivesse escolhida passa ao padrão, e depois a qualquer máquina.
 */
export function alvoDoTurno(sql: Conn, agora: number) {
  const viva = (id: ReturnType<typeof sql>, comoTexto = false) => sql`(select k.id::text from maquina_tokens k where k.tenant_id = t.tenant_id and k.owner_id = t.owner_id
    and ${comoTexto ? sql`k.id::text` : sql`k.id`} = ${id} and k.revogado_em is null and (k.expira_em is null or k.expira_em > ${data(agora)}) and k.papel = 'motor')`;
  // sessao_maquina_id é text (0079): compara pelo texto, sem cast que quebraria num valor fora de uuid.
  return sql`coalesce(${viva(sql`t.maquina_desta_vez`)},
    ${viva(sql`(select w.sessao_maquina_id from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id)`, true)},
    ${viva(sql`(select ag.maquina_id from agentes ag where ag.tenant_id = t.tenant_id and ag.id = t.agente_id)`)},
    ${viva(sql`(select pr.maquina_padrao_id from preferencias pr where pr.tenant_id = t.tenant_id and pr.owner_id = t.owner_id)`)})`;
}
