import { randomUUID } from "node:crypto";
import type { Agente } from "../contracts/agente.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { AutorLote, IdColuna, MudancaTarefa, Quadro, TarefaQuadro } from "../contracts/quadro.ts";
import { FRASE_LINEAR_INDISPONIVEL, type CredencialLinear, type FalhaImportacao, type FiltroImportacao, type FonteLinear, type ImportacaoDto, type IssueLinear, type OpImportarTimeLinear, type PayloadPropostaImportacaoLinear, type PreviaDaTela, type PreviaImportacao } from "../contracts/quadro-importacao.ts";
import { colunasDe } from "../domain/colunas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { colunasDaImportacao, ERRO_IMPORTACAO_PARADA, IMPORTACAO_PARADA_MS, itemDaIssue, LIMITE_IMPORTACAO, numerosDaImportacao, passaNoFiltro, previaDaImportacao } from "../domain/importar-linear.ts";
import { log } from "../obs/log.ts";
import type { ComentarioDoLinear } from "../repositories/quadro-importacoes.repo.ts";
import type { FotoLote } from "../repositories/quadros.repo.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { acharQuadro, agentesDaPessoa, comMembros, eventoQuadro, falhaDoAchado, experimentoLigado, type FalhaQuadro, type PedidoLote } from "./quadro.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { registrarHistoricoComTrilha } from "./trilha-quadro.ts";

/**
 * Trazer um time do Linear para o quadro pelo servidor (definido em 2026-11-02, NOD-422, PR 1; decisões da Ada no
 * comentário 🧭). O caminho: o gerir_quadro (importar_time_linear) abre o card de prévia (proposta e decisão
 * 'importacao_linear', mesmo id); a pessoa confirma (ou, pela tela, o próprio clique é a confirmação) e uma importação
 * 'trazendo' é gravada; depois do commit o servidor busca tudo em segundo plano, com progresso, e aplica num lote só,
 * com Desfazer. Nada escreve no Linear e ninguém é acionado: as tarefas entram sem responsável e sem turno.
 */

export type FalhaDaImportacao = FalhaQuadro | FalhaImportacao;
type Falha = { ok: false; erro: FalhaDaImportacao; detalhe: string };
const falha = (erro: FalhaDaImportacao, detalhe: string): Falha => ({ ok: false, erro, detalhe });

/** O toolkit do Composio (a sessão que o Conectar do Linear grava, ADR-041). */
export const TOOLKIT_LINEAR = "linear";
/** A pergunta da tarefa marcada precisa-humano no Linear (status voce precisa de uma, NOD-420). */
export const PERGUNTA_DO_LINEAR = "Marcada precisa-humano no Linear: veja os comentários e diga como seguir.";

const pedidoDaPessoa = (conversaId: string | null): PedidoLote => ({ autor: { tipo: "pessoa" }, ops: [], executor: "catcher", conversaId });

/** A conta do Linear da pessoa pelo Composio; null = o Linear não está conectado. A chave segue cifrada. */
async function credencial(deps: Deps): Promise<CredencialLinear | null> {
  const chaveCifrada = await deps.repos.composio.chave();
  const sessao = chaveCifrada ? await deps.repos.composio.sessao(TOOLKIT_LINEAR) : null;
  if (!chaveCifrada || !sessao) return null;
  return { chaveCifrada, contaId: sessao.contaId, userId: `nod:${deps.escopo.tenantId}:${deps.escopo.pessoaId}` };
}

/** Quem cuida de cada coluna depois da importação, pelo nome (o que o card mostra). */
function responsaveisDaPrevia(q: Quadro, agentes: readonly Agente[]): Map<IdColuna, string> {
  const colunas = colunasDaImportacao(colunasDe(q), agentes);
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  const m = new Map<IdColuna, string>();
  if ("erro" in colunas) return m;
  for (const c of colunas) if (c.responsavel && nomes.has(c.responsavel)) m.set(c.id, nomes.get(c.responsavel)!);
  return m;
}

export type Preparada = { ok: true; quadro: Quadro; anfitriaoNome: string; time: string; filtro: FiltroImportacao | null; previa: PreviaImportacao };
type Conferida = { ok: true; quadro: Quadro; agentes: Agente[]; cred: CredencialLinear; fonte: FonteLinear };
type PedidoPrevia = { autor: AutorLote; quadro?: string; anfitriaoId?: string; /** ADA-14: o `?quadro=` da tela. */ quadroDoBot?: string | null; turnoId?: string | null; time: string; filtro: FiltroImportacao | null };

/**
 * As recusas antes de qualquer card (as mesmas pela tela e pela conversa), sem falar com o Linear. Uma importação
 * 'trazendo' parada há mais de IMPORTACAO_PARADA_MS (o processo caiu no meio) vira 'falhou' aqui e não bloqueia a nova.
 */
/**
 * NOD-422 (PR 2): a recusa da importação depois que o quadro assumiu a esteira, com o nome do quadro (o do bot anfitrião).
 */
