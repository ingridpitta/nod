import { TIPOS_DISPENSAVEIS_ABERTOS, type Decisao, type TipoDecisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ajudaDoComputador } from "./ajuda-do-computador.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { avisarFalhaDelegacao } from "./entregar-resposta-peer.ts";
import { fecharGemeas } from "./fechar-gemeas.ts";
import type { DepsSuaVez } from "./listar-sua-vez.ts";
import type { CasoDeUso } from "./tipos.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";

/**
 * Abertas que saem pelo × / "Dispensar" (TIPOS_DISPENSAVEIS_ABERTOS): as que se respondem com texto
 * — dispensar NÃO é responder (EMENDA 16 intacta: a resposta de pedir_a_pessoa continua sendo texto)
 * — e, definido em 2026-09-24 (ADR-045), o "Retomar" de uma conversa que o Mac interrompeu: a pessoa
 * pode preferir não retomar, e o card não tinha outra saída além de vencer.
 */
const DISPENSAVEIS_ABERTAS: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(TIPOS_DISPENSAVEIS_ABERTOS);

export function podeDispensar(d: Pick<Decisao, "estado" | "tipo">): boolean {
  if (d.estado === "vencida") return true;
  return (d.estado === "pendente" || d.estado === "reaberta") && DISPENSAVEIS_ABERTAS.has(d.tipo);
}

/**
 * FASE 1 — quem clicou (dona ou decisora designada). × no card (definido em 2026-09-24): a conversa
 * da Nina acumulou cartões "falta um dado" vencidos de rotinas que rodaram sem Gmail, e o único botão
 * era "Reabrir" — a pessoa não tinha como tirar da tela o que já não importava. Dispensar fecha como
 * 'decidida' com desfecho 'dispensada', sem retomar turno. Se a decisão nasceu com uma proposta de
 * mesmo id (acesso, mudança de rotina) e ela ainda está pendente, a proposta é recusada junto: senão
 * o card da proposta voltaria à conversa com botões que dariam estado_invalido. Quando quem dispensa
 * é a DONA (o caso comum), a fase 2 roda aqui mesmo, na mesma transação; senão a rota a roda como a
 * dona (ADR-007: o que exige owner = pessoa roda na transação dela).
 */
export async function dispensarDecisao(deps: DepsSuaVez, input: { decisaoId: string }): Promise<{ data: { decisao: Decisao }; events: RuntimeEvent[] }> {
  const atual = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  if (!podeDispensar(atual)) throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.tipo} ${atual.estado} não se dispensa` });
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.dispensar(atual.id, { por: deps.escopo.pessoaId, agora, antes: atual.estado });
  if (!decisao) throw new ErroDeDominio("nao_permitido", { cause: "nem dona nem decisora" });
  const proposta = await deps.repos.propostas.buscar(atual.id);
  if (proposta && proposta.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "recusada");
  const events = [evento(deps.escopo, { kind: "decisao_decidida", autoria: autoriaPessoa(deps.escopo), agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, dispensada: true } })];
  if (decisao.ownerId === deps.escopo.pessoaId) events.push(...(await depoisDeDispensar(deps, { decisao })).events);
  return { data: { decisao }, events };
}

export type SaidaDepoisDeDispensar = { gemeas: string[]; rotinaId: string | null; computadorDevolvido: boolean };

/**
 * FASE 2 — pela DONA (definido em 2026-09-24): o que dispensar muda fora da própria decisão.
 * 1. As gêmeas abertas do grupo "×N" fecham por regra:gemea_resolvida (fechar-gemeas.ts).
 * 2. Pedido ainda ABERTO de uma execução de rotina: a janela fica 'passou_em_branco', motivo
 *    'pedido_dispensado' — a execução não entregou e ninguém vai responder (uma linha por janela,
 *    ADR-045). Vencido não: o gate vencido já tem a causa verdadeira (ninguem_respondeu_o_gate, do
 *    varredor) e "Limpar vencidos" escreveria uma linha na conversa por item limpo.
 * 3. Pedido de ajuda do computador do bot (computador_pedir_ajuda guarda o id): o bot recupera o
 *    computador — senão toda ação dele responderia "a pessoa está com o computador" para sempre.
 */
export async function depoisDeDispensar(deps: DepsSuaVez, input: { decisao: Decisao }): Promise<{ data: SaidaDepoisDeDispensar; events: RuntimeEvent[] }> {
  const d = input.decisao;
  const gemeas = await fecharGemeas(deps, d);
  const events = [...gemeas.events];
  let rotinaId: string | null = null;
  const antes = d.desfecho?.tipo === "dispensada" ? d.desfecho.antes : null;
  if (d.turnoId && (antes === "pendente" || antes === "reaberta")) {
    const r = await registrarDesfechoRotina(deps, { turnoId: d.turnoId, desfecho: "passou_em_branco", motivo: "pedido_dispensado" });
    if ("execucao" in r.data) {
      rotinaId = r.data.rotina.id;
      events.push(...(r.events ?? []));
    } else {
      // definido em 2026-10-15 (NOD-257, H3): a pergunta dispensada de um pedido de colega — quem pediu é avisado (uma
      // vez; espera outro colega pendente na cadeia). Fora de delegação, avisarFalhaDelegacao não faz nada.
      events.push(...((await avisarFalhaDelegacao(deps, { turnoId: d.turnoId, motivo: "a pessoa deixou a pergunta sem resposta" })).events ?? []));
    }
  }
  const computadorDevolvido = await devolverComputador(deps, d);
  // Revisão do épico (S2, 2026-10-08): dispensada, a decisão não segura mais a task do turno dela.
  events.push(...(await sincronizarDasDecisoes(deps, [d])));
  return { data: { gemeas: gemeas.data.fechadas, rotinaId, computadorDevolvido }, events };
}

/**
 * Só a 'pergunta' que o próprio computador guardou em ajuda_decisao_id. Aguardando a pessoa → volta
 * ao bot, com a ação registrada como a "Devolver ao bot" da tela. Takeover em curso (controle
 * 'pessoa') só termina por devolução explícita (ADR-037): aí sai só o vínculo com o pedido.
 */
async function devolverComputador(deps: DepsSuaVez, d: Decisao): Promise<boolean> {
  if (d.tipo !== "pergunta") return false;
  // NOD-96: no computador da pessoa o pedido de ajuda é da tela do bot (ajudaDoComputador).
  const c = await ajudaDoComputador(deps.repos, d.agenteId);
  if (!c || c.ajudaDecisaoId !== d.id) return false;
  const devolver = c.controle === "aguardando_pessoa";
  await c.configurar(devolver ? { controle: "bot", ajuda: null, ajudaDecisaoId: null, atividadeEm: deps.agora() } : { ajuda: null, ajudaDecisaoId: null });
  if (devolver) await c.registrarDevolver();
  return devolver;
}

export const dispensarDecisaoComoCaso: CasoDeUso<{ decisaoId: string }, { decisao: Decisao }> = dispensarDecisao;
