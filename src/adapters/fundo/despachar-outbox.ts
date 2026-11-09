import type { EstadoDoDono } from "../../contracts/dono.ts";
import type { KindEvento } from "../../contracts/evento.ts";
import type { TipoFrame } from "../../contracts/frame.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao, type Metricas } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Barramento } from "../../services/barramento.ts";
import { OUTBOX_IDADE_MIN_MS, OUTBOX_TETO_TENTATIVAS } from "../../shared/constantes.ts";
import { ouvirOutbox } from "../../shared/sinal-outbox.ts";
import type { ServicoDasMaquinas } from "../../contracts/trabalho.ts";
import type { PresencaDasMaquinas } from "../../domain/presenca-da-maquina.ts";
import { estadoDoDonoAgora, presencaDasMaquinas } from "../../use-cases/estado-do-dono.ts";
import type { Conn, Db, Escopo, Relogio } from "../../shared/types.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/**
 * Despachante do outbox (ADR-010 refinado, Práticas §7): laço de fundo que, POR PESSOA e numa
 * transação real escopada (paraCadaPessoa), lê os itens pendentes de `events_outbox`, publica cada
 * um como frame no barramento da pessoa e marca entregue. Mora em src/adapters/fundo porque abre
 * transação (EMENDA 3); o barramento (src/services) não conhece banco.
 *
 * Semântica: pelo menos uma vez. O frame é publicado ANTES do commit do `entregue_em`; se a
 * transação cair no meio, o item sai de novo na próxima passada (o cliente deduplica por seq).
 * Falha ao publicar → `incrementarTentativa`. Abandono só com as DUAS condições (teto de tentativas
 * E idade mínima, constantes em src/shared/constantes.ts), varrido numa cadência menor que a do
 * despacho; abandonado é CONTADO na métrica `outbox_abandonados`, nunca apagado. Item cancelado
 * (Parar, E8.3) nunca sai: `pendentes()` já o exclui.
 */

/**
 * definido em 2026-10-22 (QA NOD-331): sem a hora do banco no `soLigacoes`, o `desde` é o relógio local menos esta folga
 * (cobre a diferença de relógio entre a VM e o banco e o tick em voo). Republicar é aceito ("pelo menos uma vez").
 */
export const DESDE_SEM_BANCO_FOLGA_MS = 60_000;

/** Tabela TOTAL kind → frame: um kind fora dela é linha envenenada e segue o caminho de falha/abandono. */
export const FRAME_POR_EVENTO: Record<KindEvento, TipoFrame> = {
  mensagem_criada: "mensagem.nova",
  turno_criado: "turno.iniciado",
  turno_despachado: "turno.iniciado",
  turno_encerrado: "turno.encerrado",
  turno_interrompido: "turno.interrompido",
  decisao_criada: "decisao.nova",
  decisao_decidida: "decisao.decidida",
  decisao_vencida: "decisao.vencida",
  proposta_criada: "proposta.nova",
  rotina_criada: "rotina.criada",
  // definido em 2026-09-21: atualizar/excluir reusam o frame 'rotina.criada' porque ele só diz
  // "a lista de rotinas mudou" — o reducer invalida e reidrata por REST (web/estado/reducer.ts).
  // Frame novo exigiria caso novo no reducer para o mesmo efeito.
  rotina_atualizada: "rotina.criada",
  rotina_excluida: "rotina.criada",
  rotina_executou: "rotina.executou",
  // Mesmo frame de propósito: a execução silenciosa não escreve no chat, mas o painel de rotinas
  // precisa saber que ela rodou para o histórico aparecer sem recarregar a página.
  rotina_sem_novidade: "rotina.executou",
  // definido em 2026-09-24 (emenda da ADR-044): a janela bloqueada entra no histórico sem escrever no
  // chat — o mesmo frame faz a lista de rotinas e o histórico relerem, como a execução silenciosa.
  rotina_bloqueada: "rotina.executou",
  sala_handoff: "sala.handoff",
  negacao: "negacao",
  concessao_criada: "agente.mudou",
  agente_atualizado: "agente.mudou",
  parada: "parada.faixa",
  relato_criado: "relato.criado",
  ligacao_mudou: "ligacao.mudou",
  // definido em 2026-10-07 (ADR-083): o frame diz "os trabalhos deste bot mudaram"; a web relê por REST.
  trabalho_mudou: "trabalho.mudou",
  pressao_memoria: "memoria.mudou",
  // definido em 2026-10-18 (ADR-113): o frame diz "as reações desta fala mudaram"; a web relê a conversa por REST.
  reacao_mudou: "reacao.mudou",
  checkpoint_mudou: "checkpoint.mudou",
  conta_abrir: "conta.abrir",
  // NOD-442: o frame diz "este quadro mudou" (e quais cards); a web relê o quadro por REST e acende os cards.
  quadro_mudou: "quadro.mudou",
  // NOD-445: o frame diz "as páginas deste bot mudaram"; a web relê por REST.
  paginas_mudaram: "paginas.mudaram",
  // ADA-13: o frame diz "este canvas mudou"; a web relê por REST.
  canvas_mudou: "canvas.mudou",
  // Telemetria das linhas (#191): gravada sem outbox, nunca vira frame. A chave existe porque a tabela é total; se uma
  // linha dessas cair no outbox por engano, o frame inofensivo "agente.mudou" só faz a web reler o bot.
  linha_mostrada: "agente.mudou",
  linha_aberta: "agente.mudou",
  // NOD-422 (PR 2): a trilha do quadro vai só para events (sem outbox); a entrada existe porque a união é fechada.
  tarefa_movida: "agente.mudou",
  quadro_aberto: "agente.mudou",
  tarefa_aberta: "agente.mudou",
  conversa_aberta: "agente.mudou",
  quadro_consultado: "agente.mudou",
  quadro_avisou: "agente.mudou",
};

