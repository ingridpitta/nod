import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import { labelsDaTarefa } from "../domain/quadro-labels.ts";
import type { OpQuadro, Quadro, TarefaQuadro } from "../contracts/quadro.ts";
import { type DesfechoExecucao, type ExecucaoDto, type TrabalhoParaBot, type ExecucaoQuadro, type ExecucoesDaTarefa, INTERVALO_NOVA_TENTATIVA_MS, type RecadoQuadro } from "../contracts/quadro-execucoes.ts";
import type { Profundidade, Turno } from "../contracts/turno.ts";
import { acionaNaColuna, colunaDeAndamento, colunaDeEspera, colunasDe, papelDe } from "../domain/colunas.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import { andando as andandoNaColuna, cercado, entradaDaTarefa, etapaDaTarefa, resolverTarefa, voltaDaResposta } from "../domain/quadro.ts";
import { decidirAposTermino, entradaDoNovoTrabalho, entradaDoReacionamento, entradaDoRecado, saidaDoTurno, esperandoNaCadeia, estadoDaExecucao, molduraDoRecado, motivoDaFalha, recadosNaEntrada, type RecadoNaEntrada, tentativasAutomaticasSeguidas, terminada, voltaCiPronta, voltaNaTela } from "../domain/quadro-execucoes.ts";
import type { DesfechoComFrase } from "../repositories/quadro-execucoes.repo.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { fecharPedidoSemAcordar } from "./entregar-resposta-peer.ts";
import { abrirTurno, acharQuadro, agentesDaPessoa, avisarComVoce, comentarPergunta, comMembros, eventoQuadro, experimentoLigado, falhaDoAchado, montarQuadro, pararTurno, type PedidoLote, type ResultadoLote } from "./quadro.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { registrarHistoricoComTrilha } from "./trilha-quadro.ts";
import { vaiParaQuadroDeOutraPessoa } from "./quadro-pessoas.ts";
import type { Isolar } from "./turnos-orfaos.ts";
import { ehUuid } from "./apoio-l7.ts";
import { enfileirarVolta } from "./me-chame-as.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";
import { AVISO_SEM_SAIDA } from "../contracts/quadro-execucoes.ts";
import { LIMITE_ACIONAMENTOS_HORA } from "../domain/freios-quadro.ts";
import { situacaoDasTarefas } from "./situacao-trabalho.ts";

/**
 * Os trabalhos de uma tarefa do quadro (definido em 2026-11-02, NOD-418): a lista na tarefa aberta, Repetir, Cancelar,
 * o recado e o passo do varredor que trata o fim de cada trabalho (nova tentativa na falha transitória, Bloqueado no
 * erro do agente). Trabalho concluído não move a tarefa: quem move é o bot (gerir_quadro) ou a pessoa.
 *
 * O recado com o trabalho rodando entra na sessão viva (ADR-083, emenda NOD-418): fica pendente em quadro_recados e o
 * renovar da ponte o oferece no próximo passo (ofertarRecadosDoQuadro). Na fila, ele se junta ao pedido do turno. Sem
 * nada vivo, vira o próximo trabalho. O que a sessão não chegou a ler vira o próximo trabalho quando o atual termina.
 *
 * Tudo com o quadro travado (buscarTravado): o varredor, um lote e o Repetir não se cruzam.
 */

type OpTrabalho = Extract<OpQuadro, { tipo: "repetir_trabalho" | "cancelar_trabalho" | "recado" | "acordar_trabalho" }>;
type Origem = "repetir" | "automatica" | "recado";

/** Na tela, a nota do recado: entra no próximo passo (rodando), quando começar (fila) ou já virou um trabalho. */
export type EntregaRecado = "agora" | "quando_comecar" | "novo";

/** A decisão da cadeia antiga que o Repetir ou o Cancelar soltou (domain/decisoes.ts tem a frase). */
export const REGRA_TRABALHO_SUBSTITUIDO = "regra:trabalho_do_quadro_substituido" as const;

const falha = (erro: Extract<ResultadoLote, { ok: false }>["erro"], detalhe: string): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe } });

/**
 * A tarefa anda (o trabalho dela é cobrado pelas 4 saídas, repete sozinho e pode ir para Bloqueado). revisto em
 * 2026-11-10 (ADA-289, P1): era só A fazer e Fazendo; desde a ADR-142 Em revisão aciona pela passagem, e o bot que parava
 * calado lá valia como "andou". Agora é a mesma régua do domínio (grupo iniciado, fora de Bloqueado e de Precisa de você).
 */
const andando = (q: Quadro, t: TarefaQuadro): boolean => andandoNaColuna(colunasDe(q), t.status);

async function desfechosDe(deps: Deps, execs: readonly ExecucaoQuadro[]): Promise<Map<string, DesfechoComFrase>> {
  return deps.repos.quadroExecucoes.desfechos(execs.map((e) => e.turnoId));
}

type Vivo = { e: ExecucaoQuadro; d: DesfechoComFrase };

/**
 * Os trabalhos vivos da tarefa (na fila, rodando ou com a cadeia esperando a pessoa ou o CI), do mais recente ao
 * primeiro. Pode haver mais de um: o lote começa um trabalho de comentário enquanto outro ainda espera.
 */
function vivosDe(execs: readonly ExecucaoQuadro[], desfechos: Map<string, DesfechoComFrase>): Vivo[] {
  const vivos: Vivo[] = [];
  for (const e of [...execs].reverse()) {
    const d = desfechos.get(e.turnoId);
    if (d && !terminada(estadoDaExecucao(e, d))) vivos.push({ e, d });
  }
  return vivos;
}

/** O trabalho que roda de verdade (fila ou um turno despachado), não só esperando: o Repetir não passa por cima dele. */
const rodandoDe = (vivos: readonly Vivo[]): Vivo | null => vivos.find((v) => !esperandoNaCadeia(v.d)) ?? null;

/** O desfecho a gravar no tratamento: o estado terminado e, na falha, o motivo em palavras. */
function desfechoDoFim(estado: DesfechoExecucao, d: DesfechoComFrase | undefined): [DesfechoExecucao, string | null] {
  return [estado, estado === "falhou" && d ? motivoDaFalha(d) : null];
}

/** A decisão da cadeia antiga que o varredor soltou ao abrir a nova tentativa sozinho ou ao bloquear a tarefa. */
export const REGRA_TRABALHO_TRATADO = "regra:trabalho_do_quadro_tratado" as const;