export const jaAssumiuOQuadro = (nome: string): string => `o quadro já assumiu o ${nome}`;
async function nomeDoQuadro(deps: Deps, q: Pick<Quadro, "agenteId">, agentes?: readonly { id: string; nome: string }[]): Promise<string> {
  return agentes?.find((a) => a.id === q.agenteId)?.nome ?? (await deps.repos.agentes.buscar(q.agenteId, true))?.nome ?? "quadro";
}

async function conferirImportacao(deps: Deps, p: PedidoPrevia): Promise<Conferida | Falha> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, { autor: p.autor, ops: [], executor: "catcher", turnoId: p.turnoId ?? null, ...(p.quadro !== undefined ? { quadro: p.quadro } : {}), ...(p.anfitriaoId ? { anfitriaoId: p.anfitriaoId } : {}), ...(p.quadroDoBot ? { quadroDoBot: p.quadroDoBot } : {}) }, agentes);
  if (!achado) return falha("sem_quadro", "não há quadro para receber a importação: crie um antes (criar_quadro)");
  if ("ambiguo" in achado) return falha("entrada_invalida", `a pessoa tem ${achado.ambiguo.length} quadros: passe quadro (o nome do bot anfitrião)`);
  // NOD-430: o nome que não bate com nenhum bot lista os quadros da pessoa (o bot pergunta em qual).
  if ("semNome" in achado) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
  const ri = deps.repos.quadroImportacoes;
  if (await ri.assumido(achado.id)) return falha("entrada_invalida", `${jaAssumiuOQuadro(await nomeDoQuadro(deps, achado, agentes))}: a importação do Linear não roda mais`);
  if (await ri.vencerParadas(achado.id, IMPORTACAO_PARADA_MS, ERRO_IMPORTACAO_PARADA)) log("aviso", "importar_linear_parada_vencida", { quadro_id: achado.id });
  if (await ri.trazendo(achado.id)) return falha("importacao_em_andamento", "já há uma importação trazendo neste quadro");
  const fonte = deps.services.linear;
  if (!fonte) return falha("importacao_indisponivel", "a importação do Linear não está disponível neste servidor");
  const cred = await credencial(deps);
  if (!cred) return falha("sem_conector", "o Linear não está conectado para esta pessoa");
  return { ok: true, quadro: achado, agentes, cred, fonte };
}

/** A porta do Linear lança integracao_autenticacao quando a conta não vale (FonteLinear); o resto é passageiro. */
const recusouOAcesso = (e: unknown): boolean => e instanceof ErroDeDominio && (e.codigo === "integracao_autenticacao" || e.codigo === "integracao_nao_configurada");

/**
 * A busca leve da prévia (estado e etiquetas), SEM Deps: quem chama decide se roda fora da transação (as rotas da tela
 * rodam; revisão do PR #630). Passar do teto de páginas é "demais", nunca uma lista cortada.
 */