/** Os eventos de turno que mudam a execução de um card do quadro (os mesmos que viram `turno.iniciado/encerrado/interrompido`). */
const TURNO_DO_CARD: ReadonlySet<string> = new Set(["turno_criado", "turno_despachado", "turno_encerrado", "turno_interrompido"]);

export function frameDoEvento(kind: string): TipoFrame {
  const tipo = Object.hasOwn(FRAME_POR_EVENTO, kind) ? FRAME_POR_EVENTO[kind as KindEvento] : undefined;
  if (!tipo) throw new ErroDeDominio("entrada_invalida", { cause: `kind de evento sem frame: ${kind}` });
  return tipo;
}

export type ResultadoPassada = { publicados: number; falhas: number; abandonadosAgora: number };

export interface OpcoesDespacho {
  agora?: Relogio;
  metricas?: Metricas;
  teto?: number;
  idadeMinMs?: number;
  /** Itens lidos por pessoa por passada (default do repo: 100). */
  limite?: number;
  /** Varre abandono e atualiza a métrica nesta passada (o laço faz isso a cada `abandonoACadaMs`). */
  varrerAbandono?: boolean;
  /**
   * NOD-300 (definido em 2026-10-20): a presença das máquinas, para o estado do dono do `trabalho.mudou` dizer
   * "esperando" com a frente presa a máquina sem contato. Ausente = o estado de antes.
   */
  presenca?: Pick<ServicoDasMaquinas, "conectada" | "macDoServidor" | "identificar">;
  /**
   * definido em 2026-10-22 (NOD-218): modo "só ligações" da drenagem azul/verde. Publica no barramento local SEM marcar
   * entregue (nem contar tentativa, nem varrer abandono): quem marca é só a cor ativa, e os navegadores dela não perdem
   * nada. Cada item sai uma vez por processo (`vistos`, por id do outbox). Lê também o que a ativa já entregou desde
   * `desde` (hora do banco no início do modo): ela marca na hora e ganharia sempre a corrida dos pendentes.
   */
  soPublicar?: { vistos: Set<string>; desde: Date };
}