/**
 * O Repetir, o Cancelar e o varredor (nova tentativa, Bloqueado) soltam as cadeias antigas: as decisões abertas fecham
 * por regra (ninguém continua: a resposta tardia, o "Retomar" da queda ou o veredito do revisor não abrem a retomada
 * antiga em paralelo com o trabalho novo ou com o card Bloqueado) e os comandos de fundo que rodam (o CI) saem
 * cancelados. O mesmo fechamento do Parar de um trabalho (trabalhos.ts, fecharDecisoesDoTrabalho).
 *
 * Revisão 5 do PR #625: com `p` (o Repetir e o Cancelar), o pedido a um colega que a cadeia ainda esperava também fecha
 * (o peer_ask de fecho, sem acordar a cadeia velha) e o turno do colega para: a resposta tardia não reabre a cadeia
 * velha ao lado do trabalho novo, e o colega não segue trabalhando para ninguém.
 */
async function soltarCadeias(deps: Deps, raizes: readonly string[], regra: typeof REGRA_TRABALHO_SUBSTITUIDO | typeof REGRA_TRABALHO_TRATADO = REGRA_TRABALHO_SUBSTITUIDO, p?: PedidoLote): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  if (p) {
    for (const colega of await deps.repos.quadroExecucoes.pedidosAbertosDasCadeias(raizes)) {
      const f = await fecharPedidoSemAcordar(deps, { turnoId: colega, motivo: "o trabalho do quadro que pediu foi repetido ou cancelado" });
      events.push(...(f.events ?? []));
      await pararTurno(deps, p, colega);
    }
  }
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: regra };
  for (const id of await deps.repos.quadroExecucoes.decisoesAbertasDasCadeias(raizes)) {
    // Revisão 3 do PR #625: a `em_revisao` (ADR-115) fecha junto; o veredito tardio a acha fechada.
    const fechada = await deps.repos.decisoes.fecharPorRegra(id, { regra, regraVersao: 1, agora, tambemEmRevisao: true });
    if (!fechada) continue;
    await deps.repos.decisoes.reivindicarContinuacao(fechada.id, "turno", agora);
    const proposta = await deps.repos.propostas.buscar(fechada.id);
    if (proposta?.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "recusada");
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra } }));
  }
  await deps.repos.quadroExecucoes.cancelarEsperasDasCadeias(raizes, regra === REGRA_TRABALHO_TRATADO ? "o quadro abriu outra tentativa ou bloqueou a tarefa" : "o trabalho do quadro foi repetido ou cancelado", agora);
  return events;
}

/** Cancela, trata e para cada trabalho vivo, no turno dele (não no que a tarefa guarda: o de comentário roda noutro). */
async function cancelarVivos(deps: Deps, p: PedidoLote, vivos: readonly Vivo[]): Promise<void> {
  for (const v of vivos) {
    await deps.repos.quadroExecucoes.cancelar(v.e.id);
    await deps.repos.quadroExecucoes.tratar(v.e.id, "cancelado", null);
    await pararTurno(deps, p, v.e.turnoId);
  }
}

