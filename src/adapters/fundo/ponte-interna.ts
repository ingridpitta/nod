import { createHash, timingSafeEqual } from "node:crypto";
import type { Executor, RuntimeEvent } from "../../contracts/evento.ts";
import { HARNESSES, type IdHarness } from "../../contracts/harness.ts";
import type { LimitesIa } from "../../contracts/inteligencia.ts";
import { MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../../contracts/inventario.ts";
import { estadoDaMaquina } from "../../domain/harness.ts";
import { iasNoLimite } from "../../domain/inteligencia.ts";
import { cotaDasIasComContas } from "../../domain/cota-da-ia.ts";
import type { IaComConta } from "../../contracts/contas-ia.ts";
import type { VinculoDaConta } from "../../domain/contas-da-pessoa.ts";
import type { ContaGuardadaNoServidor } from "../../repositories/contas-ia.repo.ts";
import { ESPERA_DECLINIO_MS } from "../../shared/constantes.ts";
import { iasSoNoutraMaquina, type LeituraDasContas } from "../../use-cases/contas-do-turno.ts";
import type { CotaDaIa } from "../../contracts/cota.ts";
import type { UsoDoPlano } from "../../contracts/uso-do-plano.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { AnuncioMaquina, Entrega, PastaParaLimpar, PedidoRenovar, PonteInterna, RelatoLimpeza, RespostaRenovar } from "../../contracts/ponte.ts";
import { abrirTxEscopada } from "../../db/tx.ts";
import { redigirECortar } from "../../domain/segredos.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import { listarTodas, type Pessoa } from "../../repositories/pessoas.repo.ts";
import { LEASE_MS } from "../../shared/constantes.ts";
import type { Db, Escopo, Relogio, Tx } from "../../shared/types.ts";
import { assentarTurno, type SaidaAssentarTurno } from "../../use-cases/assentar-turno.ts";
import { despacharTurno } from "../../use-cases/despachar-turno.ts";
import { avisarFundoSeguradoPelaCota, type EntradaFundoSegurado } from "../../use-cases/fundo-segurado-pela-cota.ts";
import { absorverNaSessao, confirmarNaSessao, gravarFalasDaSessao } from "../../use-cases/sessao-viva.ts";
import { absorverNoTrabalho, promoverNaRede } from "../../use-cases/coordenar-trabalhos.ts";
import { avisosDeRecadoLido, ofertarRecadosDoQuadro } from "../../use-cases/quadro-execucoes.ts";
import { avisoDaEtapaNaSessao } from "../../use-cases/etapa-presa.ts";
import { eventoPressao, sincronizarTrabalho } from "../../use-cases/trabalhos.ts";
import { camposDoRelato, pastaSemTrabalhoDoTurno, pastasParaLimpar, relatoValido } from "../../use-cases/limpeza-das-tasks.ts";
import { relatarEspera as relatarEsperaDaMaquina } from "../../use-cases/esperar-comando.ts";
import { relatarDesfazer as relatarDesfazerDaMaquina } from "../../use-cases/desfazer-turno.ts";
import type { DesfazerParaRodar, RelatoDesfazer } from "../../contracts/checkpoint.ts";
import type { EsperaParaRodar, RelatoEspera, RespostaRelatoEspera } from "../../contracts/espera.ts";
import { REDE_MS } from "../../domain/trabalho.ts";
import type { MudancaDePressao } from "./trabalhos-vivos.ts";
import type { LeituraDisco, LeituraMemoria, NivelPressao } from "../../contracts/trabalho.ts";
import type { UsoDoMac } from "../../contracts/raio-x.ts";
import { USO_DO_MAC_PADRAO } from "../../contracts/raio-x.ts";
import { ESPACO_FUNDO_MS, portaoDoMac } from "../../domain/memoria-mac.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import type { TokenTurno } from "../../services/token-turno.ts";

/** ADR-130: a fala da pessoa que esperou mais que isto para começar vira a linha `fala_esperou`. */
const FALA_ESPEROU_MS = 10_000;

/** definido em 2026-09-16: versão mínima do app = a do package.json desta rodada; a ponte HTTP compara quando entrar (ADR-021). */
export const VERSAO_MINIMA_APP = "0.1.0";

export type DepsPonte = {
  services: Services;
  useCases: UseCasesNod;
  agora?: Relogio;
  /** 'local' (claude-cli) ou 'catcher' — o que a máquina conectada de fato roda. Função = valor VIVO (o interruptor de executor troca em tempo de execução). */
  executor?: Executor | (() => Executor);
  /** Fonte das pessoas para resolver tenant de um pessoaId; só em teste (default: tabela pessoas). */
  listarPessoas?: () => Promise<Pick<Pessoa, "tenantId" | "id">[]>;
  /** Depois de entregar: soltar o processo do interruptor (criarInterruptor().esquecer). */
  esquecerTurno?: (turnoId: string) => void;
  /**
   * definido em 2026-09-16 (composição L9): roda na MESMA tx logo depois de assentarTurno, com as Deps e
   * a saída, e devolve eventos a gravar — é onde a rotina registra desfecho (registrarDesfechoRotina) e o
   * turno peer entrega a resposta (entregarRespostaPeer), sem a ponte importar casos de uso da L7.
   */
  depoisDeAssentar?: (deps: Deps, p: { entrega: Entrega; saida: SaidaAssentarTurno }) => Promise<RuntimeEvent[]>;
  /**
   * definido em 2026-10-05: `false` na ponte das máquinas remotas — o motivo cru que o Mac manda vai para o diagnóstico
   * gravado da pessoa e NUNCA para o log do servidor (decisão de 2026-09-17 em ponte-validacao.ts). Padrão: loga (o
   * executor do próprio processo, em desenvolvimento).
   */
  erroCruNoLog?: boolean;
  /**
   * NOD-171: os harnesses de todas as máquinas vivas da pessoa (na ponte HTTP, `harnessesDaPessoa` das conexões).
   * Somados aos das máquinas desta ponte, deixam o despacho recusar o turno fixado num harness que nenhuma tem pronto.
   */
  harnessesDaPessoa?: (pessoaId: string) => Partial<Record<IdHarness, Inventario>>;
  /**
   * NOD-268 / ADR-108 (revisão do PR 2, C5): as IAs prontas em cada máquina da pessoa conectada noutras pontes (no modo
   * compartilhado cada máquina tem a sua). Somadas às máquinas desta ponte.
   */
  prontosPorMaquina?: (pessoaId: string) => Readonly<Record<string, readonly IdHarness[]>>;
  /** ADR-083 (#193): o turno já chamou alguma ferramenta? (o compositor sabe pelo `turno.atividade`). Ausente = não. */
  fezFerramenta?: (turnoId: string) => boolean;
  /** ADR-083 (#194): guarda a leitura de memória do Mac e diz se o nível que a pessoa vê mudou. */
  registrarMemoria?: (pessoaId: string, machineId: string, leitura: LeituraMemoria) => MudancaDePressao;
  /** ADR-085: a última leitura viva deste Mac (memória, processador e, #219, disco); null = sem leitura, e nada é segurado. */
  pressaoDaMaquina?: (machineId: string) => { memoria: NivelPressao; processador: NivelPressao | null; uso?: number | null; carga?: number | null; disco?: LeituraDisco | null; discoNivel?: NivelPressao | null } | null;
  /** Revisão do #209: o evento da mudança de pressão não foi gravado (a tx desfez) — a próxima leitura refaz o frame. */
  desfazerMemoria?: (pessoaId: string, mudanca: MudancaDePressao) => void;
  /** Revisão do #209: o Mac desconectou — a leitura dele sai. */
  esquecerMaquina?: (machineId: string) => void;
  /** ADR-085: quando a pessoa trocou o "uso do Mac" (gravado); o que foi lido antes não vale mais. Ausente = 0. */
  usoTrocadoEm?: (pessoaId: string) => number;
  /**
   * 0068 (emenda da ADR-036): quando o limite de alguma IA da pessoa mudou (gravado), em QUALQUER ponte — no modo
   * compartilhado há uma por Mac, e o limite que uma grava vale para a fila das outras. Ausente = 0.
   */
  limitesTrocadosEm?: (pessoaId: string) => number;
  /** 0068: esta ponte gravou (ou tirou) um limite: as outras releem, e a tela da pessoa é avisada. */
  limiteMudou?: (pessoaId: string) => void;
  /** Só o e2e (definido em 2026-10-08): a rede de 2 min com outro prazo, para não esperar 120 s. Ausente = REDE_MS. */
  redeMs?: number;
  /**
   * ADR-092: a ponte de uma máquina remota com o servidor no Mac (modo local). Ela só pega o turno que tem a máquina como
   * alvo (o bot escolhido para ela, ou o padrão da pessoa); o resto é do Mac, onde estão os arquivos dos bots.
   */
  soComoAlvo?: boolean;
  /**
   * definido em 2026-10-20 (NOD-301): ligado só no modo compartilhado (compor.ts). A máquina sem conta livre da IA deixa
   * passar o turno sem alvo por até ESPERA_DECLINIO_MS quando outra máquina viva da pessoa tem conta livre dela
   * (iasSoNoutraMaquina). No modo local a VM só pega turno com ela como alvo (ADR-092 §2): declinar ali só atrasaria a fala.
   */
  declinarSemAlvo?: boolean;
  /**
   * NOD-214 (carência do lease no boot): quando este processo começou. Nos primeiros LEASE_MS daqui, a adoção aceita o
   * turno de lease vencido que segue `despachando` — o lease venceu enquanto o servidor estava fora, não a máquina.
   * Ausente = sem carência (o modo local: lá o reinício é o nod fechado).
   */
  inicioDoProcesso?: number;
  /**
   * NOD-279 (C15, definido em 2026-10-15): `NOD_FUNDO_LINUX_SO_VERMELHA=1` (lida em compor.ts; desligada por padrão até a
   * linha de base da VM). Ligada, a máquina `linux` só segura o fundo novo por memória ou processador em vermelha
   * (`RegraDaPlataforma` em memoria-mac.ts). Ausente = a regra de antes em toda plataforma.
   */
  fundoLinuxSoVermelha?: boolean;
};

/**
 * NOD-214: o que a máquina apresenta para o processo novo reconhecer um turno que ela continuou rodando.
 * `para` (definido em 2026-10-15, NOD-245/NOD-252): `rodar` (a renovação; padrão) renova o lease e recusa o turno com
 * Parar pendente — o CLI deve parar; `assentar` (a entrega) só confere token e máquina: não renova o lease (o turno já
 * acabou no Mac) e aceita o Parar pendente, que o assentamento lê (`desfechoDaEntrega`) e transforma em `parado_pela_pessoa`.
 */
export type PedidoAdocao = { pessoaId: string; turnoId: string; machineId: string; token: string; para?: "rodar" | "assentar" };
/**
 * NOD-214: `adotado` traz o plano (recomposto) para a conexão; `ja_assentado` = o turno desta máquina já foi assentado
 * (a entrega dela é idempotente); `recusado` = nada a adotar (token de outro turno, outra máquina, turno parado).
 */
export type DesfechoAdocao = { tipo: "adotado"; plano: PlanoTurno } | { tipo: "ja_assentado" } | { tipo: "recusado" };

export type PonteInternaNod = PonteInterna & {
  maquinasConectadas(): AnuncioMaquina[];
  escopoDoTurno(turnoId: string): Escopo | null;
  /** Quantos turnos cada mapa da ponte guarda (revisão do épico, S21): o log de saúde e os testes olham por aqui. */
  emMemoria?(): { escopos: number; oferecidas: number; despachados: number };
  /** NOD-214: reconhece o turno despachado por um processo anterior (rotas/ponte.ts, header x-nod-token-turno). */
  adotar?(p: PedidoAdocao): Promise<DesfechoAdocao>;
};

/** definido em 2026-10-08 (revisão do épico, S20): o assentar vítima de impasse é repetido até isto de vezes. */
const TENTATIVAS_DO_ASSENTAR = 3;
/**
 * ADR-085 (revisão do #209): o "uso do Mac" lido vale 30 s no puxar. A troca pela tela vale na hora (`usoTrocadoEm`); os
 * 30 s só cobrem quem mudou por fora da rota (direto no banco).
 */
export const USO_VALE_MS = 30_000;
/**
 * 0068: os limites das IAs lidos valem 30 s no puxar, como o "uso do Mac" — um limite gravado por qualquer ponte vale na
 * hora (`limitesTrocadosEm`); os 30 s só cobrem o prazo que vence sozinho (que já é comparado com o relógio, não lido).
 */
export const LIMITES_VALEM_MS = 30_000;

/** O que a ponte guarda por pessoa por LIMITES_VALEM_MS: limites, leituras da cota e (NOD-253) as contas da lista. */
type LimitesLidos = {
  limites: LimitesIa;
  usos: UsoDoPlano[];
  usosPorConta: UsoDoPlano[];
  contas: { contas: ContaGuardadaNoServidor[]; vinculos: VinculoDaConta[]; escolhidas: Partial<Record<IaComConta, string>>; chaves?: LeituraDasContas["chaves"] } | null;
  ate: number;
  lidoEm: number;
};

/**
 * definido em 2026-10-20 (NOD-293, E9): a mensagem oferecida ao app e não confirmada há mais que isto é dada por perdida
 * (a resposta da renovação não chegou: reinício do servidor, rede) e volta a ser oferecida. O laço do app descarta a que
 * já escreveu na sessão (`escritas`) e só a confirma de novo; a renovação dele com mensagem sai a cada poucos segundos.
 */
export const REOFERTA_MS = 10_000;

/** NOD-293 (E9): tira do "oferecidas" o que foi oferecido há mais de REOFERTA_MS — volta a ser oferecido nesta renovação. */
export function soltarOferecidasPerdidas(oferecidas: Map<string, number>, agora: number): void {
  for (const [id, em] of oferecidas) if (agora - em > REOFERTA_MS) oferecidas.delete(id);
}

/** 40P01 (impasse) e 40001 (serialização): a transação perdeu a corrida e pode ser repetida inteira. */
function ehConflitoTransitorio(err: unknown): boolean {
  const codigo = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return codigo === "40P01" || codigo === "40001";
}

/**
 * PonteInterna in-process (ADR-021, EMENDA 3): os cinco verbos falados por chamada de função, sem
 * socket. puxar abre a tx ESCOPADA da pessoa (abrirTxEscopada) e roda despacharTurno; renovar renova o
 * lease e grava os eventos da máquina pelo outbox; entregar assenta. O escopo de cada turno puxado fica
 * em memória: renovar/entregar de turno desconhecido (de antes de um reinício) é fail-closed —
 * {ativo:false} / entrega descartada com log — e o varredor de lease encerra o turno órfão.
 */
export function criarPonteInterna(db: Db, deps: DepsPonte): PonteInternaNod {
  const agora: Relogio = deps.agora ?? (() => Date.now());
  const executorAtual = (): Executor => (typeof deps.executor === "function" ? deps.executor() : (deps.executor ?? "catcher"));
  const maquinas = new Map<string, AnuncioMaquina>();
  const escopos = new Map<string, Escopo>();
  /** Executor do PLANO de cada turno puxado: a entrega assenta com ele, não com o executor vigente (que pode ter sido trocado no meio). */
  const executores = new Map<string, Executor>();
  /** Harness do plano puxado (0030): a sessão que o turno devolver é deste harness. */
  const harnesses = new Map<string, IdHarness>();
  const tenantsPorPessoa = new Map<string, string>();
  /** ADR-067: o maior `seq` de fala intermediária já gravado por turno (some na entrega). */
  const falasGravadas = new Map<string, number>();
  /**
   * #189: as mensagens da fila já entregues ao app neste turno e ainda não confirmadas — não vão de novo na próxima
   * renovação. Somem na entrega; a não confirmada continua `pendente` no banco e vira turno próprio.
   * NOD-293 (E9): por id, o instante da oferta — passado REOFERTA_MS sem confirmação, ela é oferecida de novo.
   */
  const oferecidas = new Map<string, Map<string, number>>();
  /**
   * ADR-083 (#193): quando o turno foi puxado e a sessão que o plano retomou (nula se ele bifurcou ou começou uma) —
   * a rede de 2 min promove o turno de conversa e entrega essa sessão ao trabalho `rede`. Somem na entrega.
   * ADR-099 (I8, 2026-10-12): e o modo do plano — a retomada do dono só é promovida em modo conversa.
   */
  const despachados = new Map<string, { em: number; sessaoCli: string | null; bifurcou: boolean; modo: PlanoTurno["modoTurno"] | null; conta?: string | null }>();
  /**
   * Revisão do épico (S21, 2026-10-08): a última vez que o turno foi puxado ou renovado. Passado o lease sem notícia, o
   * varredor de lease o encerra no banco e a entrega talvez nunca chegue: `oferecidas` e `despachados` dele saem aqui
   * (o escopo fica: a entrega tardia ainda assenta, ADR-045). Antes só a entrega os limpava.
   */
  const vistos = new Map<string, number>();
  /** 2026-11-10 (ADR-142): o aviso da etapa movida já entregue a cada turno (a chave da mudança): entra uma vez só. */
  const avisosDeEtapa = new Map<string, string>();
  /**
   * NOD-245: os turnos que a ENTREGA adotou (`adotar` com `para: "assentar"`) — o processo que os despachou caiu antes de
   * eles terminarem. O assentamento lê daqui (`adotada`); sai com a entrega ou com o lease vencido (`esquecerVencidos`).
   */
  const adotadosNaEntrega = new Set<string>();
  /**
   * ADR-085 (revisão do #209): o "uso do Mac" de cada pessoa, lido no máximo a cada USO_VALE_MS e fora da tx do puxar
   * (antes era uma consulta por puxar apertado, dentro da trava da fila; e um erro dela virava "nenhum trabalho").
   */
  const usos = new Map<string, { uso: UsoDoMac; ate: number; lidoEm: number }>();
  /**
   * 0068: os limites das IAs de cada pessoa, lidos fora da tx do puxar (como o uso do Mac). ADR-099 §7 (2026-10-12): junto,
   * o uso do plano que cada CLI informou (a cota), na mesma leitura e no mesmo prazo de 30 s.
   */
  const limitesLidos = new Map<string, LimitesLidos>();
  /** ADR-099 §7: o que a cota segura em cada pessoa agora — o log `cota_segura` sai só na mudança. */
  const cotaVista = new Map<string, string>();
  /** NOD-301: as IAs que cada máquina de cada pessoa (`machineId pessoaId`) declina agora — o log sai só na mudança. */
  const declinioVisto = new Map<string, string>();
  /** ADR-085 (revisão do #209): quando o último trabalho novo em segundo plano começou em cada Mac (o espaço entre eles). */
  const ultimoFundo = new Map<string, number>();
  /**
   * ADR-085 (revisão do #209): se cada Mac está segurando agora, e por quê (#219) — o log sai só na mudança. Corrigido em
   * 2026-10-09: por Mac E pessoa (`machineId pessoaId`) — no modo local duas pessoas puxam do mesmo Mac com usos
   * diferentes, e a chave só do Mac fazia o log alternar segurado/solto a cada puxar.
   */
  const segurando = new Map<string, string>();
  /**
   * NOD-302: quando cada máquina de cada pessoa (`machineId pessoaId`) olhou pela última vez o fundo que a cota segura (a
   * nota "Seguir com…" e a linha a quem pediu): no máximo uma vez por leitura da cota (LIMITES_VALEM_MS), não a cada puxar.
   */
  const fundoSeguradoVisto = new Map<string, number>();

  /** NOD-302: o aviso do fundo segurado numa tx própria — a falha só loga, o despacho já comitou. */
  async function avisarFundoSegurado(escopo: Escopo, entrada: EntradaFundoSegurado): Promise<void> {
    const chave = `${entrada.machineId} ${escopo.pessoaId}`;
    if (agora() - (fundoSeguradoVisto.get(chave) ?? -Infinity) < LIMITES_VALEM_MS) return;
    fundoSeguradoVisto.set(chave, agora());
    try {
      await abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        const events = await avisarFundoSeguradoPelaCota(d, entrada);
        if (events.length) await d.repos.events.gravarComOutbox(events);
      });
    } catch (e) {
      log("aviso", "fundo_segurado_aviso_falhou", { pessoa_id: escopo.pessoaId, machine_id: entrada.machineId, erro: e instanceof Error ? e.name : "desconhecido" });
    }
  }
  function esquecerVencidos(): void {
    const limite = agora() - LEASE_MS;
    for (const [turnoId, em] of vistos) {
      if (em >= limite) continue;
      vistos.delete(turnoId);
      avisosDeEtapa.delete(turnoId);
      oferecidas.delete(turnoId);
      despachados.delete(turnoId);
      adotadosNaEntrega.delete(turnoId);
    }
  }

  /** NOD-171: os harnesses das máquinas desta ponte somados aos da pessoa nas outras conexões; o pronto vence. */
  function harnessesDaPessoa(pessoaId: string): Partial<Record<IdHarness, Inventario>> {
    const todos: Partial<Record<IdHarness, Inventario>> = { ...(deps.harnessesDaPessoa?.(pessoaId) ?? {}) };
    for (const m of maquinas.values()) for (const [h, inv] of Object.entries(m.harnesses ?? {})) {
      const id = h as IdHarness;
      if (inv && todos[id]?.estado !== "pronto") todos[id] = inv;
    }
    return todos;
  }

  /** NOD-268 / revisão do PR 2 (C5): as IAs prontas de cada máquina conectada da pessoa (as desta ponte e as das outras). */
  function prontosPorMaquina(pessoaId: string): Record<string, IdHarness[]> {
    const todos: Record<string, IdHarness[]> = Object.fromEntries(Object.entries(deps.prontosPorMaquina?.(pessoaId) ?? {}).map(([id, ias]) => [id, [...ias]]));
    for (const m of maquinas.values()) todos[m.machineId] = (Object.entries(m.harnesses ?? {}) as [IdHarness, Inventario | undefined][]).filter(([, i]) => i?.estado === "pronto").map(([id]) => id);
    return todos;
  }

  /** S15 (2026-10-08): a máquina anunciou que bifurca sessão com este harness. Ausente (app antigo) = não. */
  function maquinaBifurcaCom(machineId: string, harness: string | null): boolean {
    return harness !== null && maquinas.get(machineId)?.capacidades?.[harness as IdHarness]?.bifurcaSessao === true;
  }

  /** 2026-11-09: a versão que a máquina anunciou (x-nod-versao), para a frase do erro e o Raio-X. Ausente = não anunciou. */
  function versaoDoApp(machineId: string): { versaoApp?: string } {
    const v = maquinas.get(machineId)?.versaoApp;
    return typeof v === "string" && v !== "" ? { versaoApp: v } : {};
  }

  async function resolverEscopo(pessoaId: string): Promise<Escopo | null> {
    if (!tenantsPorPessoa.has(pessoaId)) {
      const pessoas = await (deps.listarPessoas ? deps.listarPessoas() : listarTodas(db));
      for (const p of pessoas) tenantsPorPessoa.set(p.id, p.tenantId);
    }
    const tenantId = tenantsPorPessoa.get(pessoaId);
    return tenantId ? { tenantId, pessoaId } : null;
  }

  /**
   * definido em 2026-10-05: o turno voltou dizendo que a CONTA desta IA não serve (logada e sem acesso). A IA sai do
   * inventário desta máquina na hora — o próximo despacho já não a escolhe — e a resposta é a outra IA pronta, se
   * houver (o turno em "automático" é repetido nela, assentar-turno.ts). O app do Mac reanuncia com o veredito dele;
   * isto cobre o intervalo e o app antigo, que continuaria anunciando "pronto" pela conferência de login.
   */
  function reprovarHarness(machineId: string, harness: IdHarness, causa: CausaSemIa): IdHarness | null {
    const m = maquinas.get(machineId);
    if (!m) return null;
    const reprovado: Inventario = { estado: "nao_autenticado", causa, motivo: MOTIVO_DA_CAUSA[causa], em: agora() };
    const todos: Partial<Record<IdHarness, Inventario>> = { ...(m.harnesses ?? { "claude-cli": m.inventario }), [harness]: reprovado };
    // #313: a máquina segue pronta pela outra IA pronta — a mesma regra do anúncio (estadoDaMaquina).
    const inventario = estadoDaMaquina(reprovado, todos);
    const outra = inventario === reprovado ? null : (HARNESSES.find((h) => todos[h.id] === inventario)?.id ?? null);
    maquinas.set(machineId, { ...m, harnesses: todos, inventario });
    log("aviso", "ia_reprovada_no_turno", { machine_id: machineId, harness, causa, outra });
    return outra;
  }

  async function usoDoMac(escopo: Escopo): Promise<UsoDoMac> {
    const guardado = usos.get(escopo.pessoaId);
    if (guardado && guardado.ate > agora() && guardado.lidoEm > (deps.usoTrocadoEm?.(escopo.pessoaId) ?? 0)) return guardado.uso;
    try {
      const lidoEm = agora();
      const uso = (await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).preferencias.buscar())).usoDoMac ?? USO_DO_MAC_PADRAO;
      usos.set(escopo.pessoaId, { uso, ate: lidoEm + USO_VALE_MS, lidoEm });
      return uso;
    } catch (e) {
      log("aviso", "uso_do_mac_sem_leitura", { pessoa_id: escopo.pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
      return guardado?.uso ?? USO_DO_MAC_PADRAO;
    }
  }

  /**
   * 0068: as IAs da pessoa no limite agora; ADR-099 §7: e as que a cota segura (reserva ou limite). Sem leitura (erro do
   * banco), a última que deu certo, ou nenhuma.
   */
  async function limitesECotaDe(escopo: Escopo, machineId: string): Promise<{ noLimite: IdHarness[]; cota: CotaDaIa[]; leituraContas: LeituraDasContas | null }> {
    const guardado = limitesLidos.get(escopo.pessoaId);
    // NOD-253 (2026-10-15): a cota da IA com conta da lista olha a conta que o turno desta máquina usaria.
    const de = (g: LimitesLidos | undefined) => {
      const naMaquina = new Set((g?.contas?.vinculos ?? []).filter((v) => v.maquinaId === machineId && v.estado === "pronta" && v.sairPedidoEm === null).map((v) => v.contaId));
      const contas = g?.contas ? { contas: g.contas.contas, naMaquina, escolhidas: g.contas.escolhidas } : null;
      // NOD-301: a leitura inteira (com as chaves das máquinas) para o declínio do turno sem alvo.
      const leituraContas: LeituraDasContas | null = g?.contas?.chaves ? { contas: g.contas.contas, vinculos: g.contas.vinculos, escolhidas: g.contas.escolhidas, chaves: g.contas.chaves } : null;
      return { noLimite: iasNoLimite(g?.limites, agora()), cota: cotaDasIasComContas({ usos: g?.usos ?? [], usosPorConta: g?.usosPorConta ?? [], limites: g?.limites, contas, agora: agora() }), leituraContas };
    };
    if (guardado && guardado.ate > agora() && guardado.lidoEm > (deps.limitesTrocadosEm?.(escopo.pessoaId) ?? 0)) return de(guardado);
    try {
      const lidoEm = agora();
      const lido = await abrirTxEscopada(db, escopo)(async (trx): Promise<LimitesLidos> => {
        const repos = criarRepos(trx, escopo);
        // NOD-301: as chaves das máquinas só no modo que declina (o contato recente decide quem está viva).
        const [preferencias, usos, usosPorConta, lista, { escolhidas }, chaves] = await Promise.all([repos.preferencias.buscar(), repos.usoDoPlano.listar(), repos.usoDoPlano.listarPorConta(), repos.contasIa.listar(), repos.contasIa.modo(), deps.declinarSemAlvo === true ? repos.maquinaTokens.listar() : Promise.resolve(undefined)]);
        return { limites: preferencias.iasNoLimite ?? {}, usos, usosPorConta, contas: { contas: lista.contas, vinculos: lista.vinculos, escolhidas, ...(chaves ? { chaves } : {}) }, ate: lidoEm + LIMITES_VALEM_MS, lidoEm };
      });
      limitesLidos.set(escopo.pessoaId, lido);
      return de(lido);
    } catch (e) {
      log("aviso", "limites_ia_sem_leitura", { pessoa_id: escopo.pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
      return de(guardado);
    }
  }

  function depsDe(trx: Tx, escopo: Escopo): Deps {
    return { repos: criarRepos(trx, escopo), services: deps.services, useCases: deps.useCases, tx: (fn) => fn(trx), escopo, agora };
  }

  /**
   * NOD-214: o serviço de token completo (o contrato só tem cunhar/autorizar/revogar). Nos testes que injetam um token
   * mínimo, os métodos novos faltam — e a ponte segue como antes: sem credencial no banco, sem adoção.
   */
  const tokens = deps.services.tokenTurno as Partial<TokenTurno> & Services["tokenTurno"];
  const dentroDaCarencia = (): boolean => deps.inicioDoProcesso !== undefined && agora() < deps.inicioDoProcesso + LEASE_MS;

  /** NOD-214: o token saiu (entrega, falha) — a credencial no banco também, na mesma tx do assentar quando há uma. */
  async function apagarCredencial(escopo: Escopo, turnoId: string): Promise<void> {
    await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).turnoCredenciais.apagar(turnoId))
      .catch((e: unknown) => log("aviso", "credencial_turno_nao_apagada", { turno_id: turnoId, erro: e instanceof Error ? e.name : "desconhecido" }));
  }

  return {
    async conectar(m) {
      maquinas.set(m.machineId, m);
    },

    async desconectar(machineId) {
      maquinas.delete(machineId);
      ultimoFundo.delete(machineId);
      for (const chave of segurando.keys()) if (chave.startsWith(`${machineId} `)) segurando.delete(chave);
      deps.esquecerMaquina?.(machineId);
      for (const chave of declinioVisto.keys()) if (chave.startsWith(`${machineId} `)) declinioVisto.delete(chave);
    },

    async puxar(pessoaId, leituraDoMac, opcoes): Promise<PlanoTurno | null> {
      esquecerVencidos();
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return null;
      const maquina = maquinas.values().next().value;
      if (!maquina) return null;
      // ADR-085: a leitura que veio no puxar entra como a da renovação; a mudança de nível vira o mesmo frame.
      const mudanca = leituraDoMac ? deps.registrarMemoria?.(pessoaId, maquina.machineId, leituraDoMac) : undefined;
      // ADR-085: sem leitura deste Mac (app antigo, fora do macOS) nada é segurado nem espaçado.
      const pressao = deps.pressaoDaMaquina?.(maquina.machineId) ?? null;
      const uso = pressao ? await usoDoMac(escopo) : "livre";
      // 0068: só a máquina que anuncia as IAs (o app novo) escolhe pela ordem e pelo limite. ADR-099 §7: a cota vale para
      // qualquer máquina (sem a lista de IAs, a de sempre).
      const lidos = await limitesECotaDe(escopo, maquina.machineId);
      const noLimite = maquina.harnesses ? lidos.noLimite : [];
      const cota = lidos.cota;
      const cotaAgora = cota.map((c) => `${c.ia}:${c.situacao}`).join(" ");
      if ((cotaVista.get(pessoaId) ?? "") !== cotaAgora) {
        cotaVista.set(pessoaId, cotaAgora);
        // Para medir o gatilho de reversão da ADR-099 (a conversa parada por cota mesmo com a reserva).
        log("info", cotaAgora ? "cota_segura" : "cota_solta", { pessoa_id: pessoaId, ias: cotaAgora, volta_em: cota.length ? Math.max(...cota.map((c) => c.voltaEm)) : null });
      }
      // #219 (emenda à ADR-085): o disco crítico segura TODO trabalho novo (`segurarNovo`), em qualquer uso; a memória
      // crítica segura o segundo plano sem a espera máxima (`fundoSemPrazo`); o resto é o de antes (só o segundo plano).
      // NOD-279 (C15): a máquina sem plataforma anunciada é o app do Mac anterior ao campo (ADR-090): darwin.
      const plataforma = maquina.plataforma ?? "darwin";
      const portao = portaoDoMac(uso, pressao, { plataforma, linuxSoVermelha: deps.fundoLinuxSoVermelha === true });
      const segurarFundo = portao.fundo !== null;
      const segurarNovo = portao.tudoNovo !== null;
      const fundoSemPrazo = portao.semPrazo;
      const espacarFundo = uso !== "livre" && agora() - (ultimoFundo.get(maquina.machineId) ?? -Infinity) < ESPACO_FUNDO_MS;
      const situacao = segurarNovo ? `tudo:${portao.tudoNovo}` : segurarFundo ? `fundo:${portao.fundo}${fundoSemPrazo ? ":sem-prazo" : ""}` : "";
      const chaveSegurando = `${maquina.machineId} ${pessoaId}`;
      if ((segurando.get(chaveSegurando) ?? "") !== situacao) {
        segurando.set(chaveSegurando, situacao);
        log("info", situacao ? "fundo_segurado" : "fundo_solto", { pessoa_id: pessoaId, machine_id: maquina.machineId, plataforma, uso, motivo: portao.fundo, tudo_novo: segurarNovo, sem_prazo: fundoSemPrazo, memoria: pressao?.memoria ?? null, processador: pressao?.processador ?? null, uso_cpu: pressao?.uso ?? null, carga: pressao?.carga ?? null, disco_livre_mb: pressao?.disco?.livreMb ?? null });
      }
      const antes = agora();
      // definido em 2026-10-05 (NOD-175): o token nasce dentro da tx (emitir-plano-turno). Se algo falha depois do
      // `cunhar` (composição, outbox, commit), o turno volta a `pendente` e ninguém recebe o plano: o token cunhado
      // aqui é revogado, senão ele conta em `ativos()` para sempre e segura a drenagem do SIGTERM até o prazo.
      // Embrulha `planos.emitir` (é por ele que o despacho cunha), não `tokenTurno.cunhar`: o emitir composto em
      // compor.ts usa os services do fechamento e não veria um cunhar trocado aqui.
      const emitidos: string[] = [];
      const planos = deps.services.planos;
      const services: Services = { ...deps.services, planos: { ...planos, emitir: (trx, turnoId, machineId) => (emitidos.push(turnoId), planos.emitir(trx, turnoId, machineId)) } };
      // NOD-302: a mesma entrada do despacho serve ao aviso do fundo segurado (o mesmo portão da cota).
      const porMaquina = prontosPorMaquina(pessoaId);
      // NOD-301: as IAs que só têm conta livre noutra máquina viva (o `reivindicar` deixa passar o turno sem alvo delas).
      const soNoutraMaquina = deps.declinarSemAlvo === true && maquina.harnesses ? iasSoNoutraMaquina(lidos.leituraContas, { machineId: maquina.machineId, agora: agora(), noLimite: lidos.noLimite, prontosPorMaquina: porMaquina }) : [];
      const declinioAgora = soNoutraMaquina.join(" ");
      const chaveDeclinio = `${maquina.machineId} ${pessoaId}`;
      if ((declinioVisto.get(chaveDeclinio) ?? "") !== declinioAgora) {
        declinioVisto.set(chaveDeclinio, declinioAgora);
        log("info", "declinio_sem_alvo_mudou", { pessoa_id: pessoaId, machine_id: maquina.machineId, ias: declinioAgora, espera_ms: ESPERA_DECLINIO_MS });
      }
      const entradaDaCota: EntradaFundoSegurado = { machineId: maquina.machineId, executor: executorAtual(), harnessesProntos: maquina.harnesses ? Object.entries(maquina.harnesses).filter(([, i]) => i.estado === "pronto").map(([id]) => id) : undefined, harnessesDaPessoa: maquina.harnesses ? harnessesDaPessoa(pessoaId) : undefined, ...(noLimite.length ? { noLimite } : {}), ...(cota.length ? { cota } : {}) };
      let filaVazia = false;
      try {
        const plano = await abrirTxEscopada(db, escopo)(async (trx) => {
          const d = { ...depsDe(trx, escopo), services };
          if (mudanca?.mudou && leituraDoMac) await d.repos.events.gravarComOutbox([eventoPressao(d, mudanca, leituraDoMac)]);
          const r = await despacharTurno(d, { ...entradaDaCota, segurarFundo, segurarNovo, fundoSemPrazo, espacarFundo, prontosPorMaquina: porMaquina, ...(soNoutraMaquina.length ? { soNoutraMaquina } : {}), inventario: maquina.inventario, aceitaLigacao: maquina.ligacao === true, ...(deps.soComoAlvo ? { soComoAlvo: true } : {}), ...(opcoes?.soDaPessoa ? { soDaPessoa: true } : {}) });
          filaVazia = r.data.motivo === "fila_vazia";
          if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
          if (r.data.plano) {
            // ADR-130: quanto a fala da pessoa esperou para começar (o gatilho da ADR). Só a que esperou mais de 10 s vira
            // linha: o normal é sair em poucos segundos.
            const t = r.data.turno;
            if (t.origem === "conversa" && t.mensagemOrigemId && agora() - t.criadoEm > FALA_ESPEROU_MS) log("aviso", "fala_esperou", { pessoa_id: pessoaId, machine_id: maquina.machineId, turno_id: t.id, conversa_id: t.conversaId, espera_ms: agora() - t.criadoEm, drenando: opcoes?.soDaPessoa === true });
            vistos.set(r.data.plano.turnoId, agora());
            despachados.set(r.data.plano.turnoId, { em: agora(), sessaoCli: r.data.plano.entrada.bifurcar ? null : r.data.plano.entrada.sessaoCli, bifurcou: r.data.plano.entrada.bifurcar === true, modo: r.data.plano.modoTurno ?? null, conta: r.data.plano.conta?.id ?? null });
            escopos.set(r.data.plano.turnoId, escopo);
            executores.set(r.data.plano.turnoId, r.data.plano.executor);
            if (r.data.plano.harness) harnesses.set(r.data.plano.turnoId, r.data.plano.harness);
            // NOD-214: o hash do token vai para o banco na mesma tx do despacho — o processo novo de um deploy reconhece o
            // turno que a máquina continuou rodando. O token em claro nunca sai da memória.
            const cred = tokens.credencialDe?.(r.data.plano.turnoId);
            if (cred) {
              await d.repos.turnoCredenciais.gravar({ turnoId: r.data.plano.turnoId, tokenHash: cred.tokenHash, epoch: cred.epoch, identidade: cred.identidade, harness: r.data.plano.harness ?? null, executor: r.data.plano.executor, modo: r.data.plano.modoTurno ?? null, despachadoEm: agora(), bifurcou: r.data.plano.entrada.bifurcar === true, sobreviveReinicio: maquina.sobreviveReinicio === true });
              if (maquina.sobreviveReinicio === true) tokens.marcarSobrevive?.(r.data.plano.turnoId);
            }
            // ADR-085 (revisão do #209): começou trabalho novo em segundo plano — o próximo deste Mac espera ESPACO_FUNDO_MS.
            const w = uso !== "livre" && r.data.turno.trabalhoId ? await d.repos.trabalhos.buscar(r.data.turno.trabalhoId) : null;
            // ADR-086: a volta marcada também conta (processo novo no Mac sem ninguém esperando).
            const volta = r.data.turno.acordarEm != null;
            // ADA-16 (ADR-163): a tarefa do quadro não abre o espaço (serializaria o paralelo); o freio dela é o portão e o pool de laços.
            if (w && (volta || ((w.origem === "rotina" || w.origem === "colega") && w.pessoaEsperando !== true && (w.iniciadoEm === null || w.iniciadoEm >= antes)))) {
              ultimoFundo.set(maquina.machineId, agora());
              log("info", "fundo_comecou", { pessoa_id: pessoaId, machine_id: maquina.machineId, plataforma, trabalho_id: w.id, origem: w.origem, volta, espera_ms: agora() - (volta ? r.data.turno.acordarEm! : w.criadoEm), segurando: segurarFundo });
            }
          }
          return r.data.plano;
        });
        if (!plano && filaVazia && cota.length > 0) await avisarFundoSegurado(escopo, entradaDaCota);
        return plano;
      } catch (e) {
        if (mudanca) deps.desfazerMemoria?.(pessoaId, mudanca);
        for (const turnoId of emitidos) {
          despachados.delete(turnoId);
          vistos.delete(turnoId);
          escopos.delete(turnoId);
          executores.delete(turnoId);
          harnesses.delete(turnoId);
          deps.services.tokenTurno.revogar(turnoId);
        }
        log("erro", "ponte_puxar_falhou", { pessoa_id: pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
        return null;
      }
    },

    async renovar(p: PedidoRenovar): Promise<RespostaRenovar> {
      esquecerVencidos();
      const escopo = escopos.get(p.turnoId);
      if (!escopo) return { ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP, motivo: "sem_plano" };
      const executor = executores.get(p.turnoId) ?? executorAtual();
      // ADR-067: cada fala da sessão viva entra uma vez — a renovação que falhou na volta é repetida com as mesmas.
      const novas = (p.falas ?? []).filter((f) => f.seq > (falasGravadas.get(p.turnoId) ?? 0)).sort((a, b) => a.seq - b.seq);
      // #189: app que manda `mensagensEntregues` confirma o que escreveu; a mensagem só sai da fila na confirmação.
      const confirma = Array.isArray(p.mensagensEntregues);
      const jaOferecidas = oferecidas.get(p.turnoId) ?? new Map<string, number>();
      for (const id of p.mensagensDevolvidas ?? []) jaOferecidas.delete(id);
      // NOD-293 (E9): a oferecida há mais de REOFERTA_MS sem confirmação se perdeu no caminho — entra de novo abaixo.
      soltarOferecidasPerdidas(jaOferecidas, agora());
      const { ativo, motivo, mensagens, ids, semMoldura, doDonoSemTrabalho } = await abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        // NOD-214: a sessão do CLI fica no turno já na renovação — a entrega pode se perder num reinício.
        const r = await d.repos.turnos.renovarLease(p.turnoId, p.machineId, p.sinais, agora(), p.sessaoCli ? { sessaoCli: p.sessaoCli } : {});
        // NOD-214: o maior seq de fala gravado vai junto, na mesma tx — o processo novo não grava a mesma fala de novo.
        if (novas.length && tokens.credencialDe) await d.repos.turnoCredenciais.registrarFalas(p.turnoId, novas.at(-1)!.seq);
        if (p.eventos.length) await d.repos.events.gravarComOutbox(p.eventos);
        const events: RuntimeEvent[] = [];
        if (novas.length) {
          const g = await gravarFalasDaSessao(d, { turnoId: p.turnoId, machineId: p.machineId, executor, textos: novas.map((f) => f.texto) });
          events.push(...(g.events ?? []));
        }
        // Turno parado (ativo:false) não confirma: a resposta não vai sair, e a mensagem fica para o próximo turno.
        if (r.ativo && p.mensagensEntregues?.length) {
          const c = await confirmarNaSessao(d, { turnoId: p.turnoId, executor, ids: p.mensagensEntregues });
          events.push(...(c.events ?? []));
        }
        let textos: string[] = [];
        let ids: string[] = [];
        if (r.ativo && p.aceitaMensagens) {
          const a = await absorverNaSessao(d, { turnoId: p.turnoId, executor, confirma, jaOferecidas: [...jaOferecidas.keys()] });
          textos = a.data.textos;
          ids = a.data.ids;
          events.push(...(a.events ?? []));
        }
        // ADR-083 (#193): a fala mandada à task (tela da task ou mandar_para_task) entra no turno vivo dela.
        // Revisão do épico (S18, 2026-10-08): nas mesmas duas fases da conversa (#189) — oferecida aqui, absorvida na
        // confirmação —, com o id em `mensagensIds` e em `mensagensSemMoldura`: o recado do bot entra cru, e a fala da pessoa já
        // vem com a moldura dela no texto (NOD-376, domain/mensagem-no-meio.ts), sem a moldura genérica do meio.
        let semMoldura: string[] = [];
        if (r.ativo && p.aceitaMensagens) {
          const b = await absorverNoTrabalho(d, { turnoId: p.turnoId, confirma, jaOferecidas: [...jaOferecidas.keys()] });
          textos = [...textos, ...b.data.textos];
          ids = [...ids, ...b.data.ids];
          semMoldura = b.data.ids;
          events.push(...(b.events ?? []));
        }
        // NOD-418 (emenda da ADR-083): o recado da pessoa ao trabalho da tarefa do quadro entra na sessão viva, já com a
        // moldura dele (molduraDoRecado), nas mesmas duas fases: oferecido aqui, lido na confirmação (confirmarNaSessao).
        if (r.ativo && p.aceitaMensagens) {
          const recados = (await ofertarRecadosDoQuadro(d, p.turnoId)).filter((x) => !jaOferecidas.has(x.id));
          if (!confirma && recados.length) {
            await d.repos.quadroExecucoes.entregarRecados(recados.map((x) => x.id), p.turnoId);
            events.push(...(await avisosDeRecadoLido(d, recados.map((x) => x.id))));
          }
          textos = [...textos, ...recados.map((x) => x.texto)];
          ids = [...ids, ...recados.map((x) => x.id)];
          semMoldura = [...semMoldura, ...recados.map((x) => x.id)];
        }
        // 2026-11-10 (ADR-142, o `stepMoved` do Multica): a tarefa deste trabalho foi movida por outro para outra etapa
        // e o turno seguiu (sem "Parar"): o próximo passo dele lê o aviso, uma vez por mudança.
        if (r.ativo && p.aceitaMensagens) {
          const aviso = await avisoDaEtapaNaSessao(d, p.turnoId);
          if (aviso && avisosDeEtapa.get(p.turnoId) !== aviso.chave) {
            avisosDeEtapa.set(p.turnoId, aviso.chave);
            textos = [...textos, aviso.texto];
          }
        }
        const turno = r.ativo ? await d.repos.turnos.buscar(p.turnoId) : null;
        // A decisão respondida DENTRO do turno não passa por outro caminho: a renovação acerta o estado da task.
        if (turno?.trabalhoId) events.push(...(await sincronizarTrabalho(d, turno.trabalhoId)));
        // ADR-083 (#194): a memória do Mac. A dos turnos vai para os trabalhos deles; o nível só gera evento na mudança.
        let mudanca: MudancaDePressao | undefined;
        if (p.memoria) {
          await d.repos.trabalhos.atualizarMemoria(p.memoria.porTurno);
          mudanca = deps.registrarMemoria?.(escopo.pessoaId, p.machineId, p.memoria);
          if (mudanca?.mudou) events.push(eventoPressao(d, mudanca, p.memoria));
        }
        // Revisão do #209: o evento só existe se a tx gravar — senão o "visto" volta e a próxima leitura refaz o frame.
        try {
          if (events.length) await d.repos.events.gravarComOutbox(events);
        } catch (e) {
          if (mudanca) deps.desfazerMemoria?.(escopo.pessoaId, mudanca);
          throw e;
        }
        return { ativo: r.ativo, motivo: r.motivo, mensagens: textos, ids, semMoldura, doDonoSemTrabalho: turno !== null && !turno.trabalhoId && (turno.origem === "conversa" || turno.origem === "retomada") };
      });
      // #189: o que o app confirmou já saiu da fila (absorvido): não está mais "oferecido e esperando confirmação".
      if (ativo) for (const id of p.mensagensEntregues ?? []) jaOferecidas.delete(id);
      // A rede de 2 min, numa transação PRÓPRIA: se a entrega correr junto, só a promoção desfaz — nunca a renovação.
      const despachado = despachados.get(p.turnoId);
      const redeMs = deps.redeMs ?? REDE_MS;
      const harness = harnesses.get(p.turnoId) ?? null;
      // definido em 2026-10-08 (revisão do épico, S15): a MÁQUINA deste turno anunciou que bifurca sessão com este harness
      // (AnuncioMaquina.capacidades, já com o piso do CLI dela)? App antigo não anuncia.
      // revisto em 2026-10-12 (ADR-099, I8): isso não decide mais SE promove, só COMO o dono segue — bifurcando, ou com a
      // sessão indo para a frente e o dono recebendo o histórico (dois CLIs nunca dividem uma sessão).
      const maquinaBifurca = maquinaBifurcaCom(p.machineId, harness);
      // S17: com mensagem oferecida e ainda não confirmada (nesta renovação ou numa anterior), não promove: a resposta a
      // ela sairia duas vezes (no turno promovido e no turno próprio que a mensagem viraria). NOD-293 (E9): só conta a que
      // está dentro da janela de REOFERTA_MS — a perdida saiu do mapa acima e, se ainda pendente, está em `ids`.
      const semMensagemNoAr = ids.length === 0 && jaOferecidas.size === 0;
      if (ativo && doDonoSemTrabalho && despachado && harness !== null && semMensagemNoAr && agora() - despachado.em >= redeMs && deps.fezFerramenta?.(p.turnoId)) {
        await abrirTxEscopada(db, escopo)(async (trx) => {
          const d = depsDe(trx, escopo);
          const r = await promoverNaRede(d, { turnoId: p.turnoId, despachadoEm: despachado.em, fezFerramenta: true, harness, sessaoCli: despachado.sessaoCli, sessaoExecutor: executores.get(p.turnoId) ?? null, maquinaBifurca, modo: despachado.modo, redeMs });
          if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
        }).catch((e: unknown) => log("aviso", "rede_promover_falhou", { turno_id: p.turnoId, erro: e instanceof Error ? e.name : "desconhecido" }));
      }
      if (novas.length) falasGravadas.set(p.turnoId, novas.at(-1)!.seq);
      if (ativo) vistos.set(p.turnoId, agora());
      if (confirma && ativo) {
        const em = agora();
        for (const id of ids) jaOferecidas.set(id, em);
        oferecidas.set(p.turnoId, jaOferecidas);
      }
      return { ativo, versaoMinimaApp: VERSAO_MINIMA_APP, ...(!ativo && motivo ? { motivo } : {}), ...(mensagens.length ? { mensagens, mensagensIds: ids } : {}), ...(semMoldura.length ? { mensagensSemMoldura: semMoldura } : {}) };
    },

    async entregar(e: Entrega) {
      const escopo = escopos.get(e.turnoId);
      if (!escopo) {
        log("aviso", "ponte_entrega_sem_escopo", { turno_id: e.turnoId, machine_id: e.machineId });
        return;
      }
      const executor = executores.get(e.turnoId) ?? executorAtual();
      // 0005: turno que falhou vira uma linha de log COM a causa crua do CLI — antes só chegava
      // "erro_execucao" e o diagnóstico exigia reproduzir o turno à mão (medido 2026-09-16).
      if (e.resultado.desfecho !== "sucesso") {
        log(e.resultado.desfecho === "falha" ? "erro" : "aviso", "turno_nao_concluiu", {
          turno_id: e.turnoId,
          desfecho: e.resultado.desfecho,
          motivo: e.resultado.motivoFalha ?? e.resultado.motivoInterrupcao ?? null,
          erro_cru: deps.erroCruNoLog === false ? null : (e.resultado.erroCru ?? null),
          causa: e.resultado.causaSemIa ?? null,
          sessao_cli: e.resultado.sessaoCli,
          executor,
          versao_app: maquinas.get(e.machineId)?.versaoApp ?? null,
        });
      }
      const harnessDoTurno = harnesses.get(e.turnoId) ?? null;
      // NOD-283 (2026-10-15): o turno numa conta da lista que voltou "sem acesso" reprova ESSA conta (o assentamento marca o
      // vínculo `sem_acesso`), não a IA inteira — a outra conta da mesma IA continua servindo.
      const naContaDaLista = Boolean(despachados.get(e.turnoId)?.conta);
      const outraIa = e.resultado.causaSemIa && harnessDoTurno && !naContaDaLista ? reprovarHarness(e.machineId, harnessDoTurno, e.resultado.causaSemIa) : null;
      // 0068: as IAs prontas da pessoa (todas as máquinas vivas), para o limite repetir o turno na próxima da ordem.
      const prontosDaPessoa = (Object.entries(harnessesDaPessoa(escopo.pessoaId)) as [IdHarness, Inventario | undefined][]).filter(([, i]) => i?.estado === "pronto").map(([id]) => id);
      // NOD-268: as prontas de cada máquina conectada — com o bot preso a uma, a troca só vai para uma IA dela.
      const porMaquina = prontosPorMaquina(escopo.pessoaId);
      let limiteMudou = false;
      // Revisão do épico (S20, 2026-10-08): o assentar é repetido quando o Postgres o escolhe como vítima de um impasse
      // (40P01) ou de serialização (40001) — a transação inteira volta, inclusive o registro da entrega (idempotência
      // por seq_local), então repetir é seguro. E os mapas só saem depois do assentar com sucesso: antes o `finally`
      // apagava o escopo mesmo na falha, e a nova tentativa da entrega caía em "entrega sem escopo" — a resposta se perdia.
      const assentar = () => abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        const r = await assentarTurno(d, { ...e, adotada: adotadosNaEntrega.has(e.turnoId), executor, harness: harnessDoTurno, outraIa, prontosDaPessoa, prontosPorMaquina: porMaquina, bifurcou: despachados.get(e.turnoId)?.bifurcou === true, maquinaBifurca: maquinaBifurcaCom(e.machineId, harnessDoTurno), ...versaoDoApp(e.machineId) });
        limiteMudou = r.data.limiteMudou === true;
        // definido em 2026-09-21 (ADR-041): o diagnóstico da falha também PERSISTE, não só vira log.
        // A linha acima vai para stdout e some no Electron empacotado; sem isto um relato feito
        // minutos depois não alcança a causa crua nem os nomes das ferramentas (só a contagem).
        // Best-effort: um SAVEPOINT isola a escrita para que ela NUNCA derrube o assentamento.
        // erro_cru vem do fornecedor sem teto de tamanho, e um timeout no insert do toast levaria
        // junto a mensagem do agente, o gasto e o outbox — o observador não pode destruir o
        // observado. Truncado em 8 KiB, o mesmo teto do corte de resultado do proxy, e redigido
        // antes do corte (NOD-158): o relato e a exportação do diagnóstico leem daqui.
        if (e.resultado.desfecho !== "sucesso" && !r.data.duplicada) {
          try {
            await d.tx(async (t) => {
              await t`savepoint diagnostico`;
              try {
                await criarRepos(t, escopo).relatos.registrarDiagnostico({
                  turnoId: e.turnoId,
                  erroCru: redigirECortar(e.resultado.erroCru, 8000),
                  ferramentas: e.resultado.ferramentasChamadas,
                  negacoes: e.resultado.negacoesPermissao,
                  sessaoCli: e.resultado.sessaoCli,
                  em: agora(),
                });
                await t`release savepoint diagnostico`;
              } catch (err) {
                await t`rollback to savepoint diagnostico`;
                throw err;
              }
            });
          } catch {
            log("aviso", "diagnostico_nao_gravado", { turno_id: e.turnoId });
          }
        }
        // ADR-017 #4 / ADR-045: a entrega que chegou com o lease vencido é um turno perdido pela máquina.
        if (!r.data.tardia && r.data.turno?.motivoInterrupcao === "maquina_sem_contato") registroPadrao.incrementar({ metrica: "pos_restart", desfecho: "perdido", origem: "maquina_sumida", tenant_id: escopo.tenantId });
        // NOD-245: o turno adotado que o reinício derrubou (a máquina desistiu antes de o servidor voltar).
        if (!r.data.tardia && r.data.turno?.motivoInterrupcao === "reinicio_servidor") registroPadrao.incrementar({ metrica: "pos_restart", desfecho: "perdido", origem: "restart_servidor", tenant_id: escopo.tenantId });
        const extras = deps.depoisDeAssentar && !r.data.duplicada ? await deps.depoisDeAssentar(d, { entrega: e, saida: r.data }) : [];
        const events = [...(r.events ?? []), ...extras];
        if (events.length) await d.repos.events.gravarComOutbox(events);
        // NOD-214: assentado, o turno não é mais adotável — a credencial sai na mesma tx.
        if (tokens.credencialDe) await d.repos.turnoCredenciais.apagar(e.turnoId);
      });
      try {
        for (let tentativa = 1; ; tentativa++) {
          try {
            await assentar();
            break;
          } catch (err) {
            if (tentativa >= TENTATIVAS_DO_ASSENTAR || !ehConflitoTransitorio(err)) throw err;
            log("aviso", "ponte_entrega_repetida", { turno_id: e.turnoId, tentativa, codigo: (err as { code?: string }).code ?? null });
          }
        }
      } catch (err) {
        // O processo do turno já acabou: o token e o interruptor saem. O escopo e os mapas ficam para a entrega repetida.
        deps.services.tokenTurno.revogar(e.turnoId);
        // NOD-214: e a credencial no banco (o token revogado não pode voltar por um processo novo). Melhor esforço.
        if (tokens.credencialDe) await apagarCredencial(escopo, e.turnoId);
        deps.esquecerTurno?.(e.turnoId);
        throw err;
      }
      // 0068: o limite gravado (ou tirado) já está no banco — esta ponte relê, as outras também, e a tela da pessoa sabe.
      if (limiteMudou) {
        limitesLidos.delete(escopo.pessoaId);
        deps.limiteMudou?.(escopo.pessoaId);
      }
      escopos.delete(e.turnoId);
      executores.delete(e.turnoId);
      harnesses.delete(e.turnoId);
      falasGravadas.delete(e.turnoId);
      oferecidas.delete(e.turnoId);
      despachados.delete(e.turnoId);
      vistos.delete(e.turnoId);
      avisosDeEtapa.delete(e.turnoId);
      adotadosNaEntrega.delete(e.turnoId);
      deps.services.tokenTurno.revogar(e.turnoId);
      // NOD-200: a captura do turno sai só com o assentar confirmado; na falha fica, como o escopo, para a entrega repetida.
      deps.services.capturas?.esquecer(e.turnoId);
      deps.esquecerTurno?.(e.turnoId);
    },

    /**
     * NOD-214 (revisão da EMENDA 3 da ADR-024): o deploy trocou o processo e a máquina seguiu rodando o turno. Ela
     * apresenta o token do turno (a chave dela já foi conferida na rota); o turno só volta para esta ponte se, no banco,
     * está `despachando` NESTA máquina e o hash do token bate com a credencial gravada no despacho. O lease é renovado na
     * mesma tx (atômico contra o varredor; dentro da carência do boot, aceita o lease vencido) e os mapas da ponte são
     * refeitos da credencial: escopo, executor, harness, quando foi despachado, se bifurcou, o modo e as falas gravadas.
     * O turno já assentado desta máquina não é adotado: a entrega dele vira tardia/duplicada (ADR-045), nunca uma recusa.
     * revisto em 2026-10-15 (NOD-245/NOD-252): `para: "assentar"` (a entrega) não renova o lease nem exige que o turno
     * siga ativo — com Parar pendente ou lease vencido, a entrega é aceita e o assentamento decide o desfecho (antes, 403).
     * Uma exceção aqui (banco) é lançada, nunca vira `recusado`: a rota responde 503 e a máquina tenta de novo.
     */
    async adotar(p: PedidoAdocao): Promise<DesfechoAdocao> {
      const paraAssentar = p.para === "assentar";
      const recusado: DesfechoAdocao = { tipo: "recusado" };
      const escopo = await resolverEscopo(p.pessoaId);
      if (!escopo || !tokens.adotar || !tokens.planoOuRecompor || p.token === "") return recusado;
      const hash = createHash("sha256").update(p.token).digest();
      const lido = await abrirTxEscopada(db, escopo)(async (trx) => {
        const repos = criarRepos(trx, escopo);
        const turno = await repos.turnos.buscar(p.turnoId);
        if (!turno || turno.machineId !== p.machineId) return null;
        if (turno.estado !== "despachando" && turno.estado !== "pendente") return { assentado: true as const, executor: turno.executor };
        if (turno.estado !== "despachando") return null;
        const cred = await repos.turnoCredenciais.buscar(p.turnoId);
        if (!cred || cred.tokenHash.length !== hash.length || !timingSafeEqual(cred.tokenHash, hash)) return null;
        if (paraAssentar) return { assentado: false as const, cred };
        const r = await repos.turnos.renovarLease(p.turnoId, p.machineId, {}, agora(), { aceitaVencido: dentroDaCarencia() });
        return r.ativo ? { assentado: false as const, cred } : null;
      });
      if (!lido) return recusado;
      if (lido.assentado) {
        // A entrega que chegar segue o caminho da tardia (o escopo é o que falta a ela num processo novo).
        escopos.set(p.turnoId, escopo);
        if (!executores.has(p.turnoId) && lido.executor) executores.set(p.turnoId, lido.executor);
        return { tipo: "ja_assentado" };
      }
      const { cred } = lido;
      if (!tokens.adotar(p.token, { turnoId: p.turnoId, tokenHash: cred.tokenHash, epoch: cred.epoch, identidade: cred.identidade, sobreviveReinicio: cred.sobreviveReinicio })) return recusado;
      escopos.set(p.turnoId, escopo);
      executores.set(p.turnoId, cred.executor);
      if (cred.harness) harnesses.set(p.turnoId, cred.harness);
      falasGravadas.set(p.turnoId, Math.max(falasGravadas.get(p.turnoId) ?? 0, cred.falasSeq));
      vistos.set(p.turnoId, agora());
      const plano = await tokens.planoOuRecompor(p.turnoId).catch((e: unknown) => {
        log("aviso", "plano_nao_recomposto", { turno_id: p.turnoId, erro: e instanceof Error ? e.name : "desconhecido" });
        return null;
      });
      if (!plano) return recusado;
      if (!despachados.has(p.turnoId)) despachados.set(p.turnoId, { em: cred.despachadoEm, sessaoCli: cred.bifurcou ? null : plano.entrada.sessaoCli, bifurcou: cred.bifurcou, modo: cred.modo, conta: plano.conta?.id ?? null });
      if (paraAssentar) adotadosNaEntrega.add(p.turnoId);
      log("info", "turno_adotado", { turno_id: p.turnoId, machine_id: p.machineId, carencia: dentroDaCarencia(), para: paraAssentar ? "assentar" : "rodar" });
      return { tipo: "adotado", plano };
    },

    /** ADR-088: a regra de quem pode ser limpo lê o banco na tx escopada da pessoa; o Mac apaga. */
    async pastasParaLimpar(pessoaId, o): Promise<PastaParaLimpar[]> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return [];
      return abrirTxEscopada(db, escopo)((trx) => pastasParaLimpar(depsDe(trx, escopo), { apertado: o?.apertado === true, ...(o?.codigos ? { codigos: o.codigos } : {}) }));
    },

    /** ADR-099 (I5, 2026-10-12): a frente que terminou com este turno e já vale `sem_trabalho`, para o Mac limpar na hora. */
    async limparAgora(pessoaId, turnoId): Promise<PastaParaLimpar | null> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return null;
      return abrirTxEscopada(db, escopo)((trx) => pastaSemTrabalhoDoTurno(depsDe(trx, escopo), turnoId));
    },

    /**
     * ADR-088: o resumo da passada vira o log `limpeza_feita` (só números; nunca caminho). ADR-106: com a máquina que
     * limpou — em 15/10 o Mac e a VM da mesma pessoa se misturavam no log, e os 24,7 GB liberados no Mac pareciam da VM.
     */
    async relatarLimpeza(pessoaId, relato: RelatoLimpeza, machineId?: string) {
      const r = relatoValido(relato);
      // Revisão do #225: a passada simulada não apagou nada — o log diz o que sairia, com outro nome para não somar.
      // Segunda revisão do #225: com o Docker instalado e mudo a passada não mexe em nada — `limpeza_adiada`.
      log(r.adiada ? "aviso" : "info", r.adiada ? "limpeza_adiada" : r.simulada ? "limpeza_simulada" : "limpeza_feita", { pessoa_id: pessoaId, ...(machineId ? { machine_id: machineId } : {}), ...camposDoRelato(r) });
    },

    /** ADR-099 (parte 2): as esperas que a máquina deve rodar; ler é a notícia dela (`visto_em`). */
    async esperas(pessoaId, machineId): Promise<EsperaParaRodar[]> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return [];
      return abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).esperas.paraAMaquina(machineId, agora()));
    },

    /** ADR-099 (parte 2): o relato da máquina; o fim acorda o dono na mesma transação (o evento sai pelo outbox). */
    async relatarEspera(pessoaId, machineId, relato: RelatoEspera): Promise<RespostaRelatoEspera> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return { seguir: false };
      return abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        const r = await relatarEsperaDaMaquina(d, { maquinaId: machineId, relato });
        if (r.events.length) await d.repos.events.gravarComOutbox(r.events);
        return r.data;
      });
    },

    /** NOD-54 (ADR-134): os desfazeres que a máquina deve rodar. */
    async desfazeres(pessoaId, machineId): Promise<DesfazerParaRodar[]> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return [];
      return abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).checkpoints.paraAMaquina(machineId));
    },

    /** NOD-54: o relato do desfazer; o fim deixa a linha para o bot e o frame sai pelo outbox. */
    async relatarDesfazer(pessoaId, machineId, relato: RelatoDesfazer): Promise<{ ok: boolean }> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return { ok: false };
      return abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        const r = await relatarDesfazerDaMaquina(d, { maquinaId: machineId, relato });
        if (r.events.length) await d.repos.events.gravarComOutbox(r.events);
        return r.data;
      });
    },

    emMemoria() {
      return { escopos: escopos.size, oferecidas: oferecidas.size, despachados: despachados.size };
    },

    maquinasConectadas() {
      return [...maquinas.values()];
    },

    escopoDoTurno(turnoId) {
      return escopos.get(turnoId) ?? null;
    },
  };
}