/** Uma pessoa, uma conexão já escopada: é a unidade que os testes exercitam sob withRollback. */
export async function despacharPessoa(conn: Conn, escopo: Escopo, barramento: Barramento, opcoes: OpcoesDespacho = {}): Promise<ResultadoPassada> {
  const metricas = opcoes.metricas ?? registroPadrao;
  const agora = (opcoes.agora ?? Date.now)();
  const repos = criarRepos(conn, escopo);
  const resultado: ResultadoPassada = { publicados: 0, falhas: 0, abandonadosAgora: 0 };

  const donos: CacheDosDonos = { estados: new Map(), escopo, ...(opcoes.presenca ? { servico: opcoes.presenca } : {}) };
  const soPublicar = opcoes.soPublicar;
  const itens = soPublicar
    ? await repos.outbox.paraPublicar({ desde: soPublicar.desde, excluir: [...soPublicar.vistos], limite: opcoes.limite })
    : await repos.outbox.pendentes(opcoes.limite);
  for (const item of itens) {
    if (soPublicar?.vistos.has(item.id)) continue;
    try {
      // ADR-099 (I10, definido em 2026-10-12): o `trabalho.mudou` leva o estado do dono do bot, lido na hora de publicar
      // (depois do commit de quem mudou): a web atualiza a linha do bot sem refazer a lista. Um por bot por passada.
      const extra = item.tipo === "trabalho_mudou" ? await estadoDoDonoNoFrame(conn, repos, agora, item.dados.agenteId, donos) : item.tipo === "turno_criado" ? await bastidoresNoFrame(conn, repos, item.turnoId, item.dados) : {};
      // conversaId/turnoId do evento vão no frame: é como a web sabe qual conversa reidratar (definido em 2026-09-16, L9).
      barramento.publicar(escopo.pessoaId, frameDoEvento(item.tipo), { ...item.dados, ...extra, kind: item.tipo, eventoId: item.eventoId, conversaId: item.conversaId, turnoId: item.turnoId });
      // NOD-443 (ADR-143): o quadro.mudou vai também a cada pessoa do quadro (o caso de uso põe `membros`). Só o aviso de
      // que mudou: cada uma relê o quadro pela porta, e a conversa da dona não vai junto.
      if (item.tipo === "quadro_mudou" && typeof item.dados.membros === "string" && item.dados.membros) {
        const { membros: _m, ...dados } = item.dados;
        for (const membro of item.dados.membros.split(",")) barramento.publicar(membro, frameDoEvento(item.tipo), { ...dados, kind: item.tipo, eventoId: item.eventoId, conversaId: null, turnoId: null });
      }
      // NOD-455 (revisão 5, achado M2): a execução do card (na fila, rodando, falhou) vem dos turnos, e os frames de turno
      // são da dona. Quem participa do quadro da tarefa do turno recebe só o aviso de que o card mudou (ids, sem a conversa
      // nem o turno da dona) e relê pela porta.
      if (TURNO_DO_CARD.has(item.tipo) && item.turnoId) {
        const doCard = await repos.quadros.membrosDoTurno(item.turnoId);
        for (const membro of doCard?.membros ?? []) barramento.publicar(membro, "quadro.mudou", { quadroId: doCard!.quadroId, tarefas: doCard!.tarefaId, kind: "quadro_mudou", eventoId: item.eventoId, conversaId: null, turnoId: null });
      }
      if (soPublicar) soPublicar.vistos.add(item.id);
      else await repos.outbox.marcarEntregue(item.id);
      resultado.publicados += 1;
    } catch (e) {
      if (soPublicar) {
        soPublicar.vistos.add(item.id);
        resultado.falhas += 1;
        continue;
      }
      await repos.outbox.incrementarTentativa(item.id);
      resultado.falhas += 1;
      log("aviso", "outbox_publicar_falhou", { outbox_id: item.id, tipo: item.tipo, tentativas: item.tentativas + 1, erro: e instanceof Error ? e.name : "desconhecido" });
    }
  }

  if (!soPublicar && (opcoes.varrerAbandono ?? true)) {
    resultado.abandonadosAgora = await repos.outbox.abandonar({ teto: opcoes.teto ?? OUTBOX_TETO_TENTATIVAS, idadeMinMs: opcoes.idadeMinMs ?? OUTBOX_IDADE_MIN_MS, agora });
    if (resultado.abandonadosAgora > 0) log("aviso", "outbox_abandonado", { n: resultado.abandonadosAgora });
    metricas.registrar({ metrica: "outbox_abandonados", tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId }, await repos.outbox.contarAbandonados());
  }
  return resultado;
}

/**
 * O estado do dono para o frame (ADR-099, I10). Ler não pode segurar o frame nem a transação do despacho: a leitura roda
 * num SAVEPOINT e, na falha, o frame sai sem o estado e a web relê por REST, como antes.
 */
type CacheDosDonos = {
  estados: Map<string, EstadoDoDono | null>;
  escopo: Escopo;
  servico?: Pick<ServicoDasMaquinas, "conectada" | "macDoServidor" | "identificar">;
  /** NOD-300: o resolver de presença, montado uma vez por passada (lido dentro do savepoint). */
  presenca?: PresencaDasMaquinas | undefined;
  presencaLida?: boolean;
};