/** O nome do bot que repassou o recado (a moldura diz "repassada por"). */
async function nomesDeQuemRepassou(deps: Deps, recados: readonly Pick<RecadoQuadro, "repassadoPor">[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  for (const id of new Set(recados.map((r) => r.repassadoPor).filter((x): x is string => x !== null))) {
    nomes.set(id, (await deps.repos.agentes.buscar(id))?.nome ?? "o bot");
  }
  return nomes;
}

const repassador = (p: PedidoLote): string | null => (p.autor.tipo === "agente" ? p.autor.agenteId : null);

/** Os trabalhos da tarefa como a tela lê: do mais recente ao primeiro, os recados e a conversa onde rodam. */
export async function trabalhosDaTarefa(deps: Deps, t: TarefaQuadro): Promise<ExecucoesDaTarefa> {
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const desfechos = await desfechosDe(deps, execs);
  let seguidas = 0;
  // ADA-232: a volta marcada de cada cadeia ("Volto quando… · Acordar agora"); só a do trabalho que ainda não terminou.
  const voltas = await deps.repos.quadroExecucoes.voltasDasCadeias(execs.map((e) => e.turnoId));
  const dtos: ExecucaoDto[] = execs.map((e) => {
    // A mesma conta de tentativasAutomaticasSeguidas: o trabalho de comentário não zera.
    if (e.origem !== "comentario") seguidas = e.origem === "automatica" ? seguidas + 1 : 0;
    const d = desfechos.get(e.turnoId);
    return {
      id: e.id, numero: e.numero, origem: e.origem, turnoId: e.turnoId, motivo: e.motivo, criadoEm: e.criadoEm,
      estado: estadoDaExecucao(e, d),
      esperando: estadoDaExecucao(e, d) === "rodando" && esperandoNaCadeia(d),
      turnoAtual: d?.turnoAtual ?? e.turnoId,
      comecouEm: d?.despachadoEm ?? null,
      ultimaFrase: d?.ultimaFrase ?? null,
      tentativa: e.origem === "automatica" ? seguidas : null,
      novaTentativaEm: e.novaTentativaEm,
      saida: e.saida,
      volta: voltaNaTela(terminada(estadoDaExecucao(e, d)) || e.canceladaEm !== null ? null : voltas.get(e.turnoId) ?? null),
    };
  });
  const recados = (await deps.repos.quadroExecucoes.recadosDaTela(t.id)).map((r) => ({ id: r.id, texto: r.texto, criadoEm: r.criadoEm, entregue: r.entregueEm !== null }));
  const conversa = t.agenteId ? await deps.repos.conversas.buscarPropriaDoAgente(t.agenteId) : null;
  return { execucoes: dtos.reverse(), recados, conversaId: conversa?.id ?? null, semAgente: !t.agenteId };
}

/**
 * Revisão 4 do PR #625: o trabalho atual de cada tarefa como o bot o lê no resumo do quadro (gerir_quadro). O motivo da
 * falha sai cercado (ADR-047): carrega a frase do erro, que pode trazer texto de fora (a saída do comando, do provedor).
 */
export async function trabalhosParaBot(deps: Deps, tarefaIds: readonly string[]): Promise<Map<string, TrabalhoParaBot>> {
  const atuais = await deps.repos.quadroExecucoes.atuaisDasTarefas(tarefaIds);
  const desfechos = await desfechosDe(deps, atuais);
  const r = new Map<string, TrabalhoParaBot>();
  for (const e of atuais) {
    const d = desfechos.get(e.turnoId);
    const estado = estadoDaExecucao(e, d);
    const motivo = estado === "falhou" ? (e.motivo ?? (d ? motivoDaFalha(d) : null)) : null;
    r.set(e.tarefaId, { numero: e.numero, estado, esperando: estado === "rodando" && esperandoNaCadeia(d), motivo: motivo === null ? null : cercado(motivo),
      novaTentativaEm: e.novaTentativaEm === null ? null : new Date(e.novaTentativaEm).toISOString() });
  }
  return r;
}

/** Bloqueada (Bloqueado, ou esperando a pessoa com a coluna de antes guardada): o trabalho novo a devolve para onde estava. */
function estaBloqueada(q: Quadro, t: TarefaQuadro): boolean {
  const papel = papelDe(colunasDe(q), t.status);
  return papel === "bloqueado" || (papel === "voce" && t.voltarPara !== null && t.voltarPara !== t.status);
}

/**
 * Onde um trabalho novo pode abrir: nas colunas que acionam o responsável (acionaNaColuna, a regra da NOD-417 e do
 * varredor) ou na tarefa bloqueada, que o trabalho novo devolve para onde estava. Feito, Cancelado e Backlog não.
 */
const podeAbrirTrabalho = (q: Quadro, t: TarefaQuadro): boolean => acionaNaColuna(colunasDe(q), t.status) || estaBloqueada(q, t);

/**
 * Um trabalho novo na tarefa: o pedido da tarefa e os recados pendentes (na origem recado, só os recados). Quem chama
 * já cancelou e parou os vivos (cada um no turno dele); aqui só o turno que a tarefa guarda e que não é trabalho nenhum
 * (dado de antes dos trabalhos) é parado. A tarefa Bloqueada volta para onde estava (o Repetir é o "resolvi"); no quadro sem a
 * coluna Bloqueado ela caiu em "voce" com a coluna de antes guardada, e volta igual. null = sem responsável ou sem
 * conversa.
 */
/** Os nomes dos bots da pessoa (as saídas da etapa nomeiam quem recebe a tarefa). */
async function nomesDosBots(deps: Deps): Promise<Map<string, string>> {
  return new Map((await deps.repos.agentes.listar()).map((a) => [a.id, a.nome]));
}

async function novoTrabalho(deps: Deps, p: PedidoLote, q: Quadro, t: TarefaQuadro, origem: Origem, recadoNovo?: string): Promise<{ execucao: ExecucaoQuadro; events: RuntimeEvent[] } | null> {
  const agente = t.agenteId ? await deps.repos.agentes.buscar(t.agenteId) : null;
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) return null;
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const ultimo = execs.at(-1);
  const anterior = ultimo ? await deps.repos.turnos.buscar(ultimo.turnoId) : null;
  const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  // Revisão 4 do PR #625: os pendentes saem da fila AQUI (update ... returning) e o pedido leva só o que este update
  // marcou. A confirmação da sessão viva que chega no meio não os acha mais pendentes: o recado não sai em dois lugares.
  const pendentes = await deps.repos.quadroExecucoes.tomarPendentes(t.id);
  const nomes = await nomesDeQuemRepassou(deps, [...pendentes, { repassadoPor: repassador(p) }]);
  const textos: RecadoNaEntrada[] = [
    ...pendentes.map((r) => ({ texto: r.texto, repassadoPor: r.repassadoPor ? nomes.get(r.repassadoPor) ?? null : null })),
    ...(recadoNovo ? [{ texto: recadoNovo, repassadoPor: nomes.get(repassador(p) ?? "") ?? null }] : []),
  ];
  const colunas = colunasDe(q);
  const bloqueada = estaBloqueada(q, t);
  const status = bloqueada ? (t.voltarPara && t.voltarPara !== t.status ? voltaDaResposta(colunas, t) : colunaDeAndamento(colunas) ?? colunaDeEspera(colunas)) : t.status;
  // Revisão 2 do PR #625: o pedido parte da tarefa de agora (título, descrição, a etapa da coluna para onde ela vai) e
  // dos recados pendentes, não do pedido do trabalho anterior (que já levava recados entregues ou nem tinha a tarefa).
  const texto = origem === "recado"
    ? entradaDoRecado({ titulo: t.titulo, tarefaId: t.id, quadroId: q.id, recados: textos, pessoaNome })
    : entradaDoNovoTrabalho({ pedido: entradaDaTarefa({ quadroId: q.id, meta: q.meta, prazo: q.prazo, tarefa: t, labels: labelsDaTarefa(t.labelIds, await deps.repos.quadros.labels(q.id)).map((l) => l.nome), pessoaNome, deQuem: null, etapa: etapaDaTarefa(colunas, status, { agenteId: t.agenteId, nomes: await nomesDosBots(deps), quemFecha: q.quemFecha ?? "bot" }) }), automatica: origem === "automatica", recados: textos, pessoaNome, titulo: t.titulo });
  if (t.turnoId && !execs.some((e) => e.turnoId === t.turnoId)) await pararTurno(deps, p, t.turnoId);
  // A mesma corrente do trabalho anterior (o +1 é do abrirTurno); contaminado se a tarefa ou o anterior eram.
  const profundidade = (anterior ? Math.max(0, anterior.profundidade - 1) : (p.profundidade ?? 0)) as Profundidade;
  const deFora = t.deFora || (anterior ? await deps.repos.turnos.contaminado(anterior.id) : false);
  const aberto = await abrirTurno(deps, { ...p, executor: anterior?.executor ?? p.executor, profundidade }, agente, texto, deFora, t);
  if (!aberto) {
    await deps.repos.quadroExecucoes.devolverTomados(t.id, pendentes.map((r) => r.id));
    return null;
  }
  // O trabalho novo toma o lugar da nova tentativa agendada (o Repetir, o recado, a própria tentativa).
  await deps.repos.quadroExecucoes.desagendarNovaTentativa({ tarefaId: t.id });
  await deps.repos.quadros.salvarTarefa(t.id, { ...t, status, turnoId: aberto.turnoId, ...(bloqueada ? { pergunta: null, voltarPara: null } : {}) });
  // Revisão 4 do PR #630: a volta da Bloqueada muda a coluna; entra no histórico e na trilha (tarefa_movida, autor regra).
  if (status !== t.status) await registrarHistoricoComTrilha(deps, q.id, [{ tarefaId: t.id, campo: "status", de: t.status, para: status, autor: { tipo: "regra" } }], null);
  const execucao = await deps.repos.quadroExecucoes.inserir({ tarefaId: t.id, origem, turnoId: aberto.turnoId });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "o turno novo já era um trabalho" });
  const levados = [...pendentes.map((r) => r.id)];
  if (recadoNovo) levados.push((await deps.repos.quadroExecucoes.inserirRecado(t.id, recadoNovo, repassador(p))).id);
  await deps.repos.quadroExecucoes.levarRecados(t.id, execucao.id, aberto.turnoId, levados);
  return { execucao, events: aberto.events };
}