export async function buscarPreviaNoLinear(fonte: FonteLinear, cred: CredencialLinear, p: { time: string; filtro: FiltroImportacao | null }): Promise<{ ok: true; issues: IssueLinear[] } | Falha> {
  try {
    return { ok: true, issues: await fonte.listar(cred, { time: p.time, completo: false, filtro: p.filtro }) };
  } catch (e) {
    if (e instanceof ErroDeDominio && e.codigo === "limite_atingido") return falha("demais", `o time ${p.time} tem issues abertas demais para contar${p.filtro ? "" : "; tente sem o Backlog"}`);
    log("aviso", "importar_linear_previa_falhou", { codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
    // Revisão 6 do PR #630: só a recusa de autorização (a conta do Linear revogada ou expirada) é falta de acesso; prazo,
    // 5xx e rede são passageiros e o bot não pede acesso à toa.
    if (recusouOAcesso(e)) return falha("sem_conector", "o Linear recusou o acesso desta conta");
    return falha("linear_indisponivel", FRASE_LINEAR_INDISPONIVEL);
  }
}

/**
 * As recusas e a prévia: a busca leve conta por coluna. Acima de 500 recusa e oferece o filtro sem_backlog (decisão 4).
 * `issues` = a busca já feita fora da transação (as rotas da tela e, pela rota interna, o card da conversa); ausente,
 * busca aqui (quem chama o caso inteiro numa transação só: os testes e o despacho direto do gerir_quadro).
 */
export async function prepararImportacao(deps: Deps, p: PedidoPrevia & { issues?: readonly IssueLinear[] }): Promise<Preparada | Falha> {
  const c = await conferirImportacao(deps, p);
  if (!c.ok) return c;
  const b = p.issues ? { ok: true as const, issues: p.issues } : await buscarPreviaNoLinear(c.fonte, c.cred, p);
  if (!b.ok) return b;
  const issues = b.issues;
  const vem = issues.filter((i) => passaNoFiltro(i, p.filtro));
  if (vem.length === 0) return falha("entrada_invalida", `o time ${p.time} não tem issues abertas${p.filtro ? " fora do Backlog" : ""} no Linear`);
  if (vem.length > LIMITE_IMPORTACAO) return falha("demais", `o time ${p.time} tem ${vem.length} issues abertas (o teto é ${LIMITE_IMPORTACAO})${p.filtro ? "" : "; sem o Backlog seriam " + issues.filter((i) => passaNoFiltro(i, "sem_backlog")).length}`);
  const achado = c.quadro;
  const anfitriaoNome = c.agentes.find((a) => a.id === achado.agenteId)?.nome ?? (await deps.repos.agentes.buscar(achado.agenteId, true))?.nome ?? "quadro";
  return { ok: true, quadro: achado, anfitriaoNome, time: p.time, filtro: p.filtro, previa: previaDaImportacao(vem, responsaveisDaPrevia(achado, c.agentes)) };
}

/** O time e o filtro como a tela os manda (o mesmo critério do lerOp). */
function timeEFiltro(input: { time: string; filtro: string | null }): { time: string; filtro: FiltroImportacao | null } {
  const time = input.time.trim();
  if (!/^[A-Za-z][A-Za-z0-9]{0,9}$/.test(time)) throw new ErroDeDominio("entrada_invalida", { cause: "time" });
  if (input.filtro !== null && input.filtro !== "sem_backlog") throw new ErroDeDominio("entrada_invalida", { cause: "filtro" });
  return { time: time.toUpperCase(), filtro: input.filtro };
}

/**
 * Fase 1 das rotas da tela (revisão do PR #630, o padrão de duas fases de rotas/decisoes.ts): as recusas numa transação
 * curta e a credencial para a rota buscar no Linear FORA da transação. A fase 2 é previaDaTela ou o Trazer com `issues`.
 */
export const conferirPreviaDaTela: CasoDeUso<{ agenteId: string; quadro?: string | null; time: string; filtro: string | null }, { ok: true; time: string; filtro: FiltroImportacao | null; quadroId: string; cred: CredencialLinear } | Falha> = async (deps, input) => {
  const { time, filtro } = timeEFiltro(input);
  const c = await conferirImportacao(deps, { autor: { tipo: "pessoa" }, anfitriaoId: input.agenteId, quadroDoBot: input.quadro ?? null, time, filtro });
  if (!c.ok) return { data: c };
  return { data: { ok: true, time, filtro, quadroId: c.quadro.id, cred: c.cred } };
};

/**
 * A prévia pela tela (GET): só lê. A recusa volta como dado (a tela mostra a frase: "Conecte o Linear", "passa de 500,
 * tente sem o Backlog"); o detalhe é nosso, sem texto do Linear. `issues` = a busca da fase 1 (fora da transação).
 */
export const previaDaTela: CasoDeUso<{ agenteId: string; quadro?: string | null; time: string; filtro: string | null; issues?: readonly IssueLinear[] }, PreviaDaTela> = async (deps, input) => {
  const { time, filtro } = timeEFiltro(input);
  const prep = await prepararImportacao(deps, { autor: { tipo: "pessoa" }, anfitriaoId: input.agenteId, quadroDoBot: input.quadro ?? null, time, filtro, ...(input.issues ? { issues: input.issues } : {}) });
  if (!prep.ok) return { data: prep };
  return { data: { ok: true, time: prep.time, filtro: prep.filtro, anfitriaoNome: prep.anfitriaoNome, previa: prep.previa } };
};

/** O que a rota interna leva para buscar a prévia FORA da transação (revisão do PR #630, item 6). */
export type BuscaDaPrevia = { cred: CredencialLinear; time: string; filtro: FiltroImportacao | null };

/**
 * Fase 1 do card pela conversa (revisão do PR #630, item 6; o padrão NOD-263 do chamar-ferramenta): as recusas na
 * transação curta e a credencial para a rota interna buscar no Linear fora dela. A fase 2 é proporImportacaoLinear com `issues`.
 */
export async function conferirImportacaoDoBot(deps: Deps, p: { autor: AutorLote; quadro?: string; op: OpImportarTimeLinear; turnoId: string }): Promise<({ ok: true } & BuscaDaPrevia) | Falha> {
  const filtro = p.op.filtro ?? null;
  const c = await conferirImportacao(deps, { autor: p.autor, ...(p.quadro !== undefined ? { quadro: p.quadro } : {}), turnoId: p.turnoId, time: p.op.time, filtro });
  if (!c.ok) return c;
  return { ok: true, cred: c.cred, time: p.op.time, filtro };
}

export type PropostaDeImportacao = { ok: true; propostaId: string; payload: PayloadPropostaImportacaoLinear } | Falha;

/** O bot pediu importar_time_linear na conversa: abre o card de prévia. Nada muda até a pessoa confirmar. */
export async function proporImportacaoLinear(deps: Deps, p: { autor: AutorLote; quadro?: string; op: OpImportarTimeLinear; agenteId: string; conversaId: string; turnoId: string; issues?: readonly IssueLinear[] }): Promise<{ data: PropostaDeImportacao; events: RuntimeEvent[] }> {
  const prep = await prepararImportacao(deps, { autor: p.autor, ...(p.quadro !== undefined ? { quadro: p.quadro } : {}), turnoId: p.turnoId, time: p.op.time, filtro: p.op.filtro ?? null, ...(p.issues ? { issues: p.issues } : {}) });
  if (!prep.ok) return { data: prep, events: [] };
  const payload: PayloadPropostaImportacaoLinear = {
    kind: "importacao_linear", quadroId: prep.quadro.id, anfitriaoId: prep.quadro.agenteId, anfitriaoNome: prep.anfitriaoNome,
    time: prep.time, filtro: prep.filtro, previa: prep.previa, turnoId: p.turnoId, importacaoId: null,
  };
  const proposta = await deps.repos.propostas.criar({ conversaId: p.conversaId, agenteId: p.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const agora = deps.agora();
  const frase = `Trazer ${prep.previa.total} ${prep.previa.total === 1 ? "tarefa" : "tarefas"} do Linear (${prep.time}) para o quadro de ${prep.anfitriaoNome}`;
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "importacao_linear", agenteId: p.agenteId, conversaId: p.conversaId, turnoId: p.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: frase.slice(0, 500) });
  const autoria = autoriaDoAgente(deps.escopo, p.agenteId);
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { proposta_id: proposta.id, kind: "importacao_linear" } })];
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { decisao_id: decisao.id, tipo: "importacao_linear" } }));
  return { data: { ok: true, propostaId: proposta.id, payload }, events };
}