async function estadoDoDonoNoFrame(conn: Conn, repos: ReturnType<typeof criarRepos>, agora: number, agenteId: unknown, cache: CacheDosDonos): Promise<{ estadoDono?: EstadoDoDono }> {
  if (typeof agenteId !== "string") return {};
  if (!cache.estados.has(agenteId)) {
    let estado: EstadoDoDono | null = null;
    try {
      await conn`savepoint estado_do_dono`;
      try {
        if (!cache.presencaLida) {
          cache.presenca = await presencaDasMaquinas({ repos, escopo: cache.escopo }, cache.servico);
          cache.presencaLida = true;
        }
        estado = await estadoDoDonoAgora({ repos, agora: () => agora }, agenteId, cache.presenca);
        await conn`release savepoint estado_do_dono`;
      } catch (e) {
        await conn`rollback to savepoint estado_do_dono`;
        throw e;
      }
    } catch (e) {
      log("aviso", "estado_do_dono_falhou", { agente_id: agenteId, erro: e instanceof Error ? e.name : "desconhecido" });
    }
    cache.estados.set(agenteId, estado);
  }
  const estado = cache.estados.get(agenteId);
  return estado ? { estadoDono: estado } : {};
}

/**
 * NOD-402 (ADR-130): o `turno_criado` diz se o turno é dos bastidores (rotina, colega, ou a retomada deles, que herda a
 * faixa com outra origem). São ~10 lugares que emitem o evento; a faixa já está no turno, então ela é lida aqui, na hora de
 * publicar (o turno foi gravado na mesma transação do evento). Como o estado do dono, num SAVEPOINT: a falha não segura o
 * frame — ele sai sem a marca e a web cai na origem (rotina/delegacao/peer).
 */
async function bastidoresNoFrame(conn: Conn, repos: ReturnType<typeof criarRepos>, turnoId: string | null, dados: Record<string, unknown>): Promise<{ bastidores?: true; criadoEm?: number }> {
  const marca = dados.bastidores === true ? { bastidores: true as const } : {};
  if (!turnoId) return marca;
  try {
    await conn`savepoint bastidores_do_turno`;
    try {
      const turno = await repos.turnos.buscar(turnoId);
      await conn`release savepoint bastidores_do_turno`;
      // A hora em que o turno nasceu (relógio do banco): a web trava a ordem do chat a partir dela, não da última fala.
      return { ...(turno?.bastidores && !turno.trabalhoId ? { bastidores: true as const } : marca), ...(turno ? { criadoEm: Math.max(turno.criadoEm, turno.acordarEm ?? 0) } : {}) };
    } catch (e) {
      await conn`rollback to savepoint bastidores_do_turno`;
      throw e;
    }
  } catch (e) {
    log("aviso", "bastidores_do_turno_falhou", { turno_id: turnoId, erro: e instanceof Error ? e.name : "desconhecido" });
    return marca;
  }
}

/**
 * Gauges por pessoa do ADR-017 que dependem de leitura no banco, coletadas no mesmo laço:
 *  - pendencia_mais_velha_s: idade da decisão pendente/reaberta mais velha em que a pessoa é a decisora;
 *  - custo_servidor_mes: nesta rodada não existe executor de servidor (Executor = 'local' | 'catcher',
 *    ADR-022/028 — o catcher é driver in-process sem custo), então o valor é 0 por construção.
 *    gastosRepo.somarMes(agora, executor) já filtra por executor (L9, pendência L8 §3); quando o
 *    executor de servidor existir, é `somarMes(agora, 'servidor')` aqui e o valor deixa de ser 0.
 */
export async function coletarGauges(conn: Conn, escopo: Escopo, agora: number, metricas: Metricas = registroPadrao): Promise<void> {
  const repos = criarRepos(conn, escopo);
  const abertas = (await repos.decisoes.listarSuaVez(agora)).filter((d) => d.estado === "pendente" || d.estado === "reaberta");
  const maisVelhaMs = abertas.reduce((max, d) => Math.max(max, agora - Date.parse(d.criadoEm)), 0);
  metricas.registrar({ metrica: "pendencia_mais_velha_s", tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId }, Math.floor(maisVelhaMs / 1000));
  metricas.registrar({ metrica: "custo_servidor_mes", tenant_id: escopo.tenantId }, 0);
}