/** Os fins ainda não tratados saem tratados (o Repetir e o recado novo tomam o lugar deles: nada repete por cima). */
async function tratarTerminados(deps: Deps, execs: readonly ExecucaoQuadro[], desfechos: Map<string, DesfechoComFrase>): Promise<void> {
  for (const e of execs) {
    if (e.tratadaEm !== null) continue;
    const d = desfechos.get(e.turnoId);
    const estado = estadoDaExecucao(e, d);
    if (terminada(estado)) await deps.repos.quadroExecucoes.tratar(e.id, ...desfechoDoFim(estado as DesfechoExecucao, d));
  }
}

/**
 * Repetir, Cancelar e recado (as ops repetir_trabalho, cancelar_trabalho e recado): a tela e o gerir_quadro chegam aqui
 * pelo mesmo pedido. A resposta traz o trabalho que ficou (número e estado) e a vista inteira da tarefa.
 */
export async function trabalhoDaTarefa(deps: Deps, p: PedidoLote, op: OpTrabalho): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  // NOD-443 × NOD-418: o trabalho da tarefa (repetir, cancelar, recado) é da dona do quadro; quem participa comenta (D7).
  // NOD-455 (revisão 6, M3): pelo bot de quem participa, também, e antes da chave dela (o quadro é da dona).
  if (p.pedidoPor || (await vaiParaQuadroDeOutraPessoa(deps, p))) return falha("nao_permitido", "o trabalho da tarefa é da dona do quadro: deixe um comentário (comentar) para ela");
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
  if (!achado) return falha("sem_quadro", "não há quadro: crie com criar_quadro");
  const q = await deps.repos.quadros.buscarTravado(achado.id);
  if (!q) return falha("sem_quadro", "o quadro sumiu");
  const tarefas = await deps.repos.quadros.tarefas(q.id);
  const achada = resolverTarefa(tarefas.map((t) => ({ ...t, nova: false })), op.tarefa);
  if ("erro" in achada) return falha(achada.erro.includes("não está no quadro") ? "nao_encontrado" : "entrada_invalida", achada.erro);
  const t = tarefas.find((x) => x.id === achada.id)!;
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const desfechos = await desfechosDe(deps, execs);
  const vivos = vivosDe(execs, desfechos);
  const rodando = rodandoDe(vivos);
  const events: RuntimeEvent[] = [];
  let trabalho: { numero: number | null; entregue?: EntregaRecado; cancelados?: number };

  if (op.tipo === "acordar_trabalho") {
    // ADA-232 (ADR-155): "Acordar agora". A volta que dorme (hora marcada ou CI) dispara já, na mesma cadeia e sessão;
    // o comando de fundo não se acorda (ele termina sozinho); sem volta, nada muda.
    const volta = (await situacaoDasTarefas(deps, [t.id])).get(t.id)?.volta ?? null;
    if (!volta) return falha("estado_invalido", "a tarefa não está esperando uma volta: não há o que acordar");
    if (!volta.turnoId) return falha("estado_invalido", "a tarefa espera um comando de fundo, que termina sozinho: não há o que acordar");
    await deps.repos.turnos.acordarVolta(volta.turnoId, deps.agora());
    trabalho = { numero: vivos[0]?.e.numero ?? null };
  } else if (op.tipo === "cancelar_trabalho") {
    // Não move a tarefa (decisão da Ada): cancela e para cada trabalho vivo (no turno dele), solta o que as cadeias
    // esperavam e os recados que aguardavam. Nada vivo = nada muda.
    await cancelarVivos(deps, p, vivos);
    events.push(...(await soltarCadeias(deps, vivos.map((v) => v.e.turnoId), REGRA_TRABALHO_SUBSTITUIDO, p)));
    const cancelados = await deps.repos.quadroExecucoes.cancelarRecados(t.id);
    // Revisão 4 do PR #625: a nova tentativa agendada (a espera depois da queda) também sai: Cancelar é parar tudo.
    await deps.repos.quadroExecucoes.desagendarNovaTentativa({ tarefaId: t.id });
    trabalho = { numero: vivos[0]?.e.numero ?? null, cancelados };
  } else {
    if (!t.agenteId) return falha("entrada_invalida", "sem agente responsável: a tarefa precisa de um bot para trabalhar (mudar_tarefa com agente)");
    // Repetir com um trabalho rodando de verdade não abre outro (o duplo clique, o Repetir do chat): cancele antes.
    if (op.tipo === "repetir_trabalho" && rodando) return falha("estado_invalido", "Já está rodando: cancele antes (cancelar_trabalho) se a pessoa quer repetir");
    const vivo = op.tipo === "recado" ? rodando ?? vivos[0] ?? null : null;
    if (op.tipo === "recado" && vivo) {
      const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
      const nomes = await nomesDeQuemRepassou(deps, [{ repassadoPor: repassador(p) }]);
      const bloco = recadosNaEntrada([{ texto: op.texto, repassadoPor: nomes.get(repassador(p) ?? "") ?? null }], pessoaNome, t.titulo)[0]!;
      if (vivo.d.estado === "pendente" && !vivo.d.parado && (await deps.repos.turnos.juntarEntrada(vivo.e.turnoId, bloco))) {
        // Na fila: o recado entra no pedido do turno, que ainda não começou.
        const r = await deps.repos.quadroExecucoes.inserirRecado(t.id, op.texto, repassador(p));
        await deps.repos.quadroExecucoes.levarRecados(t.id, vivo.e.id, vivo.e.turnoId, [r.id]);
        trabalho = { numero: vivo.e.numero, entregue: "quando_comecar" };
      } else {
        // Rodando: a sessão viva lê no próximo passo (ofertarRecadosDoQuadro). Esperando (a pessoa, o CI): entra quando
        // a retomada começar. Se não ler, vira o próximo trabalho.
        await deps.repos.quadroExecucoes.inserirRecado(t.id, op.texto, repassador(p));
        trabalho = { numero: vivo.e.numero, entregue: esperandoNaCadeia(vivo.d) ? "quando_comecar" : "agora" };
      }
    } else {
      // Revisão 2 do PR #625: fora do andamento (Feito, Cancelado, Backlog) nada abre trabalho; a pessoa move a tarefa antes.
      if (!podeAbrirTrabalho(q, t)) return falha("estado_invalido", "a tarefa não está em andamento: mova-a antes");
      // Repetir abre um trabalho novo e zera a conta das automáticas. O que só esperava (a pessoa, o CI) sai cancelado,
      // e as cadeias antigas soltam o que esperavam: a resposta tardia não reabre o trabalho antigo.
      await cancelarVivos(deps, p, vivos);
      events.push(...(await soltarCadeias(deps, execs.filter((e) => e.canceladaEm === null || vivos.some((v) => v.e.id === e.id)).map((e) => e.turnoId), REGRA_TRABALHO_SUBSTITUIDO, p)));
      await tratarTerminados(deps, execs, desfechos);
      const r = await novoTrabalho(deps, p, q, t, op.tipo === "recado" ? "recado" : "repetir", op.tipo === "recado" ? op.texto : undefined);
      if (!r) return falha("entrada_invalida", "sem agente responsável que possa trabalhar: o bot não tem conversa própria");
      events.push(...r.events);
      trabalho = { numero: r.execucao.numero, ...(op.tipo === "recado" ? { entregue: "novo" as const } : {}) };
    }
  }
  events.unshift(eventoQuadro(deps, p, q, null, [t.id]));
  const atual = (await deps.repos.quadros.tarefa(t.id)) ?? t;
  const trabalhos = await trabalhosDaTarefa(deps, atual);
  const estado = trabalhos.execucoes.find((e) => e.numero === trabalho.numero)?.estado ?? null;
  return { data: { ok: true, quadro: await montarQuadro(deps, q), lote: null, comecaram: [], desfeito: false, trabalho: { ...trabalho, estado }, trabalhos }, events: await comMembros(deps, events) };
}