/**
 * Grava a importação 'trazendo' (a confirmação: o card ou o clique da tela) e agenda a busca para depois do commit. O
 * índice parcial deixa uma só por quadro: o segundo Confirmar (outra aba) recebe importacao_em_andamento.
 */
export async function iniciarImportacao(deps: Deps, p: { id?: string; quadro: Quadro; time: string; filtro: FiltroImportacao | null; total: number; conversaId: string | null }): Promise<{ data: { ok: true; importacao: ImportacaoDto } | Falha; events: RuntimeEvent[] }> {
  const ri = deps.repos.quadroImportacoes;
  if (await ri.assumido(p.quadro.id)) return { data: falha("entrada_invalida", jaAssumiuOQuadro(await nomeDoQuadro(deps, p.quadro))), events: [] };
  await ri.vencerParadas(p.quadro.id, IMPORTACAO_PARADA_MS, ERRO_IMPORTACAO_PARADA);
  const i = await ri.criar({ id: p.id ?? randomUUID(), quadroId: p.quadro.id, time: p.time, filtro: p.filtro, total: p.total, conversaId: p.conversaId });
  if (!i) return { data: falha("importacao_em_andamento", "já há uma importação trazendo neste quadro"), events: [] };
  deps.aposCommit?.({ tipo: "importar_linear", importacaoId: i.id });
  log("info", "importar_linear_iniciada", { importacao_id: i.id, total: p.total });
  const { conversaId: _c, ...dto } = i;
  return { data: { ok: true, importacao: dto }, events: await comMembros(deps, [eventoQuadro(deps, pedidoDaPessoa(null), p.quadro, null, [])]) };
}

/** O card decidido (POST decisoes/:id/decidir). Recusar fecha sem mudar nada; confirmar inicia a importação. */
export const decidirImportacaoLinear: CasoDeUso<{ decisaoId: string; recusar: boolean }, { iniciada: boolean; importacaoId: string | null; obsoleta?: true }> = async (deps, input) => {
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.decisaoId);
  if (!proposta || proposta.payload.kind !== "importacao_linear") throw new ErroDeDominio("nao_encontrado", { cause: "importação do Linear" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const payload = proposta.payload;
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  let importacaoId: string | null = null;
  let texto = `Importação do Linear (${payload.time}) cancelada: nada mudou no quadro de ${payload.anfitriaoNome}.`;
  let obsoleta = false;
  if (!input.recusar) {
    const q = await deps.repos.quadros.buscarTravado(payload.quadroId);
    const r = q ? await iniciarImportacao(deps, { id: proposta.id, quadro: q, time: payload.time, filtro: payload.filtro, total: payload.previa.total, conversaId: proposta.conversaId }) : null;
    if (r?.data.ok) {
      events.push(...r.events);
      importacaoId = r.data.importacao.id;
      texto = `Trazendo ${payload.previa.total} ${payload.previa.total === 1 ? "tarefa" : "tarefas"} do Linear (${payload.time}) para o quadro de ${payload.anfitriaoNome}. O progresso aparece no quadro; ninguém é acionado.`;
    } else {
      obsoleta = true;
      texto = !q ? "O quadro foi removido depois desta proposta: nada foi importado." : `Nada foi importado: ${r && !r.data.ok ? r.data.detalhe : "o quadro mudou"}.`;
    }
  }
  const decidida = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
  await deps.repos.propostas.atualizarPayload(proposta.id, { ...payload, importacaoId });
  await deps.repos.propostas.decidir(proposta.id, importacaoId ? "confirmada" : "recusada");
  await recibo(deps, proposta.conversaId, texto, events);
  events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: decidida.turnoId, dados: { decisao_id: decidida.id, tipo: "importacao_linear", recusada: importacaoId === null } }));
  return { data: { iniciada: importacaoId !== null, importacaoId, ...(obsoleta ? { obsoleta: true as const } : {}) }, events };
};