export interface OpcoesLacoOutbox extends OpcoesDespacho, Pick<OpcoesLaco, "listarPessoas" | "aoFalhar"> {
  /**
   * definido em 2026-09-16: 250 ms entre passadas — abaixo do que uma pessoa percebe como atraso do frame.
   * revisto em 2026-10-09 (#218): é o passo CURTO, usado enquanto há trabalho. Fixo, eram ~345 mil transações por dia
   * com o Nod parado (4 passadas por segundo, uma transação por pessoa em cada).
   */
  intervaloMs?: number;
  /**
   * definido em 2026-10-09 (#218): o passo ocioso dobra a cada passada vazia, do curto até este teto (5 s). Linha
   * gravada neste processo acorda o despachante na hora (sinal-outbox.ts); de outro processo, espera no máximo isto.
   */
  ociosoMaxMs?: number;
  /**
   * definido em 2026-10-09 (#218): quanto o passo curto dura (5 s) depois de achar trabalho ou de um aviso — cobre o
   * commit de quem gravou (o aviso sai antes dele) e a rajada de frames de um turno, sem cair no passo longo no meio.
   */
  quenteMs?: number;
  /** definido em 2026-09-16: 30 s entre varreduras de abandono e coleta de gauges — a idade mínima é de 30 min. */
  abandonoACadaMs?: number;
}

export interface DespachanteOutbox {
  /** Uma passada completa por todas as pessoas (o laço chama; o teste pode chamar direto). */
  passada(): Promise<void>;
  /** Para o laço; espera a passada em voo. Também para o modo "só ligações". Definitivo: nada religa depois dele. */
  parar(): Promise<void>;
  /**
   * NOD-218 (drenagem azul/verde): para o laço normal (esperando a passada em voo) e passa a varrer só as pessoas de
   * `pessoas()`, publicando sem marcar entregue e sem repetir o id. Para de vez no `parar()`.
   * NOD-331: o `desde` é a hora do banco ANTES de esperar a passada em voo, e um `parar()` que chegou durante essa
   * espera vence (não liga o modo "só ligações").
   */
  soLigacoes(pessoas: () => { tenantId: string; id: string }[]): Promise<void>;
}

/**
 * `iniciar(db, barramento, {intervaloMs: 250})`: passa o POOL (paraCadaPessoa abre uma tx real por pessoa).
 * revisto em 2026-10-09 (#218): o passo é adaptativo — 250 ms com trabalho, dobrando até 5 s ocioso, e de volta a 250 ms
 * quando este processo grava no outbox (sinal-outbox.ts). Ocioso, menos de uma passada por segundo.
 */