/**
 * 2026-11-10 (os chips do comentário): o trabalho do responsável nesta tarefa, como o chip o lê. rodando = um turno
 * despachado (não só esperando a pessoa ou o CI): o "manda agora" vira recado na sessão viva (ofertarRecadosDoQuadro);
 * fila = há trabalho na fila.
 */
export async function trabalhoVivoDaTarefa(deps: Deps, tarefaId: string): Promise<{ rodando: boolean; fila: boolean; turnoRodando: string | null }> {
  const execs = await deps.repos.quadroExecucoes.daTarefa(tarefaId);
  const vivos = vivosDe(execs, await desfechosDe(deps, execs));
  const r = rodandoDe(vivos);
  const rodando = !!r && r.d.estado !== "pendente";
  return { rodando, fila: vivos.some((v) => v.d.estado === "pendente" && !v.d.parado), turnoRodando: rodando ? r.e.turnoId : null };
}

/** 2026-11-10 ("no lugar do atual"): cancela os trabalhos vivos da tarefa como o Cancelar (sem mexer nos recados). */
export async function cancelarTrabalhosVivos(deps: Deps, p: PedidoLote, tarefaId: string): Promise<RuntimeEvent[]> {
  const execs = await deps.repos.quadroExecucoes.daTarefa(tarefaId);
  const vivos = vivosDe(execs, await desfechosDe(deps, execs));
  if (!vivos.length) return [];
  await cancelarVivos(deps, p, vivos);
  return soltarCadeias(deps, vivos.map((v) => v.e.turnoId), REGRA_TRABALHO_SUBSTITUIDO, p);
}

/** Os trabalhos de uma tarefa do quadro do bot da tela. Só lê. */
export const verTrabalhos: CasoDeUso<{ agenteId: string; tarefaId: string }, ExecucoesDaTarefa> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  // ADA-14: a tarefa de qualquer quadro deste bot.
  const t0 = ehUuid(input.tarefaId) ? await deps.repos.quadros.tarefa(input.tarefaId) : null;
  const q = t0 ? await deps.repos.quadros.doBot(input.agenteId, t0.quadroId) : null;
  const t = q ? (await deps.repos.quadros.tarefas(q.id)).find((x) => x.id === input.tarefaId) : undefined;
  if (!t) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora do quadro" });
  return { data: await trabalhosDaTarefa(deps, t) };
};

/**
 * Os recados pendentes da tarefa cujo trabalho roda nesta cadeia, emoldurados como fala da pessoa (o renovar da ponte
 * os põe na sessão viva e confirma pelo id quando a sessão os aceita). Vazio = o turno não é de um trabalho do quadro.
 */
export async function ofertarRecadosDoQuadro(deps: Deps, turnoId: string): Promise<{ id: string; texto: string }[]> {
  // Só o turno de um trabalho do quadro (o começo é delegação; a cadeia, retomadas): a conversa, a rotina e o colega
  // não leem nada daqui (sai cedo, sem subir cadeia).
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || (turno.origem !== "delegacao" && turno.origem !== "retomada")) return [];
  // Roda em toda renovação: sem nenhum recado pendente da pessoa (o comum), nem sobe a cadeia (revisão 2 do PR #625).
  if (!(await deps.repos.quadroExecucoes.temRecadoPendente())) return [];
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  const execucao = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  if (!execucao || execucao.canceladaEm !== null) return [];
  const pendentes = await deps.repos.quadroExecucoes.recadosPendentes(execucao.tarefaId);
  if (pendentes.length === 0) return [];
  const t = await deps.repos.quadros.tarefa(execucao.tarefaId);
  if (!t) return [];
  // O recado vai para o trabalho vivo mais recente da tarefa (o mesmo que a nota da tela aponta), seja o que a tarefa
  // guarda, seja o de um comentário.
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const vivo = rodandoDe(vivosDe(execs, await desfechosDe(deps, execs)));
  if (vivo?.e.id !== execucao.id) return [];
  const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  const nomes = await nomesDeQuemRepassou(deps, pendentes);
  return pendentes.map((r) => ({ id: r.id, texto: molduraDoRecado({ titulo: t.titulo, texto: r.texto, pessoaNome, repassadoPor: r.repassadoPor ? nomes.get(r.repassadoPor) ?? null : null }) }));
}

/**
 * Revisão 3 do PR #625: a cadeia deste turno é de um trabalho do quadro que já foi substituído ou tratado de vez — o
 * Retomar dela rodaria a cadeia velha junto do trabalho novo, ou com o card Bloqueado. Substituído: cancelado, ou com
 * um trabalho posterior na tarefa que não seja de comentário (o de comentário roda ao lado, não no lugar). Tratado de
 * vez: o fim já foi tratado e a tarefa ficou bloqueada por ele (o caminho é o Repetir). null = pode retomar (não é
 * trabalho do quadro, ou é o atual e a tarefa não está bloqueada: o varredor reabre o trabalho quando a retomada nasce).
 */
export async function cadeiaDoQuadroEncerrada(deps: Pick<Deps, "repos">, turnoId: string): Promise<string | null> {
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  const execucao = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  if (!execucao) return null;
  if (execucao.canceladaEm !== null) return "o trabalho do quadro foi cancelado";
  const execs = await deps.repos.quadroExecucoes.daTarefa(execucao.tarefaId);
  if (execs.some((e) => e.numero > execucao.numero && e.origem !== "comentario")) return "o trabalho do quadro já foi substituído por outro";
  if (execucao.tratadaEm === null) return null;
  const t = await deps.repos.quadros.tarefa(execucao.tarefaId);
  const q = t ? await deps.repos.quadros.buscar(t.quadroId) : null;
  if (t && q && t.turnoId === execucao.turnoId && estaBloqueada(q, t)) return "a tarefa do quadro está bloqueada: use Repetir";
  return null;
}