async function recibo(deps: Deps, conversaId: string | null, texto: string, events: RuntimeEvent[]): Promise<void> {
  if (!conversaId) return;
  const autoria = autoriaPessoa(deps.escopo);
  const msg = await deps.repos.mensagens.criar({ conversaId, autoria, kind: "sistema", assunto: "aprovacao.recibo", texto, confianca: "confiavel" });
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
}

/** Roda `fn` numa transação escopada da dona e grava os eventos que ela devolve (o `dentro` da composição). */
export type RodarNaTx = <T>(fn: (deps: Deps) => Promise<{ data: T; events?: RuntimeEvent[] }>) => Promise<T>;

/**
 * A busca em segundo plano (o efeito pós-commit 'importar_linear'). Uma transação curta para ler, a busca FORA de
 * transação (o progresso, a cada página, em transações próprias) e a aplicação numa só. Falhar no meio não muda nada no
 * quadro: a importação fica 'falhou' com a frase ("Parei em 120 de 190: o Linear não respondeu").
 */
export async function trazerImportacao(rodar: RodarNaTx, importacaoId: string): Promise<"aplicada" | "falhou" | "ignorada"> {
  const ini = await rodar(async (d) => {
    const i = await d.repos.quadroImportacoes.buscar(importacaoId);
    return { data: i && i.estado === "trazendo" ? { i, cred: await credencial(d), fonte: d.services.linear } : null };
  });
  if (!ini) return "ignorada";
  const { i, cred, fonte } = ini;
  const falhar = async (erro: string) => {
    await rodar(async (d) => {
      const mudou = await d.repos.quadroImportacoes.falhar(i.id, erro);
      const q = mudou ? await d.repos.quadros.buscar(i.quadroId) : null;
      return { data: null, events: q ? await comMembros(d, [eventoQuadro(d, pedidoDaPessoa(null), q, null, [])]) : [] };
    });
    return "falhou" as const;
  };
  if (!fonte || !cred) return falhar("O Linear não está conectado: nada mudou no quadro.");
  let trazidas = 0;
  let todas: IssueLinear[];
  const descartadas: (string | null)[] = [];
  try {
    todas = await fonte.listar(cred, {
      time: i.time,
      completo: true,
      filtro: i.filtro,
      aoDescartar: (identificador) => { descartadas.push(identificador); },
      aoAvancar: async (n) => {
        trazidas = n;
        await rodar(async (d) => {
          const ok = await d.repos.quadroImportacoes.progresso(i.id, { trazidas: n, total: i.total });
          const q = ok ? await d.repos.quadros.buscar(i.quadroId) : null;
          return { data: null, events: q ? await comMembros(d, [eventoQuadro(d, pedidoDaPessoa(null), q, null, [])]) : [] };
        });
      },
    });
  } catch (e) {
    // Revisão 9: o total é o da prévia (pode estar no cache); o time que cresceu depois não dá "Parei em 25 de 7".
    const total = Math.max(i.total, trazidas);
    log("aviso", "importar_linear_busca_falhou", { importacao_id: i.id, trazidas, codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
    // A lista incompleta nunca é aplicada (nem fecha nada): o time passou do teto de páginas durante a busca.
    if (e instanceof ErroDeDominio && e.codigo === "limite_atingido") return falhar(`Parei em ${trazidas}: o time passou de ${LIMITE_IMPORTACAO} issues abertas. Nada mudou no quadro.${i.filtro ? "" : " Tente sem o Backlog."}`);
    if (recusouOAcesso(e)) return falhar(`Parei em ${trazidas} de ${total}: o Linear recusou o acesso (reconecte o Linear em Conectores). Nada mudou no quadro.`);
    return falhar(`Parei em ${trazidas} de ${total}: o Linear não respondeu. Nada mudou no quadro; tente de novo em instantes.`);
  }
  try {
    return await rodar((d) => aplicarImportacao(d, i.id, todas, { descartadas }));
  } catch (e) {
    log("erro", "importar_linear_aplicar_falhou", { importacao_id: i.id, codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
    return falhar("Não consegui aplicar a importação: nada mudou no quadro.");
  }
}

const iguais = (a: TarefaQuadro, b: Pick<TarefaQuadro, "titulo" | "descricao" | "status" | "voltarPara" | "prUrl" | "linearUrl" | "pergunta">) =>
  a.titulo === b.titulo && a.descricao === b.descricao && a.status === b.status && a.voltarPara === b.voltarPara && a.prUrl === b.prUrl && a.linearUrl === b.linearUrl && a.pergunta === b.pergunta;

/**
 * Aplica as issues trazidas num lote só (o Desfazer volta tudo). As colunas viram as da tabela; cada issue aberta vira
 * (ou atualiza, na reimportação) uma tarefa sem responsável, com o mesmo número quando livre. Revisão do PR #630: a
 * reimportação não passa por cima do que a pessoa (ou um bot) mexeu no quadro depois da última importação nem de tarefa
 * com turno vivo: essas só ganham a linha "Linear · em X" no histórico. A importada que saiu das abertas do time também
 * só ganha a linha "fechada no Linear" (a spec: não muda de coluna), e só quando a busca trouxe o time inteiro (sem filtro).
 * Revisão 3: `descartadas` são as issues que vieram da busca mas não se leram (malformadas): continuam abertas no Linear.
 * Com o identificador, não contam como fechadas; sem ele (não dá para saber qual era), nenhuma é marcada como fechada.
 */
export async function aplicarImportacao(deps: Deps, importacaoId: string, todas: readonly IssueLinear[], o: { descartadas?: readonly (string | null)[] } = {}): Promise<{ data: "aplicada" | "falhou" | "ignorada"; events?: RuntimeEvent[] }> {
  const ri = deps.repos.quadroImportacoes;
  const repo = deps.repos.quadros;
  const imp = await ri.buscar(importacaoId);
  if (!imp || imp.estado !== "trazendo") return { data: "ignorada" };
  const q0 = await repo.buscarTravado(imp.quadroId);
  const nao = async (erro: string) => { await ri.falhar(imp.id, erro); return { data: "falhou" as const, ...(q0 ? { events: await comMembros(deps, [eventoQuadro(deps, pedidoDaPessoa(null), q0, null, [])]) } : {}) }; };
  if (!q0) return nao("O quadro foi removido: nada foi importado.");
  if (await ri.assumido(q0.id)) return nao(`${jaAssumiuOQuadro(await nomeDoQuadro(deps, q0))}: nada foi importado.`.replace(/^o/, "O"));
  // Revisão 3 do PR #630: a busca leva minutos; se a pessoa desligou o quadro nos experimentos nesse meio-tempo, nada entra.
  if (!(await experimentoLigado(deps))) return nao("O quadro foi desligado nos experimentos: nada foi importado.");
  const agentes = await agentesDaPessoa(deps);
  const colunas = colunasDaImportacao(colunasDe(q0), agentes);
  if ("erro" in colunas) return nao(`As colunas do Linear não cabem neste quadro (${colunas.erro}): nada mudou.`);
  const issues = todas.filter((x) => passaNoFiltro(x, imp.filtro));
  if (issues.length > LIMITE_IMPORTACAO) return nao(`O time passou de ${LIMITE_IMPORTACAO} issues abertas: nada mudou. Use o filtro sem o Backlog.`);
  const atuais = await repo.tarefas(q0.id);
  // Revisão 8 do PR #630: a importada que a pessoa moveu daqui para outro quadro (mover_quadro) segue lá, com o mesmo
  // linear_id; a reimportação não a recria aqui (seria duplicata) nem a atualiza lá: só conta no recibo como "em outro
  // quadro". O mesmo time importado em outro quadro (sem ter saído deste) não conta: cada quadro tem a sua cópia. A
  // excluída sai de vez (delete; só o Desfazer do último lote a devolve): reimportar a recria, e o Desfazer da
  // reimportação apaga a recriada antes de o lote da exclusão voltar a ser o último, então as duas nunca convivem.
  const daqui = new Set(atuais.filter((t) => t.linearId !== null).map((t) => t.linearId!.trim().toUpperCase()));
  const emOutro = await repo.linearIdsQueSairam(q0.id, issues.map((x) => x.identificador).filter((id) => !daqui.has(id.trim().toUpperCase())));
  const itens = issues.filter((x) => !emOutro.has(x.identificador.trim().toUpperCase())).map(itemDaIssue);
  const noutroQuadro = issues.length - itens.length;
  let preservadas = 0;
  const chave = (s: string) => s.trim().toUpperCase();

  // O prefixo: o do time (o NOD-422 do Linear continua NOD-422) quando o quadro só tem tarefas do Linear e nenhum outro
  // quadro usa a chave; senão fica o do quadro e o código do Linear também é guardado para o link achar a tarefa.
  // Revisão 10: "só do Linear" = cada tarefa atual já tem o número da issue dela, do mesmo time. As do importar_linear
  // antigo (numeradas em sequência pelo quadro) têm linear_id mas outro número: com a troca, o "NOD-1" mostrado não abriria
  // a própria tarefa (ou abriria outra). Com uma delas no quadro, o prefixo fica.
  let q: Quadro = q0;
  const chaveValida = /^[A-Z]{1,3}[0-9]*$/.test(imp.time);
  const outros = (await repo.listar()).filter((o) => o.id !== q0.id);
  const deOutro = outros.some((o) => o.prefixo === imp.time);
  const comONumeroDoTime = (t: TarefaQuadro) => t.linearId !== null && t.numero !== null && chave(t.linearId) === `${imp.time}-${t.numero}`;
  if (chaveValida && q.prefixo !== imp.time && !deOutro && atuais.every(comONumeroDoTime)) {
    await repo.travarPrefixos();
    if (!(await repo.prefixosUsados()).has(imp.time)) {
      await ri.trocarPrefixo(q.id, imp.time);
      q = { ...q, prefixo: imp.time };
    }
  }
  // Revisão 8 do PR #630: o código do time é guardado também depois da troca de prefixo, quando a importada não fica com o
  // próprio número (o NOD-451 do Linear que colidiu com a nativa NOD-451 criada depois). Com o prefixo igual ao do time esse
  // número já tem dono (por isso a importada ganhou outro) e o on conflict o deixa com a nativa: o link do código puro
  // pergunta qual (as duas, a importada marcada "do Linear"); a URL da issue, que só pode ser do Linear, abre a importada
  // (tarefasDoCodigo, no quadro.ts).
  const guardarDoTime = chaveValida && !deOutro;

  const porLinear = new Map(atuais.filter((t) => t.linearId !== null).map((t) => [chave(t.linearId!), t]));
  // Mexida aqui = mudou depois da última vez que uma importação a escreveu (a trava do quadro serializa a importação com os
  // lotes, então o mudado_em de quem mexeu depois é maior). Fica mexida até a pessoa a devolver ao Linear: a reimportação
  // que só registra a linha não a reescreve. Nunca escrita por uma importação (a do importar_linear antigo): mexida.
  const escritas = await ri.escritasPelaImportacao(q0.id);
  const estadosTurno = await repo.estadosDosTurnos(atuais.map((t) => t.turnoId).filter((id): id is string => id !== null));
  const turnoVivo = (t: TarefaQuadro) => t.turnoId !== null && ["pendente", "despachando"].includes(estadosTurno.get(t.turnoId) ?? "");
  const preservar = (t: TarefaQuadro) => {
    const base = escritas.get(t.id);
    return base === undefined || t.mudadoEm > base || turnoVivo(t);
  };
  const ultimaLinha = await ri.ultimasLinhas(q0.id);
  // Os números que um código guardado já usa com o prefixo (a tarefa excluída, a que saiu do quadro) ficam ocupados: o
  // código novo não seria guardado (on conflict) e o link abriria a tarefa antiga (revisão do PR #630).
  const reservados = q.prefixo ? await repo.numerosReservados(q.prefixo) : [];
  const { numeros, proximo } = numerosDaImportacao(itens, atuais.map((t) => ({ numero: t.numero, linearId: t.linearId })), await ri.proximo(q.id), reservados);
  const foto: FotoLote["tarefas"] = [];
  const historico: MudancaTarefa[] = [];
  const linhas: { tarefaId: string; de: string | null; para: string | null; em: number }[] = [];
  const comentarios: ComentarioDoLinear[] = [];
  const codigos: { prefixo: string; numero: number; tarefaId: string }[] = [];
  // Os do time nas tarefas que já existiam: o Desfazer os apaga (os das criadas vão com elas). Revisão 3 do PR #630.
  const codigosDoTime: typeof codigos = [];
  const regra = { tipo: "regra" } as const;
  const agora = deps.agora();
  for (const it of itens) {
    const numero = numeros.get(it.identificador)!;
    const pergunta = it.status === "voce" ? PERGUNTA_DO_LINEAR : null;
    const existente = porLinear.get(chave(it.identificador));
    // Revisão 5 do PR #630: sem PR no Linear, fica o pr_url que a tarefa já tem (o laço do NOD-421 o liga sem mexer no
    // mudado_em; a reimportação não o apaga nem conta a tarefa como mudada só por isso).
    const prUrl = it.prUrl ?? existente?.prUrl ?? null;
    const campos = { titulo: it.titulo, descricao: it.descricao, status: it.status, voltarPara: it.voltarPara, prUrl, linearUrl: it.url, pergunta };
    let tarefaId: string;
    if (existente) {
      tarefaId = existente.id;
      porLinear.delete(chave(it.identificador));
      if (iguais(existente, campos)) {
        // nada mudou no Linear nem aqui
      } else if (preservar(existente)) {
        // A pessoa (ou o turno vivo) manda na tarefa: o Linear só fica registrado no histórico, uma vez por estado.
        if (ultimaLinha.get(tarefaId) !== it.estadoLinear) linhas.push({ tarefaId, de: null, para: it.estadoLinear, em: it.noEstadoDesde });
        preservadas++;
      } else {
        const mudaColuna = existente.status !== it.status;
        await repo.salvarTarefa(existente.id, {
          ...existente, ...campos,
          pergunta: it.status === "voce" ? existente.pergunta ?? pergunta : null, resposta: it.status === "voce" ? existente.resposta : null,
          deFora: true, terminadaEm: null, turnoId: mudaColuna ? null : existente.turnoId,
        });
        foto.push({ id: existente.id, antes: existente });
        if (existente.status !== it.status) {
          historico.push({ tarefaId, campo: "status", de: existente.status, para: it.status, autor: regra });
          linhas.push({ tarefaId, de: null, para: it.estadoLinear, em: it.noEstadoDesde });
        }
      }
    } else {
      const nova = await repo.inserirTarefa({ quadroId: q.id, ...campos, agenteId: null, linearId: it.identificador, deFora: true, terminadaEm: null, numero });
      tarefaId = nova.id;
      foto.push({ id: nova.id, antes: null });
      historico.push({ tarefaId, campo: "criada", de: null, para: it.status, autor: regra });
      linhas.push({ tarefaId, de: null, para: it.estadoLinear, em: it.noEstadoDesde });
      if (q.prefixo) codigos.push({ prefixo: q.prefixo, numero, tarefaId });
    }
    const mesmoCodigo = q.prefixo === imp.time && (existente?.numero ?? numero) === it.numero;
    if (guardarDoTime && !mesmoCodigo && it.numero > 0 && chave(it.identificador).startsWith(`${imp.time}-`)) (existente ? codigosDoTime : codigos).push({ prefixo: imp.time, numero: it.numero, tarefaId });
    for (const c of it.comentarios) comentarios.push({ quadroId: q.id, tarefaId, linearId: c.id, autorNome: c.autor, texto: c.texto, criadoEm: c.criadoEm });
  }
  // A importada que saiu das abertas do time foi fechada (ou sumiu) no Linear: só a linha no histórico, sem mudar de
  // coluna. Com o filtro sem_backlog a busca não traz o Backlog, então não dá para saber quem fechou: nada é marcado.
  const descartadas = o.descartadas ?? [];
  const abertas = new Set([...todas.map((x) => chave(x.identificador)), ...descartadas.filter((x): x is string => !!x).map(chave)]);
  let fechadas = 0;
  if (imp.filtro === null && !descartadas.includes(null)) {
    for (const [id, t] of porLinear) {
      if (!id.startsWith(`${imp.time}-`) || abertas.has(id) || ultimaLinha.get(t.id) === null) continue;
      linhas.push({ tarefaId: t.id, de: null, para: null, em: agora });
      fechadas++;
    }
  }
  await ri.subirProximo(q.id, proximo);
  await repo.guardarCodigos(codigos);
  const guardadosDoTime = await repo.guardarCodigos(codigosDoTime);
  const mudouColunas = JSON.stringify(colunas) !== JSON.stringify(colunasDe(q0));
  if (mudouColunas) await repo.salvar(q.id, { meta: q.meta, prazo: q.prazo, cumpridoEm: q.cumpridoEm, resumo: q.resumo, metaDesde: q.metaDesde, colunas });
  const n = itens.length;
  const emOutroQuadro = noutroQuadro ? ` · ${noutroQuadro} ${noutroQuadro === 1 ? "já está" : "já estão"} em outro quadro e ${noutroQuadro === 1 ? "ficou" : "ficaram"} lá` : "";
  const resumo = `Trouxe ${n} ${n === 1 ? "tarefa" : "tarefas"} do Linear (${imp.time})${fechadas ? ` · ${fechadas} ${fechadas === 1 ? "fechada" : "fechadas"} no Linear` : ""}${preservadas ? ` · ${preservadas} ${preservadas === 1 ? "mexida" : "mexidas"} aqui ficaram como estavam` : ""}${noutroQuadro ? ` · ${noutroQuadro} em outro quadro` : ""}`;
  const trocouPrefixo = q.prefixo !== q0.prefixo;
  const precisaLote = foto.length > 0 || mudouColunas || comentarios.length > 0 || linhas.length > 0 || trocouPrefixo;
  const lote = precisaLote
    ? await repo.inserirLote({ quadroId: q.id, autor: { tipo: "pessoa" }, resumo, antes: { quadro: { meta: q0.meta, prazo: q0.prazo, cumpridoEm: q0.cumpridoEm, resumo: q0.resumo, metaDesde: q0.metaDesde, colunas: q0.colunas, ...(trocouPrefixo ? { prefixo: q0.prefixo } : {}) }, tarefas: foto, ...(guardadosDoTime.length ? { codigos: guardadosDoTime } : {}) }, tarefaIds: foto.map((t) => t.id) })
    : null;
  if (lote) {
    await registrarHistoricoComTrilha(deps, q.id, historico, lote.id);
    await ri.registrarLinhas(q.id, linhas, lote.id);
    await ri.inserirComentarios(comentarios, lote.id);
  }
  const emColunas = new Set(itens.map((x) => x.status)).size;
  // Outra transação marcou a importação (parada vencida, outra aba): lança para a transação inteira voltar.
  if (!(await ri.aplicar(imp.id, { loteId: lote?.id ?? null, trazidas: n, colunas: emColunas }))) throw new ErroDeDominio("estado_invalido", { cause: "a importação já não estava trazendo" });
  const events: RuntimeEvent[] = [eventoQuadro(deps, pedidoDaPessoa(imp.conversaId), q, lote?.id ?? null, foto.map((t) => t.id))];
  await recibo(deps, imp.conversaId, `Trouxe ${n} ${n === 1 ? "tarefa" : "tarefas"} do Linear (${imp.time}) para ${emColunas} ${emColunas === 1 ? "coluna" : "colunas"}${emOutroQuadro} · ninguém foi acionado.${lote ? " Desfazer está no quadro." : ""}`, events);
  log("info", "importar_linear_aplicada", { importacao_id: imp.id, tarefas: n, fechadas, preservadas, em_outro_quadro: noutroQuadro, colunas: emColunas });
  return { data: "aplicada", events: await comMembros(deps, events) };
}