export function iniciarDespachanteOutbox(db: Db, barramento: Barramento, opcoes: OpcoesLacoOutbox = {}): DespachanteOutbox {
  const intervaloMs = opcoes.intervaloMs ?? 250;
  const ociosoMaxMs = Math.max(intervaloMs, opcoes.ociosoMaxMs ?? 5_000);
  const quenteMs = opcoes.quenteMs ?? 5_000;
  const abandonoACadaMs = opcoes.abandonoACadaMs ?? 30_000;
  const agora = opcoes.agora ?? Date.now;
  const metricas = opcoes.metricas ?? registroPadrao;
  let ultimaVarredura = 0;
  let parado = false;
  // NOD-331: `parar()` é definitivo. Um `soLigacoes` que acorda depois dele (a drenagem venceu o prazo e o fechar()
  // chegou) não religa nada.
  let encerrado = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerVenceEm = 0;
  let emVoo: Promise<void> | null = null;
  // #218: o passo do próximo agendamento e até quando ele fica curto (relógio de parede: é tempo de timer, não de domínio).
  let passo = intervaloMs;
  let quenteAte = Date.now() + quenteMs;

  const passada = async (): Promise<void> => {
    const instante = agora();
    const varrer = instante - ultimaVarredura >= abandonoACadaMs;
    if (varrer) ultimaVarredura = instante;
    let achou = false;
    await paraCadaPessoa(
      db,
      async (escopo, tx) => {
        await tx(async (trx) => {
          const r = await despacharPessoa(trx, escopo, barramento, { ...opcoes, metricas, varrerAbandono: varrer });
          if (r.publicados + r.falhas > 0) achou = true;
          if (varrer) await coletarGauges(trx, escopo, instante, metricas);
        });
      },
      { listarPessoas: opcoes.listarPessoas, aoFalhar: opcoes.aoFalhar },
    );
    if (achou) quenteAte = Date.now() + quenteMs;
  };

  const agendarEm = (ms: number): void => {
    if (parado) return;
    timerVenceEm = Date.now() + ms;
    timer = setTimeout(() => {
      timer = null;
      emVoo = passada()
        .catch((e: unknown) => {
          log("erro", "despachante_outbox_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
        })
        .finally(() => {
          emVoo = null;
          agendar();
        });
    }, ms);
    timer.unref();
  };
  // Com trabalho (ou logo depois de um aviso), o passo curto; ocioso, o passo dobra até o teto.
  const agendar = (): void => {
    passo = Date.now() < quenteAte ? intervaloMs : Math.min(passo * 2, ociosoMaxMs);
    agendarEm(passo);
  };
  // Aviso de linha nova neste processo: volta ao passo curto. Uma passada em curso reagenda sozinha no `finally`.
  const pararDeOuvir = ouvirOutbox(() => {
    quenteAte = Date.now() + quenteMs;
    passo = intervaloMs;
    if (timer && timerVenceEm - Date.now() > intervaloMs) {
      clearTimeout(timer);
      timer = null;
      agendarEm(intervaloMs);
    }
  });
  agendarEm(intervaloMs);

  let pararSoLigacoes: (() => Promise<void>) | null = null;
  const pararLaco = async (): Promise<void> => {
    parado = true;
    pararDeOuvir();
    if (timer) clearTimeout(timer);
    timer = null;
    if (emVoo) await emVoo;
  };

  return {
    passada,
    async parar() {
      encerrado = true;
      await pararLaco();
      await pararSoLigacoes?.();
    },
    async soLigacoes(pessoas) {
      if (encerrado) return;
      // Hora do banco (a mesma do `entregue_em`), lida ANTES de esperar a passada em voo (NOD-331): o que a outra cor
      // entregou enquanto este processo esperava o tick também entra no `paraPublicar`. Um id que este processo mesmo
      // publicou nesse meio pode sair mais uma vez: é o mesmo "pelo menos uma vez" do despacho normal (ver o topo).
      // QA NOD-331: o banco falhando aqui (soluço na hora do SIGTERM) não pode rejeitar: o laço normal seguiria marcando
      // entregue e a drenagem cairia em exit(1) sem esperar a ligação. Sem a hora do banco, vale o relógio local com
      // folga (DESDE_SEM_BANCO_FOLGA_MS): sai algum frame repetido, nunca um a menos.
      const desde = await db<{ desde: Date }[]>`select now() as desde`.then(
        ([r]) => r?.desde ?? new Date(),
        (e: unknown) => {
          log("aviso", "despachante_so_ligacoes_sem_hora_do_banco", { erro: e instanceof Error ? e.name : "desconhecido" });
          return new Date(Date.now() - DESDE_SEM_BANCO_FOLGA_MS);
        },
      );
      await pararLaco();
      if (encerrado || pararSoLigacoes) return;
      const vistos = new Set<string>();
      let fim = false;
      let t: ReturnType<typeof setTimeout> | null = null;
      let voo: Promise<unknown> | null = null;
      const uma = async (): Promise<void> => {
        const lista = pessoas();
        if (!lista.length) return;
        await paraCadaPessoa(
          db,
          async (escopo, tx) => {
            await tx(async (trx) => {
              await despacharPessoa(trx, escopo, barramento, { ...opcoes, metricas, soPublicar: { vistos, desde } });
            });
          },
          { listarPessoas: async () => lista, aoFalhar: opcoes.aoFalhar },
        );
      };
      const proxima = (): void => {
        if (fim) return;
        t = setTimeout(() => {
          t = null;
          voo = uma()
            .catch((e: unknown) => log("erro", "despachante_so_ligacoes_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
            .finally(() => {
              voo = null;
              proxima();
            });
        }, intervaloMs);
        t.unref();
      };
      log("info", "despachante_so_ligacoes", { pessoas: pessoas().length });
      proxima();
      pararSoLigacoes = async () => {
        fim = true;
        if (t) clearTimeout(t);
        if (voo) await voo;
      };
    },
  };
}