/**
 * O passo do varredor (por pessoa): o fim de cada trabalho ainda não tratado. Só o trabalho atual da tarefa (o turno que
 * ela guarda) repete ou bloqueia; o que um lote já substituiu só fica tratado. O trabalho tratado cuja cadeia ganhou uma
 * retomada viva (o "Retomar" da queda, a resposta que chegou depois) é reaberto: volta a ser tratado quando ela acabar.
 * O recado que a sessão não leu vira o próximo trabalho quando nada está vivo e a tarefa anda; fora do andamento (Feito,
 * Cancelado) ele sai cancelado. O trabalho novo roda onde o anterior rodou (o executor do turno).
 *
 * Revisão 3 do PR #625: cada tarefa roda em `isolar` (o varredor passa um SAVEPOINT): a que lança volta sozinha, fica no
 * log com o id e as outras saem. Sem `isolar` (os testes que não querem), cada tarefa só ganha o try/catch.
 */
export async function cuidarDasExecucoesDoQuadro(deps: Deps, o: { isolar?: Isolar } = {}): Promise<{ tratadas: number; events: RuntimeEvent[]; falharam: string[] }> {
  if (!(await experimentoLigado(deps))) return { tratadas: 0, events: [], falharam: [] };
  const isolar: Isolar = o.isolar ?? ((fn) => fn());
  const events: RuntimeEvent[] = [];
  const falharam: string[] = [];
  let tratadas = 0;
  await acordarVoltasDeCi(deps);
  // As travas dos quadros ficam até o fim da transação: em ordem de id (revisão 2 do PR #625), dois varredores ou um
  // varredor e um lote que pegam mais de um quadro não se travam um esperando o outro.
  const abertas: TarefaQuadro[] = [];
  for (const id of await deps.repos.quadroExecucoes.tarefasAbertas()) {
    const antes = await deps.repos.quadros.tarefa(id);
    if (antes) abertas.push(antes);
  }
  abertas.sort((x, y) => (x.quadroId === y.quadroId ? (x.id < y.id ? -1 : 1) : x.quadroId < y.quadroId ? -1 : 1));
  for (const antes of abertas) {
    try {
      const r = await isolar(() => cuidarDaTarefa(deps, antes));
      tratadas += r.tratadas;
      events.push(...r.events);
    } catch (e) {
      falharam.push(antes.id);
      log("erro", "execucoes_quadro_tarefa_falhou", { tarefa_id: antes.id, quadro_id: antes.quadroId, erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
    }
  }
  // NOD-455 (revisão 5, achado M2): o quadro.mudou do varredor vai também a quem participa (como o do lote).
  return { tratadas, events: await comMembros(deps, events), falharam };
}

/**
 * ADA-232 (ADR-155): as voltas por CI que dormem acordam quando o PR delas terminou os checks (voltaCiPronta), lendo o
 * estado que o laço de PRs já gravou (sem GitHub aqui). Acordar = acordar_em para agora: a máquina pega a retomada na
 * mesma sessão. O prazo máximo (24h) acorda sozinho pela própria acordar_em.
 */
export async function acordarVoltasDeCi(deps: Pick<Deps, "repos" | "agora">): Promise<number> {
  const agora = deps.agora();
  let acordadas = 0;
  for (const v of await deps.repos.turnos.voltasCiPendentes(agora)) {
    if (!voltaCiPronta(await deps.repos.quadros.prPorUrl(v.prUrl), v.criadoEm, agora)) continue;
    if (await deps.repos.turnos.acordarVolta(v.id, agora)) {
      acordadas += 1;
      log("info", "execucoes_quadro_volta_ci_acordou", { turno_id: v.id });
    }
  }
  return acordadas;
}

/** ADA-232: o freio de acionamentos na hora (contando as retomadas) segurou o reacionamento. */
const MOTIVO_FREIO_REACIONAR = `Freio: o bot foi acionado ${LIMITE_ACIONAMENTOS_HORA} vezes ou mais na última hora nesta tarefa e parou sem saída. Veja a conversa e diga o próximo passo.`;

/** ADA-232: a frase da espera da pessoa quando o reacionamento não tem onde retomar (ADR-162: o comentário do sistema). */
const MOTIVO_SEM_SAIDA_FRASE = "O bot parou sem saída e não deu para chamá-lo de volta. Veja a conversa e diga o próximo passo.";

/**
 * ADA-232 (ADR-155): o turno de um trabalho de tarefa assentou concluído — grava a saída com que ele terminou na execução
 * da cadeia (o varredor decide por ela). Chamado pelo assentamento, na mesma transação. Turno sem trabalho de tarefa
 * (conversa, zelador) ou de comentário (roda ao lado do trabalho) não grava: saída null nunca reaciona.
 */
export async function gravarSaidaDoTrabalho(deps: Deps, turno: Turno, concluiu: boolean): Promise<void> {
  if (!concluiu || turno.pararSolicitadoEm !== null) return;
  const raiz = turno.retomaTurnoId ? await deps.repos.turnos.raizDaCadeia(turno.id) : turno;
  const e = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  if (!e || e.canceladaEm !== null || e.origem === "comentario") return;
  const t = await deps.repos.quadros.tarefa(e.tarefaId);
  const q = t ? await deps.repos.quadros.buscar(t.quadroId) : null;
  if (!t || !q) return;
  const desde = turno.despachadoEm ?? turno.criadoEm;
  const camposMudados: string[] = (await deps.repos.quadros.historico(t.id)).filter((h) => h.criadoEm >= desde).map((h) => h.campo);
  // O PR não entra no histórico: "ganhou PR" (pr_url) sai dos lotes e do laço de PRs (revisão do PR #705).
  if (await deps.repos.quadros.prMudouDesde(q.id, t.id, t.prUrl, desde)) camposMudados.push("pr_url");
  const papelAgora = t.status === "voce" ? "voce" : t.status === "bloqueado" ? "bloqueado" : andando(q, t) ? "andando" : "fora";
  // A volta que existe, não o nome da ferramenta: o me_chame_as/esperar_comando recusado não anota nada.
  // As frentes abertas pelo turno e ainda não devolvidas também são volta: o retorno do lote retoma a cadeia (revisão do PR #705).
  const voltaMarcada =
    (await deps.repos.turnos.despertarDoTurno(turno.id)) !== null ||
    (await deps.repos.esperas.doTurnoTravada(turno.id)) !== null ||
    (await deps.repos.frentes.lotesAbertosPor([turno.id])).some((l) => l.devolvidoEm === null);
  const saida = saidaDoTurno({ voltaMarcada, papelAgora, camposMudados });
  // A cadeia assentou um turno novo: o trabalho volta a ser tratado (a retomada que acabou entre dois passes do
  // varredor não fica com o tratamento da parada anterior, que já reacionou).
  await deps.repos.quadroExecucoes.reabrir(e.id);
  await deps.repos.quadroExecucoes.gravarSaida(e.id, saida, deps.agora());
}

/** Um passo do varredor numa tarefa, com o quadro travado. Os eventos só saem se a tarefa inteira passou. */
async function cuidarDaTarefa(deps: Deps, antes: TarefaQuadro): Promise<{ tratadas: number; events: RuntimeEvent[] }> {
  const events: RuntimeEvent[] = [];
  let tratadas = 0;
  // Com a trava do quadro: um lote ou um Repetir concorrente termina antes, e a decisão sai com a tarefa de agora.
  const q = await deps.repos.quadros.buscarTravado(antes.quadroId);
  const t = q ? await deps.repos.quadros.tarefa(antes.id) : null;
  if (!q || !t) return { tratadas, events };
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const desfechos = await desfechosDe(deps, execs);
  // O executor do trabalho anterior (o turno atual da cadeia; o da tarefa, se a cadeia foi podada). Sem nenhum, nada
  // novo abre: não há onde rodar sem chutar. Revisão 5 do PR #625: o último trabalho da tarefa, não o de um comentário
  // (que roda ao lado, noutro turno): o estado dele decide se o recado guardado vira trabalho sozinho.
  const ultimo = [...execs].reverse().find((e) => e.origem !== "comentario") ?? execs.at(-1);
  const guardado = t.turnoId ? await deps.repos.turnos.buscar(t.turnoId) : null;
  const executor: Executor | undefined = (ultimo ? desfechos.get(ultimo.turnoId)?.executor : undefined) ?? guardado?.executor;
  const p: PedidoLote | null = executor ? { autor: { tipo: "pessoa" }, ops: [], executor, profundidade: 0 } : null;
  const haRecado = (await deps.repos.quadroExecucoes.recadosPendentes(t.id)).length > 0;
  let vivo = vivosDe(execs, desfechos).length > 0;
  let bloqueou = false;
  /**
   * Bloqueado (o travamento de fato: sem onde rodar, a falha que não se repete) ou a espera da pessoa (ADR-162: o bot parou
   * sem saída, o freio do reacionamento — o card fica na coluna, com um comentário do sistema): o motivo na linha 1 do
   * card e o aviso na conversa do responsável.
   */
  const bloquear = async (e: ExecucaoQuadro, motivo: string, preferido: "bloqueado" | "voce" = "bloqueado"): Promise<void> => {
    // Revisão 3 do PR #625: Bloqueado solta a cadeia velha (o Retomar não a roda com o card parado; o caminho é o Repetir).
    events.push(...(await soltarCadeias(deps, [e.turnoId], REGRA_TRABALHO_TRATADO)));
    const atual = (await deps.repos.quadros.tarefa(t.id)) ?? t;
    const destino = preferido === "bloqueado" && colunasDe(q).some((c) => c.id === "bloqueado") ? "bloqueado" : "voce";
    // A coluna de onde foi esperar (a que já esperava guarda a dela): é onde o card aparece enquanto espera (ADR-162).
    const voltarPara = atual.status === "voce" || atual.status === "bloqueado" ? atual.voltarPara : atual.status;
    const salva = await deps.repos.quadros.salvarTarefa(t.id, { ...atual, status: destino, voltarPara, pergunta: motivo, resposta: null });
    if (salva && destino === "voce" && atual.status !== "voce") await comentarPergunta(deps, salva, { tipo: "sistema" });
    // Revisão 4 do PR #630: a ida para Bloqueado (ou Precisa de você) entra no histórico e na trilha, autor regra.
    if (salva && destino !== atual.status) await registrarHistoricoComTrilha(deps, q.id, [{ tarefaId: t.id, campo: "status", de: atual.status, para: destino, autor: { tipo: "regra" } }], null);
    events.push(eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
    // Revisão 5 do PR #625: a tarefa escrita de fora (deFora) não leva o título ao aviso: o texto dela fica fora da conversa.
    const texto = atual.deFora ? `Uma tarefa parou no quadro. ${motivo}` : `"${atual.titulo}" parou no quadro. ${motivo}`;
    const aviso = salva && atual.agenteId ? await avisarComVoce(deps, salva, atual.agenteId, texto, salva.agenteId, `quadro-aviso:${e.id}`, "atraso") : null;
    if (aviso) events.push(aviso);
    bloqueou = true;
  };
  for (const e of execs) {
    const d = desfechos.get(e.turnoId);
    const estado = estadoDaExecucao(e, d);
    if (!terminada(estado)) {
      if (e.tratadaEm !== null && (await deps.repos.quadroExecucoes.reabrir(e.id))) events.push(eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
      continue;
    }
    if (e.tratadaEm !== null) continue;
    await deps.repos.quadroExecucoes.tratar(e.id, ...desfechoDoFim(estado as DesfechoExecucao, d));
    tratadas++;
    if (e.turnoId !== t.turnoId || vivo) continue;
    const decisao = decidirAposTermino({ estado, desfecho: d, automaticasSeguidas: tentativasAutomaticasSeguidas(execs), haRecado, andando: andando(q, t), saida: e.saida, semSaida: e.semSaida });
    if (decisao.tipo === "reacionar_sem_saida") {
      // ADA-232 (ADR-155): a retomada na MESMA cadeia (mesma sessão e pasta), com o aviso das 4 saídas. Sem o turno
      // atual (podado) ou com a task fechada não há onde retomar: Precisa de você.
      // O teto de acionamentos na hora (com as retomadas) vale também para o reacionamento: passou, Precisa de você.
      if (((await deps.repos.quadros.acionamentosNaHora(q.id)).get(t.id) ?? 0) >= LIMITE_ACIONAMENTOS_HORA) {
        const antesDoFreio = (await deps.repos.quadros.tarefa(t.id)) ?? t;
        await bloquear(e, MOTIVO_FREIO_REACIONAR, "voce");
        // Revisão do PR #705: o freio entra nos movimentos, como o do lote, e zera a conta da hora. Sem ele, a pessoa que
        // devolve a tarefa para Fazendo era freada de novo pelo lote (as retomadas de antes ainda somavam 12). O autor é o
        // responsável (o acionado; a coluna só aceita pessoa ou agente), como no freio que o lote de um bot dispara.
        const depois = await deps.repos.quadros.tarefa(t.id);
        if (depois && depois.status !== antesDoFreio.status) {
          await deps.repos.quadros.inserirMovimentos(q.id, null, [{
            tarefaId: t.id, tipo: "freio", de: antesDoFreio.status, para: depois.status, agenteAntes: antesDoFreio.agenteId, agenteDepois: depois.agenteId,
            autor: antesDoFreio.agenteId ? { tipo: "agente", agenteId: antesDoFreio.agenteId } : { tipo: "pessoa" }, motivo: MOTIVO_FREIO_REACIONAR, acionou: false,
          }]);
        }
        continue;
      }
      const ultimoTurno = d?.turnoAtual ? await deps.repos.turnos.buscar(d.turnoAtual) : null;
      const r = ultimoTurno && (await deps.repos.quadroExecucoes.contarReacionamento(e.id))
        ? await enfileirarVolta(deps, ultimoTurno, { acordarEm: deps.agora(), motivo: AVISO_SEM_SAIDA, entradaTexto: entradaDoReacionamento({ titulo: t.deFora ? "(tarefa de fora)" : t.titulo, tarefaId: t.id, quadroId: q.id }), daTarefa: true })
        : null;
      if (r) {
        // ADA-16 (ADR-163): o trabalho da tarefa, que terminou com o turno, volta a andar com a retomada na fila.
        if (r.volta?.trabalhoId) events.push(...(await sincronizarTrabalho(deps, r.volta.trabalhoId)));
        events.push(...r.events, eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
        if (r.volta) vivo = true;
        log("info", "execucoes_quadro_reacionou_sem_saida", { tarefa_id: t.id, execucao_id: e.id });
      } else await bloquear(e, MOTIVO_SEM_SAIDA_FRASE, "voce");
    } else if (decisao.tipo === "precisa_de_voce") {
      await bloquear(e, decisao.motivo, "voce");
    } else if (decisao.tipo === "repetir") {
      // Revisão 4 do PR #625: a nova tentativa espera INTERVALO_NOVA_TENTATIVA_MS depois do tratamento (a queda da
      // máquina costuma durar mais que um passo do varredor). Ela abre num passo seguinte. Revisão 5: a hora sai do
      // relógio do app (deps.agora()), o mesmo que decide se venceu. Sem onde rodar (nenhum executor), Bloqueado.
      if (p) await deps.repos.quadroExecucoes.agendarNovaTentativa(e.id, deps.agora() + INTERVALO_NOVA_TENTATIVA_MS);
      else await bloquear(e, SEM_NOVA_TENTATIVA);
    } else if (decisao.tipo === "bloquear") {
      await bloquear(e, decisao.motivo);
    }
  }
  // A nova tentativa agendada que venceu sempre sai da agenda (revisão 5 do PR #625: com o recado guardado no Backlog
  // ela ficava agendada e prendia a tarefa no varredor). Abre se o trabalho ainda é o atual, nada está vivo e a tarefa
  // anda; com recado pendente, quem abre é o recado (logo abaixo). Devia abrir e não abriu (sem onde rodar, o bot sem
  // conversa): Bloqueado com aviso — o caminho é o Repetir. A que ainda não venceu fica para o próximo passo.
  const agendada = execs.find((e) => e.novaTentativaEm !== null);
  let faltouAbrir: ExecucaoQuadro | null = null;
  if (agendada && agendada.novaTentativaEm! <= deps.agora()) {
    await deps.repos.quadroExecucoes.desagendarNovaTentativa({ id: agendada.id });
    const deveAbrir = !bloqueou && agendada.turnoId === t.turnoId && agendada.canceladaEm === null && !vivo && andando(q, t);
    if (deveAbrir) faltouAbrir = agendada;
    const r = deveAbrir && !haRecado && p ? await novoTrabalho(deps, p, q, t, "automatica") : null;
    if (r) {
      // Revisão 3 do PR #625: com a nova tentativa aberta (na mesma transação), a cadeia velha solta o que esperava (o
      // "Retomar" que a queda abriu, consequencias em interromper-por-maquina.ts): o Retomar tardio não a roda junto do
      // trabalho novo.
      events.push(...(await soltarCadeias(deps, [agendada.turnoId], REGRA_TRABALHO_TRATADO)));
      events.push(...r.events, eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
      vivo = true;
      faltouAbrir = null;
    }
  }
  // O recado entra quando nada está vivo e a tarefa anda: o fim que acabou de ser tratado (entregar_recado) ou um que
  // já estava. A tarefa que saiu do andamento (Feito, Cancelado) não reabre trabalho: o recado sai cancelado.
  if (haRecado && !vivo && !bloqueou) {
    const atual = (await deps.repos.quadros.tarefa(t.id)) ?? t;
    const papel = papelDe(colunasDe(q), atual.status);
    if (papel === "feito" || papel === "cancelado") {
      await deps.repos.quadroExecucoes.cancelarRecados(t.id);
      return { tratadas, events };
    }
    // Revisão 4 do PR #625: a mesma regra do Repetir (podeAbrirTrabalho: Backlog não abre) e o trabalho que terminou
    // cancelado (o Parar de fora, sem o Cancelar do quadro) não vira outro sozinho. O recado fica guardado: vai no
    // próximo Repetir ou início (e a tarefa sai da conta do varredor: tarefasAbertas).
    const ultimoEstado = ultimo ? estadoDaExecucao(ultimo, desfechos.get(ultimo.turnoId)) : null;
    if (!podeAbrirTrabalho(q, atual) || ultimoEstado === "cancelado") return { tratadas, events };
    const r = p ? await novoTrabalho(deps, p, q, atual, "recado") : null;
    if (r) {
      // O recado tomou o lugar da nova tentativa agendada: a cadeia dela solta o que esperava, como a tentativa faria.
      if (agendada && agendada.novaTentativaEm !== null) events.push(...(await soltarCadeias(deps, [agendada.turnoId], REGRA_TRABALHO_TRATADO)));
      events.push(...r.events, eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
      faltouAbrir = null;
    }
  }
  if (faltouAbrir) await bloquear(faltouAbrir, SEM_NOVA_TENTATIVA);
  return { tratadas, events };
}

/** Revisão 5 do PR #625: a nova tentativa sozinha não abriu (o bot sem onde rodar ou sem conversa). */
const SEM_NOVA_TENTATIVA = "Não deu para abrir a nova tentativa sozinho: o bot ficou sem onde rodar. Use Repetir.";

/** A trilha do que o varredor muda no quadro (sem turno de quem chamou). */
const DO_VARREDOR = { autor: { tipo: "pessoa" } } as const;
