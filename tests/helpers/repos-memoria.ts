import { contasIaMemoria, estadoContasIaMemoria, type EstadoContasIaMemoria } from "./contas-ia-memoria.ts";
import { temFalha, type EstadoDisjuntor } from "../../src/domain/disjuntor-conector.ts";
import { ehDecisao, MOTIVOS_DE_CONECTOR_FORA } from "../../src/domain/decisoes.ts";
import type { ConfigGithubApp } from "../../src/repositories/github-app.repo.ts";
import type { AnexoDaConversa, MimeAnexo, RecusasMidia } from "../../src/contracts/anexo.ts";
import type { LinhaOnboarding } from "../../src/repositories/onboarding.repo.ts";
import type { MaquinaSsh } from "../../src/repositories/maquinas-ssh.repo.ts";
import type { ComposicaoRaioX, ExecucaoRaioX, Preferencias } from "../../src/contracts/raio-x.ts";
import type { CatalogoDeComandos } from "../../src/contracts/comandos.ts";
import type { UsoDoPlano } from "../../src/contracts/uso-do-plano.ts";
import { ESTADO_MAX_BYTES_ARTEFATO, type Artefato, type EstadoArtefato, type VersaoArtefato } from "../../src/contracts/artefato.ts";
import { randomUUID } from "node:crypto";
import { MARCAR_USO_A_CADA_MS } from "../../src/repositories/maquina-tokens.repo.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { PermissaoPermanente } from "../../src/contracts/permissao-permanente.ts";
import type { Concessao, Procuracao } from "../../src/contracts/concessao.ts";
import type { Conversa, Proposta } from "../../src/contracts/conversa.ts";
import { TIPOS_DISPENSAVEIS_ABERTOS, type Decisao } from "../../src/contracts/decisao.ts";
import type { Incidente } from "../../src/contracts/incidente.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ItemAprovacao } from "../../src/contracts/item-aprovacao.ts";
import type { Memoria } from "../../src/contracts/memoria.ts";
import { MAX_VERSOES_PERFIL, type VersaoPerfil, VERSOES_POR_PAGINA } from "../../src/contracts/versoes-perfil.ts";
import { redigirPerfil, temRedacao } from "../../src/domain/versoes-perfil.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ExecucaoRotina, Rotina } from "../../src/contracts/rotina.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { EmojiDeReacao, ReacaoNaFala } from "../../src/contracts/reacao.ts";
import type { Profundidade, Turno } from "../../src/contracts/turno.ts";
import type { CredencialTurno } from "../../src/repositories/turno-credenciais.repo.ts";
import type { AcaoDoModo } from "../../src/repositories/acoes-pelo-modo.repo.ts";
import type { Trabalho } from "../../src/contracts/trabalho.ts";
import type { NovoLote } from "../../src/repositories/frentes.repo.ts";
import type { LoteDeFrentes, ResumoFrente } from "../../src/contracts/frente.ts";
import type { LinhaTrilha } from "../../src/db/schema/trilha.ts";
import { ORCAMENTO_INICIAL } from "../../src/domain/canal-orcamento.ts";
import { seguravelPeloMac } from "../../src/domain/memoria-mac.ts";
import { ateOPrimeiroAnexo, porChegada } from "../../src/domain/ordem-das-falas.ts";
import { nasceNosBastidores, type PedidoAberto } from "../../src/domain/triagem.ts";
import { ehMotivoDaQueda } from "../../src/domain/incidente.ts";
import { MOTIVOS_DE_QUEDA, MOTIVOS_FALHA_SEM_QUEDA, QUEDAS_FORA_DO_TETO } from "../../src/domain/pedido-parado.ts";
import { cotaSegura, ehVoltaDoFundo, ENTRADA_DA_RETOMADA_DA_QUEDA, ENTRADA_DA_VOLTA_DA_COTA, entradaLevadaComPedido, tipoParaCota, type PortaoDaCota } from "../../src/domain/cota-da-ia.ts";
import { MODO_APROVACAO_INICIAL } from "../../src/domain/modo-aprovacao.ts";
import { recusaPendente } from "../../src/domain/rotina-webhook.ts";
import { harnessFixado } from "../../src/domain/harness.ts";
import { iaDoModelo } from "../../src/domain/ia-do-modelo.ts";
import { HARNESS_LEGADO } from "../../src/contracts/harness.ts";
import { derivadosDa, INTELIGENCIA_PADRAO, inteligenciaDoLegado } from "../../src/domain/inteligencia.ts";
import type { ConectorGuardado } from "../../src/repositories/conectores.repo.ts";
import type { EventoGravavel } from "../../src/repositories/events.repo.ts";
import type { Gasto } from "../../src/repositories/gastos.repo.ts";
import type { ItemOutbox } from "../../src/repositories/outbox.repo.ts";
import type { ExtrasTrabalho } from "../../src/repositories/trabalhos.repo.ts";
import type { Espera } from "../../src/contracts/espera.ts";
import type { TrocaDeIa } from "../../src/contracts/troca-de-ia.ts";
import type { RitmoRotina } from "../../src/contracts/rotina-ritmo.ts";
import type { Parada } from "../../src/repositories/paradas.repo.ts";
import type { Pessoa } from "../../src/repositories/pessoas.repo.ts";
import type { JanelaReivindicada } from "../../src/repositories/rotina-janelas.repo.ts";
import type { GatilhoVivo } from "../../src/repositories/rotina-gatilhos.repo.ts";
import type { ChamadaWebhook } from "../../src/contracts/rotina.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { EXECUCOES_GUARDADAS, LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { TURNOS_DA_JANELA } from "../../src/repositories/raio-x.repo.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "./ids.ts";

/** turnos.ultimo_sinal_em (0076): a hora da queda que `interromper` grava uma vez; o Turno do contrato não a carrega. */
const ULTIMO_SINAL = new WeakMap<Turno, number>();

/**
 * `Repos` em memória para tests/unit/use-cases (Práticas §1: a fábrica de tx vira `(fn) => fn({} as never)`
 * e os repos são estes). Mesmas assinaturas de src/repositories/*.repo.ts (o compilador cobra:
 * `satisfies Repos`), mesma semântica de retorno (null/[]), SEM RLS: o isolamento por pessoa se prova
 * em tests/integration, não aqui. Escopo por tenant é respeitado onde o SQL filtra por tenant/owner.
 * Constraints que importam ao caso de uso (UNIQUE de janela, CHECK do item sensível, dono imutável,
 * NOT EXISTS da reivindicação) são reproduzidas para o teste unitário ver o mesmo comportamento.
 */
export type BancoMemoria = {
  pessoas: Pessoa[];
  agentes: Agente[];
  /** agentes.geracao_execucao (ADR-034): ausente = 0. */
  geracoes: Map<string, number>;
  memorias: Memoria[];
  /** NOD-20: as versões do perfil (tenantId junto, para o filtro do escopo). */
  versoesPerfil: (VersaoPerfil & { tenantId: string })[];
  conversas: Conversa[];
  mensagens: Mensagem[];
  /** NOD-156: `tenant:conversa:idEnvio` → id da mensagem (a coluna id_envio não sai em Mensagem). */
  idsDeEnvio: Map<string, string>;
  anexos: {
    tenantId: string; ownerId: string; id: string; conversaId: string; mensagemId: string | null; nome: string; mime: MimeAnexo; bytes: Buffer; criadoEm: number;
    // NOD-323: a mídia do bot.
    origem?: "bot"; turnoId?: string; sha256?: string; semBytes?: boolean; caminhoRelativo?: string; machineId?: string | null; tamanho?: number; largura?: number; altura?: number; duracaoMs?: number;
  }[];
  midiaRecusas: Map<string, { motivo: string; n: number }[]>;
  /** ADR-051 (0031): artefato, versões e o estado por pessoa (UNIQUE tenant+artefato+owner reproduzido). */
  artefatos: (Artefato & { tenantId: string; ownerId: string })[];
  artefatoVersoes: (VersaoArtefato & { tenantId: string; ownerId: string })[];
  artefatoEstados: (EstadoArtefato & { tenantId: string; ownerId: string; json: string })[];
  propostas: Proposta[];
  turnos: Turno[];
  /** 0063 (ADR-083): os trabalhos, com a dona. */
  trabalhos: (Trabalho & { ownerId: string })[];
  /** 0070 (ADR-099, parte 2): as esperas de comando, com a dona (o comportamento completo se prova no Postgres). */
  esperas: (Espera & { tenantId: string; ownerId: string })[];
  /** 0074 (ADR-102): as contas de IA da pessoa e os vínculos com as máquinas. */
  contasIa: EstadoContasIaMemoria;
  /** 0080 (ADR-108): os avisos de troca de IA (o comportamento completo se prova no Postgres). */
  trocasDeIa: (TrocaDeIa & { tenantId: string; ownerId: string })[];
  /** NOD-313: rotina_ritmo (a trava e a corrida se provam no Postgres). */
  rotinaRitmo: (RitmoRotina & { tenantId: string; ownerId: string })[];
  /** ADR-102: turnos.conta_id e conversas/trabalhos.sessao_conta_id ("conversa:<id>" / "trabalho:<id>"). */
  contaDoTurno: Map<string, string | null>;
  /** NOD-280: a máquina "desta vez" de cada turno (o fake não a aplica no reivindicar; os testes a leem daqui). */
  maquinaDestaVez: Map<string, string>;
  contaDaSessao: Map<string, string | null>;
  /** ADR-107 (0079): conversas/trabalhos.sessao_maquina_id (mesmas chaves) e turnos.harness_efetivo. */
  maquinaDaSessao: Map<string, string | null>;
  harnessEfetivo: Map<string, string | null>;
  /** 0073 (NOD-214): as credenciais dos turnos despachados (o comportamento completo se prova no Postgres). */
  credenciais: (CredencialTurno & { tenantId: string; ownerId: string })[];
  entregas: Set<string>;
  decisoes: (Decisao & { decididaEm: number | null })[];
  varridos: Set<string>;
  itens: ItemAprovacao[];
  /** ADR-115 (0093): acoes_pelo_modo. */
  acoesPeloModo: AcaoDoModo[];
  rotinas: Rotina[];
  janelas: JanelaReivindicada[];
  execucoes: ExecucaoRotina[];
  salas: Sala[];
  membros: (MembroSala & { criadoEm: number })[];
  conectores: ConectorGuardado[];
  composioChaves: Map<string, string>;
  /** 0032: quem continuou cada decisão e as raízes com o computador liberado para a tarefa. */
  continuacoes: Map<string, "turno" | "retomada">;
  computadorLiberado: Set<string>;
  /** 0034 (ADR-055): raízes com o terminal liberado para a tarefa. */
  terminalLiberado: Set<string>;
  /** 0035: a sessão do CLI e o total informado, por turno. */
  custoSessao: Map<string, { sessaoCli: string; total: number }>;
  /** NOD-291: turno → a sessão-mãe da cópia (`turnos.sessao_origem_cli`). */
  sessaoOrigem: Map<string, string>;
  /** 0036: o Raio-X de cada turno e as preferências de cada pessoa (chave tenant:pessoa). */
  raioX: Map<string, { composicao: ComposicaoRaioX | null; execucao: ExecucaoRaioX | null }>;
  preferencias: Map<string, Preferencias>;
  /** 0049 (ADR-077): o onboarding de cada pessoa (chave tenant:pessoa). */
  onboarding: Map<string, LinhaOnboarding>;
  /** 0038: o catálogo do "/" de cada pessoa (chave tenant:pessoa). */
  comandos: Map<string, { catalogo: CatalogoDeComandos; em: number }>;
  usoDoPlano: Map<string, UsoDoPlano>;
  /** 0039: o "lido até" de cada pessoa em cada conversa (chave tenant:pessoa:conversa). */
  leituras: Map<string, number>;
  /** 0054: o "Agora não" do cartão de liberar apps (chave tenant:pessoa:agente:conector → instante). */
  liberacoesDispensadas: Map<string, number>;
  /** 0033: turnos que trouxeram conteúdo da web pelas nativas. */
  contaminados: Set<string>;
  /** ADR-130 (0121): os turnos dos bastidores da conversa (a coluna `turnos.bastidores` do repo real). */
  bastidores: Set<string>;
  githubApp: Map<string, ConfigGithubApp>;
  composioSessoes: Map<string, import("../../src/repositories/composio.repo.ts").SessaoComposio>;
  concessoes: Concessao[];
  permissoes: PermissaoPermanente[];
  procuracoes: Procuracao[];
  inventario: { tenantId: string; pessoaId: string; motor: string; inventario: Inventario }[];
  gastos: (Gasto & { tenantId: string; ownerId: string })[];
  incidentes: (Incidente & { ownerId: string })[];
  relatos: (Relato & { ownerId: string })[];
  /** 0090 (ADR-113): uma por pessoa, fala e emoji (a regra completa, com a RLS, se prova no Postgres). */
  reacoes: { tenantId: string; ownerId: string; conversaId: string; mensagemId: string; emoji: EmojiDeReacao; criadoEm: number }[];
  trilha: LinhaTrilha[];
  nativasIdempotencia: Map<string, { ok: true } | { aguardar: string }>;
  paradas: (Parada & { tenantId: string })[];
  catcher: { tenantId: string; id: string; turnoId: string; tipo: string; dados: Record<string, unknown>; em: number }[];
  events: (EventoGravavel & { tenantId: string; id: string; createdAt: number })[];
  outbox: (ItemOutbox & { tenantId: string; ownerId: string; entregueEm: number | null; abandonadoEm: number | null; canceladoEm: number | null })[];
  /** NOD-84 (0130): endereço secreto e log de chamadas do webhook. */
  rotinaGatilhos: (GatilhoVivo & { tenantId: string; ownerId: string; revogadoEm: number | null })[];
  rotinaChamadas: (ChamadaWebhook & { tenantId: string; ownerId: string; entregaId: string | null })[];
  maquinaTokens: { tenantId: string; ownerId: string; id: string; nome: string; prefixo: string; hash: Buffer; criadaEm: number; ultimoUsoEm: number | null; expiraEm: number | null; revogadaEm: number | null; plataforma?: "darwin" | "linux" | "win32" | null; papel?: "motor" | "computador" }[];
  /** NOD-94 (0105): máquinas instaladas por SSH. */
  maquinasSsh: (MaquinaSsh & { tenantId: string; ownerId: string })[];
  /** 0071 (ADR-099, partes 3/4): os lotes de frentes, com a dona (o comportamento completo se prova no Postgres). */
  lotes: (LoteDeFrentes & { tenantId: string; ownerId: string })[];
};

/** NOD-282 (G7): o resumo_anterior das frentes, por banco em memória. */
const RESUMOS_ANTERIORES = new WeakMap<object, Map<string, ResumoFrente | Record<string, never>>>();

/** Os times em memória (NOD-437), por banco e pessoa: o banco de teste não tem tabela de times. */
type TimeEmMemoria = { id: string; nome: string; chave: string; posicao: number; recolhido: boolean };
const TIMES_POR_BANCO = new WeakMap<object, Map<string, TimeEmMemoria[]>>();
function timesDoBanco(b: object, dono: string): TimeEmMemoria[] {
  let porDono = TIMES_POR_BANCO.get(b);
  if (!porDono) TIMES_POR_BANCO.set(b, (porDono = new Map()));
  let l = porDono.get(dono);
  if (!l) porDono.set(dono, (l = []));
  return l;
}

export function criarBancoMemoria(): { banco: BancoMemoria; repos(escopo?: Escopo): Repos } {
  const banco: BancoMemoria = {
    pessoas: [],
    agentes: [],
    geracoes: new Map(),
    memorias: [],
    versoesPerfil: [],
    conversas: [],
    mensagens: [],
    idsDeEnvio: new Map(),
    anexos: [],
    midiaRecusas: new Map(),
    artefatos: [],
    artefatoVersoes: [],
    artefatoEstados: [],
    propostas: [],
    turnos: [],
    trabalhos: [],
    esperas: [],
    contasIa: estadoContasIaMemoria(),
    trocasDeIa: [],
    rotinaRitmo: [],
    contaDoTurno: new Map(),
    maquinaDestaVez: new Map(),
    contaDaSessao: new Map(),
    maquinaDaSessao: new Map(),
    harnessEfetivo: new Map(),
    credenciais: [],
    entregas: new Set(),
    decisoes: [],
    varridos: new Set(),
    itens: [],
    acoesPeloModo: [],
    rotinas: [],
    janelas: [],
    execucoes: [],
    salas: [],
    membros: [],
    conectores: [],
    composioChaves: new Map(),
    continuacoes: new Map(),
    computadorLiberado: new Set(),
    terminalLiberado: new Set(),
    custoSessao: new Map(),
    sessaoOrigem: new Map(),
    raioX: new Map(),
    preferencias: new Map(),
    onboarding: new Map(),
    comandos: new Map(),
    usoDoPlano: new Map(),
    leituras: new Map(),
    liberacoesDispensadas: new Map(),
    contaminados: new Set(),
    bastidores: new Set(),
    githubApp: new Map(),
    composioSessoes: new Map(),
    concessoes: [],
    permissoes: [],
    procuracoes: [],
    inventario: [],
    gastos: [],
    incidentes: [],
    relatos: [],
    reacoes: [],
    trilha: [],
    nativasIdempotencia: new Map(),
    paradas: [],
    catcher: [],
    events: [],
    outbox: [],
    rotinaGatilhos: [],
    rotinaChamadas: [],
    maquinaTokens: [],
    maquinasSsh: [],
    lotes: [],
  };
  return { banco, repos: (escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON }) => reposSobre(banco, escopo) };
}

/** Atalho: um banco novo e a visão da pessoa dada (default Marlon no tenant padrão). */
export function reposMemoria(escopo?: Escopo): Repos {
  return criarBancoMemoria().repos(escopo);
}

const agora = () => Date.now();
/** O que só existe no Postgres (consulta de faixa e de índice): o fake falha alto em vez de inventar resposta. */
const soNoPostgres = async (): Promise<never> => {
  throw new Error("só no Postgres: use tests/integration");
};
/** ADR-086: o pedido de volta anotado em cada turno (no Postgres, turnos.despertar_em/despertar_motivo). */
const despertares = new Map<string, { em: number; motivo: string; prUrlCi: string | null }>();
const iso = (n: number) => new Date(n).toISOString();
const semDono = (l: Artefato & { tenantId: string; ownerId: string }): Artefato => ({ id: l.id, agenteId: l.agenteId, conversaId: l.conversaId, titulo: l.titulo, versaoAtual: l.versaoAtual, criadoEm: l.criadoEm, atualizadoEm: l.atualizadoEm });
const semDonoEspera = ({ tenantId: _tenant, ownerId: _dona, ...e }: Espera & { tenantId: string; ownerId: string }): Espera => ({ ...e });
const semDonoTrabalho = ({ ownerId: _dona, ...t }: Trabalho & { ownerId: string }): Trabalho => ({ ...t });

function reposSobre(b: BancoMemoria, escopo: Escopo): Repos {
  const doTenant = <T extends { tenantId: string }>(lista: T[]) => lista.filter((x) => x.tenantId === escopo.tenantId);
  const daDona = <T extends { tenantId: string; ownerId: string }>(lista: T[]) => lista.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId);
  /** As execuções abertas da rotina, mais nova primeiro (a régua de turnoAberto; NOD-84 conta para o teto do webhook). */
  const abertasDaRotina = async (rotinaId: string, ref: number) => {
    const minhas = doTenant(b.janelas).filter((j) => j.rotinaId === rotinaId && j.turnoId !== null);
    const vivo = (x: Turno) => x.estado === "pendente" || x.estado === "despachando";
    const abertas = minhas
      .filter((j) => j.instanteAgendado > ref - 7 * 86_400_000)
      .filter((j) => {
        const t = doTenant(b.turnos).find((x) => x.id === j.turnoId);
        // ADR-099 (I7 revista): sem trabalho, a cadeia de retomadas da execução (até 10 saltos).
        const cadeia = new Set([t?.id]);
        for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
        return t !== undefined && (vivo(t) || (Boolean(t.trabalhoId) && doTenant(b.turnos).some((v) => v.trabalhoId === t.trabalhoId && vivo(v)))
          || (!t.trabalhoId && doTenant(b.turnos).some((v) => cadeia.has(v.id) && vivo(v))));
      })
      .sort((x, y) => y.instanteAgendado - x.instanteAgendado);
    return abertas;
  };
  /** A regra de seguradoPelaCotaSql (turnos.repo.ts): a IA fixada (ou a do modelo), o tipo do turno e o portão da cota. */
  const seguradoPelaCota = (t: Turno, cota: PortaoDaCota): boolean => {
    if (t.origem === "ligacao") return false;
    const ia = harnessFixado(t.harness, t.modelo) ?? (t.modelo !== "auto" ? iaDoModelo(t.modelo) : null);
    const trabalho = t.trabalhoId ? (doTenant(b.trabalhos).find((x) => x.id === t.trabalhoId) ?? null) : null;
    const auto = t.harness === "auto" && t.modelo === "auto";
    const naReserva = auto ? cota.autoReserva : cota.reserva.includes(ia ?? "");
    const noLimite = auto ? cota.autoLimite : cota.limite.includes(ia ?? "");
    return cotaSegura(tipoParaCota(t, trabalho), noLimite ? "limite" : naReserva ? "reserva" : "livre");
  };
  /** A linha do índice único propostas_acesso_de_rotina_aberta (0026): pedido de rotina pendente por (dona, agente, app). */
  const acessoDeRotinaAberto = (agenteId: string, conector: string): Proposta | null =>
    doTenant(b.propostas).find((p) => p.agenteId === agenteId && p.estado === "pendente" && p.payload.kind === "acesso" && p.payload.conector === conector && p.payload.rotinaId !== undefined) ?? null;

  /** O que listarComTurno do repo real devolve: origem e trabalho do turno, e a última fala de um turno encerrado. */
  const comTurno = (lista: Mensagem[]): Mensagem[] => lista.map((m) => {
    const t = m.turnoId ? doTenant(b.turnos).find((x) => x.id === m.turnoId) : undefined;
    const aberto = !m.turnoId ? doTenant(b.turnos).filter((x) => x.mensagemOrigemId === m.id).sort((x, y) => x.criadoEm - y.criadoEm)[0] : undefined;
    const falaDoBot = (x: Mensagem) => x.kind === "texto" && x.autoria.autor_tipo === "agente";
    const ultima = t ? lista.filter((x) => x.turnoId === t.id && falaDoBot(x)).at(-1) : undefined;
    const fimDoTurno = Boolean(t && (t.estado === "concluido" || t.estado === "interrompido") && falaDoBot(m) && ultima?.id === m.id);
    const recusas = fimDoTurno && t ? (b.midiaRecusas.get(t.id) as RecusasMidia | undefined) ?? [] : [];
    return { ...m, origemTurno: t?.origem ?? null, trabalhoId: t?.trabalhoId ?? aberto?.trabalhoId ?? null, fimDoTurno, ...(recusas.length ? { midiaRecusas: recusas } : {}) };
  });
  const minhasCredenciais = () => b.credenciais.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId);
  const minhasEsperas = () => b.esperas.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId);
  /** ADR-108 (turnos.repo daIa): as tasks pendentes do bot na IA — fixadas nela, ou no Automático com a sessão nela. */
  const tasksNaIa = (agenteId: string, ia: string | null) => doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.agenteId === agenteId && t.estado === "pendente" && t.trabalhoId
    && (ia === null || t.harness === ia || (t.harness === "auto" && b.trabalhos.some((w) => w.tenantId === escopo.tenantId && w.id === t.trabalhoId && w.sessaoHarness === ia))));
  const timesEmMemoria = timesDoBanco(b, `${escopo.tenantId}:${escopo.pessoaId}`);
  const repos = {
    computadores: {
      buscarVinculo: async () => null, buscarDoAgente: async () => undefined,
      obter: async () => null, travar: async () => null, configurar: async () => undefined,
      ocupar: async () => undefined, liberar: async () => undefined, atividade: async () => [], ociosos: async () => [], emUsoPor: async () => null,
      buscarAcao: async () => null, concluir: async () => undefined,
      gravarResultado: async () => undefined, tirarResultado: async () => null,
      registrar: async () => { throw new Error("use o banco para testar computadores"); },
      registrarFalha: async () => null, registrarSucesso: async () => false,
      // Sem computador em memória, nenhum está fora do ar (a frota em memória segue igual).
      foraDoAr: async () => new Map(),
      atividadeDoBot: async () => [],
      atividadeDaTela: async () => [],
      ultimoFreio: async () => null,
      // NOD-96: o computador da pessoa no motor só existe no banco (tests/integration/computador-da-pessoa.test.ts).
      daPessoa: async () => null, travarDaPessoa: async () => null, vincularBot: async () => false,
      obterDaPessoa: async () => { throw new Error("use o banco para testar o computador da pessoa"); },
      fixarMaquina: async () => undefined, fixarSupervisor: async () => null, esquecerSupervisor: async () => undefined,
      iniciarOperacao: async () => false, progredirOperacao: async () => false, terminarOperacao: async () => false, arquivarLegado: async () => [], legadosArquivados: async () => [],
      trocarSupervisor: async () => false, fixarLugar: async () => false, adicionarSaidaPendente: async () => false, saidaMarcada: async () => {}, avisoRecriado: async () => false, atividadeDaPessoa: async () => [],
    },
    computadorTelas: {
      buscar: async () => null, porId: async () => null, obter: async () => null, travar: async () => null, doComputador: async () => [], fila: async () => [],
      mudarEstado: async () => false, configurar: async () => undefined, ocupar: async () => undefined, liberar: async () => undefined,
      relatar: async () => undefined, registrarFalha: async () => undefined, apagar: async () => undefined,
    },
    pessoas: {
      async buscar(id: string) {
        return doTenant(b.pessoas).find((p) => p.id === id) ?? null;
      },
      async listarDoTenant() {
        return doTenant(b.pessoas).sort((x, y) => x.nome.localeCompare(y.nome));
      },
    },

    events: {
      async gravarComOutbox(eventos: EventoGravavel[]) {
        const ids: string[] = [];
        for (const ev of eventos) {
          const id = ev.id ?? randomUUID();
          const createdAt = ev.createdAt ?? agora();
          b.events.push({ ...ev, tenantId: escopo.tenantId, id, createdAt });
          b.outbox.push({
            tenantId: escopo.tenantId,
            ownerId: ev.pessoaDestinoId,
            id: randomUUID(),
            eventoId: id,
            tipo: ev.kind,
            dados: ev.dados ?? {},
            tentativas: 0,
            criadoEm: iso(createdAt),
            conversaId: ev.conversaId ?? null,
            turnoId: ev.turnoId ?? null,
            entregueEm: null,
            abandonadoEm: null,
            canceladoEm: null,
          });
          ids.push(id);
        }
        return { ids };
      },
      async gravarSemOutbox(eventos: EventoGravavel[]) {
        for (const ev of eventos) b.events.push({ ...ev, tenantId: escopo.tenantId, id: ev.id ?? randomUUID(), createdAt: ev.createdAt ?? agora() });
        return eventos.length;
      },
      async contarLinhas(desde: number) {
        const linhas = doTenant(b.events).filter((e) => (e.kind === "linha_mostrada" || e.kind === "linha_aberta") && e.pessoaDestinoId === escopo.pessoaId && e.createdAt >= desde);
        const tipos = [...new Set(linhas.map((e) => String(e.dados?.tipo)))];
        const distintas = (tipo: string, kind: string) => new Set(linhas.filter((e) => e.kind === kind && String(e.dados?.tipo) === tipo).map((e) => String(e.dados?.chave_linha))).size;
        return tipos.map((tipo) => ({ tipo, mostradas: distintas(tipo, "linha_mostrada"), abertas: distintas(tipo, "linha_aberta") }));
      },
      async listarRecentes(limite = 50) {
        return doTenant(b.events)
          .sort((x, y) => y.createdAt - x.createdAt)
          .slice(0, limite)
          .map((e) => ({ id: e.id, kind: e.kind, createdAt: iso(e.createdAt) }));
      },
    },

    outbox: {
      async pendentes(limite = 100) {
        return doTenant(b.outbox)
          .filter((o) => o.ownerId === escopo.pessoaId && o.entregueEm === null && o.abandonadoEm === null && o.canceladoEm === null)
          .sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm))
          .slice(0, limite)
          .map(({ id, eventoId, tipo, dados, tentativas, criadoEm }) => {
            const ev = b.events.find((e) => e.id === eventoId);
            return { id, eventoId, tipo, dados, tentativas, criadoEm, conversaId: ev?.conversaId ?? null, turnoId: ev?.turnoId ?? null };
          });
      },
      async paraPublicar(p: { desde: Date; excluir: readonly string[]; limite?: number }) {
        const excluir = new Set(p.excluir);
        const desde = p.desde.getTime();
        return doTenant(b.outbox)
          .filter((o) => o.ownerId === escopo.pessoaId && (o.entregueEm === null || o.entregueEm >= desde) && o.abandonadoEm === null && o.canceladoEm === null && !excluir.has(o.id))
          .sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm))
          .slice(0, p.limite ?? 100)
          .map(({ id, eventoId, tipo, dados, tentativas, criadoEm }) => {
            const ev = b.events.find((e) => e.id === eventoId);
            return { id, eventoId, tipo, dados, tentativas, criadoEm, conversaId: ev?.conversaId ?? null, turnoId: ev?.turnoId ?? null };
          });
      },
      async marcarEntregue(id: string) {
        const o = doTenant(b.outbox).find((x) => x.id === id && x.entregueEm === null);
        if (!o) return false;
        o.entregueEm = agora();
        return true;
      },
      async incrementarTentativa(id: string) {
        const o = doTenant(b.outbox).find((x) => x.id === id);
        if (!o) return null;
        o.tentativas += 1;
        return o.tentativas;
      },
      async abandonar(p: { teto: number; idadeMinMs: number; agora: number }) {
        let n = 0;
        for (const o of doTenant(b.outbox)) {
          if (o.ownerId !== escopo.pessoaId || o.entregueEm !== null || o.abandonadoEm !== null || o.canceladoEm !== null) continue;
          if (o.tentativas >= p.teto && Date.parse(o.criadoEm) < p.agora - p.idadeMinMs) {
            o.abandonadoEm = p.agora;
            n += 1;
          }
        }
        return n;
      },
      async contarAbandonados() {
        return doTenant(b.outbox).filter((o) => o.ownerId === escopo.pessoaId && o.abandonadoEm !== null).length;
      },
      async cancelarPendentesDaPessoa(em: number, conversaId: string | null = null, opcoes: { soDoChat?: true } = {}) {
        let n = 0;
        for (const o of doTenant(b.outbox)) {
          const ev = b.events.find((e) => e.id === o.eventoId);
          if (conversaId !== null && ev?.conversaId !== conversaId) continue;
          if (opcoes.soDoChat && (o.tipo === "trabalho_mudou" || (ev?.turnoId && doTenant(b.turnos).find((t) => t.id === ev.turnoId)?.trabalhoId))) continue;
          if (o.ownerId === escopo.pessoaId && o.entregueEm === null && o.abandonadoEm === null && o.canceladoEm === null) {
            o.canceladoEm = em;
            n += 1;
          }
        }
        return n;
      },
    },

    agentes: {
      async execucaoBloqueada(turnoId) {
        const t = doTenant(b.turnos).find((t) => t.id === turnoId);
        return !!doTenant(b.agentes).find((a) => a.id === t?.agenteId)?.excluidoEm;
      },
      // A geração sobe a cada exclusão (agentes.geracao_execucao, 0012); em memória, um contador por agente.
      async geracaoExecucao(id) {
        return doTenant(b.agentes).some((a) => a.id === id) ? (b.geracoes.get(id) ?? 0) : null;
      },
      async mudarSecao(ids, secao) {
        let n = 0;
        for (const a of doTenant(b.agentes)) if (ids.includes(a.id) && a.ownerId === escopo.pessoaId) { a.secao = secao; n++; }
        return n;
      },
      async organizar(id, campos) {
        const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm);
        if (!a) return null;
        Object.assign(a, campos);
        return a;
      },
      async ordenar(ids) {
        let n = 0;
        ids.forEach((id, i) => {
          const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm);
          if (a) { a.posicao = i; n += 1; }
        });
        return n;
      },
      async excluir(id, em) {
        const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm);
        if (!a) return null;
        a.excluidoEm = em;
        a.configurandoDesde = null;
        a.configurandoTurnoId = null;
        a.fixado = false;
        a.modoAprovacao = "manual";
        b.geracoes.set(id, (b.geracoes.get(id) ?? 0) + 1);
        for (const r of doTenant(b.rotinas).filter((r) => r.agenteId === id)) r.estado = "pausada";
        b.concessoes = b.concessoes.filter((c) => c.agenteId !== id);
        for (const t of doTenant(b.trabalhos).filter((t) => t.agenteId === id && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado))) {
          t.estado = "parado";
          t.terminadoEm = em;
        }
        return a;
      },
      async restaurar(id) {
        const a = doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && a.excluidoEm);
        if (!a) return null;
        a.excluidoEm = null;
        a.oculto = false;
        return a;
      },
      async criar(a) {
        // 0068: como o SQL — a inteligência inteira e os derivados gravados juntos.
        const inteligencia = a.inteligencia ?? inteligenciaDoLegado(INTELIGENCIA_PADRAO, { harness: a.harness ?? "auto", modelo: a.modelo });
        const d = derivadosDa(inteligencia);
        const agente: Agente = {
          tenantId: escopo.tenantId,
          id: a.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: a.visibility ?? (a.dono === "empresa" ? "equipe" : "privado"),
          nome: a.nome,
          titulo: a.titulo ?? "",
          descricao: a.descricao ?? "",
          dono: a.dono,
          forma: a.forma,
          cor: a.cor,
          fixado: false,
          oculto: false,
          confirmado: a.confirmado ?? false,
          modelo: d.modelo,
          harness: d.harness,
          esforco: d.esforco,
          inteligencia,
          duplicadoDe: a.duplicadoDe ?? null,
          ...(a.maquinaId ? { maquinaId: a.maquinaId } : {}),
          // NOD-316: como o INSERT — todo bot nasce no modo inicial.
          modoAprovacao: MODO_APROVACAO_INICIAL,
          criadoEm: agora(),
        };
        b.agentes.push(agente);
        return agente;
      },
      async buscar(id, incluirExcluidos = false) {
        return doTenant(b.agentes).find((a) => a.id === id && (incluirExcluidos || !a.excluidoEm)) ?? null;
      },
      async buscarPorNome(nome) {
        return doTenant(b.agentes).find((a) => a.nome.toLowerCase() === nome.toLowerCase()) ?? null;
      },
      async listar(opcoes = {}) {
        return doTenant(b.agentes)
          .filter((a) => (opcoes.incluirExcluidos || !a.excluidoEm) && (opcoes.incluirOcultos || !a.oculto))
          .sort((x, y) => Number(y.fixado) - Number(x.fixado) || (x.posicao ?? Infinity) - (y.posicao ?? Infinity) || x.criadoEm - y.criadoEm);
      },
      async buscarParaAtualizar(id) {
        // Espelha o SQL: só a dona e não excluído. Sem concorrência na memória, sem lock.
        return doTenant(b.agentes).find((a) => a.id === id && a.ownerId === escopo.pessoaId && !a.excluidoEm) ?? null;
      },
      async iniciarConfiguracao(id, quando, turnoId, expirouAntesDe) {
        // Espelha o SQL (NOD-23): só a dona, confirmado, não excluído e nunca o Nod.
        const a = doTenant(b.agentes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && !x.excluidoEm && x.confirmado && !x.papel);
        if (!a) return false;
        const reinicia = a.configurandoDesde == null || a.configurandoDesde <= expirouAntesDe;
        a.configurandoDesde = quando;
        if (reinicia || !a.configurandoTurnoId) a.configurandoTurnoId = turnoId;
        return true;
      },
      async religarConfiguracao(id, quando, turnoId) {
        const a = doTenant(b.agentes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && !x.excluidoEm && x.confirmado && !x.papel);
        if (!a) return false;
        a.configurandoDesde = quando;
        a.configurandoTurnoId = turnoId;
        return true;
      },
      async encerrarConfiguracao(id, propostaTurnoId) {
        const a = doTenant(b.agentes).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        const proposta = doTenant(b.turnos).find((t) => t.id === propostaTurnoId);
        const inicio = doTenant(b.turnos).find((t) => t.id === a?.configurandoTurnoId);
        const pertence = proposta && inicio && proposta.agenteId === id && inicio.agenteId === id && proposta.conversaId === inicio.conversaId
          && (proposta.criadoEm > inicio.criadoEm || (proposta.criadoEm === inicio.criadoEm && proposta.id >= inicio.id));
        if (a && pertence) {
          a.configurandoDesde = null;
          a.configurandoTurnoId = null;
        }
      },
      async atualizarPerfil(id, perfil) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        Object.assign(a, {
          nome: perfil.nome ?? a.nome,
          titulo: perfil.titulo ?? a.titulo,
          descricao: perfil.descricao ?? a.descricao,
          confirmado: perfil.confirmado ?? a.confirmado,
          forma: perfil.forma ?? a.forma,
          cor: perfil.cor ?? a.cor,
          // 0068: a inteligência grava os derivados junto (harness, modelo e o esforço do Claude).
          ...(perfil.inteligencia ? { inteligencia: perfil.inteligencia, ...derivadosDa(perfil.inteligencia) } : {}),
        });
        return a;
      },
      async definirMaquina(ids, maquinaId) {
        const as = doTenant(b.agentes).filter((x) => ids.includes(x.id) && x.ownerId === escopo.pessoaId && !x.excluidoEm);
        for (const a of as) a.maquinaId = maquinaId;
        return as;
      },
      async definirModoAprovacao(id, modo) {
        const a = doTenant(b.agentes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && !x.excluidoEm);
        if (!a) return null;
        a.modoAprovacao = modo;
        return a;
      },
      async fixar(id, fixado) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        a.fixado = fixado;
        return a;
      },
      async ocultar(id, oculto) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        a.oculto = oculto;
        return a;
      },
      // ADR-104: sem concorrência na memória, a trava dos nomes não faz nada.
      async travarNomesDeBots() {},
      // ADR-081: sem concorrência na memória, travar é só buscar.
      async travarNod() {
        return doTenant(b.agentes).find((a) => a.ownerId === escopo.pessoaId && a.papel === "nod") ?? null;
      },
      async buscarNod() {
        return doTenant(b.agentes).find((a) => a.ownerId === escopo.pessoaId && a.papel === "nod") ?? null;
      },
      async marcarComoNod(id, perfil) {
        const a = doTenant(b.agentes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.dono === "pessoa" && !x.excluidoEm && !x.papel);
        if (!a || doTenant(b.agentes).some((x) => x.ownerId === escopo.pessoaId && x.papel === "nod")) return null;
        Object.assign(a, { ...perfil, papel: "nod", cor: "c-black", fixado: true, oculto: false, confirmado: true });
        return a;
      },
      async definirVoz(id, p) {
        const a = doTenant(b.agentes).find((x) => x.id === id);
        if (!a) return null;
        if (p.voz !== undefined) a.voz = p.voz;
        if (p.velocidade !== undefined) a.vozVelocidade = p.velocidade;
        return a;
      },
    },

    memorias: {
      async criar(m) {
        const memoria: Memoria = { tenantId: escopo.tenantId, id: m.id ?? randomUUID(), agenteId: m.agenteId, tipo: m.tipo, texto: m.texto, origem: m.origem, criadoEm: agora() };
        b.memorias.push(memoria);
        return memoria;
      },
      async buscar(id) {
        return doTenant(b.memorias).find((m) => m.id === id) ?? null;
      },
      async listarDoAgente(agenteId) {
        return doTenant(b.memorias).filter((m) => m.agenteId === agenteId).sort((x, y) => x.criadoEm - y.criadoEm || x.id.localeCompare(y.id));
      },
      // NOD-60: aproximação da busca `nod_pt` (o comportamento real se prova no Postgres): palavra de 4+ letras, sem acento.
      async buscarPorTexto(agenteId, consulta, limite) {
        const palavras = (t: string) => new Set(t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 4));
        const busca = palavras(consulta);
        const nota = (m: Memoria) => [...palavras(m.texto)].filter((p) => busca.has(p)).length;
        return doTenant(b.memorias).filter((m) => m.agenteId === agenteId && nota(m) > 0)
          .sort((x, y) => nota(y) - nota(x) || y.criadoEm - x.criadoEm || x.id.localeCompare(y.id)).slice(0, limite);
      },
      async atualizar(id, campos) {
        const m = doTenant(b.memorias).find((x) => x.id === id);
        if (!m) return null;
        if (campos.texto !== undefined) m.texto = campos.texto;
        if (campos.tipo !== undefined) m.tipo = campos.tipo;
        return m;
      },
      async apagar(id) {
        const i = b.memorias.findIndex((m) => m.tenantId === escopo.tenantId && m.id === id);
        if (i === -1) return null;
        const [m] = b.memorias.splice(i, 1);
        return m ?? null;
      },
      async travar() {},
    },

    // NOD-58: o diário da memória só existe no Postgres (CTE na escrita); aqui, vazio.
    memoriasDiario: {
      listar: async () => ({ entradas: [], mais: false }),
      contarARevisar: async () => 0,
      buscar: async () => null,
      ultimaDaMemoria: async () => null,
      marcarDesfeita: soNoPostgres,
      revisar: soNoPostgres,
    },

    // NOD-20: as versões do perfil; a poda real (SECURITY DEFINER) se prova no Postgres, aqui é o mesmo corte das 50.
    versoesPerfil: {
      async inserir(v) {
        if (b.versoesPerfil.some((x) => x.tenantId === escopo.tenantId && x.agenteId === v.agenteId && x.versao === v.versao)) throw new Error("versão duplicada");
        const nova: VersaoPerfil = {
          id: randomUUID(),
          agenteId: v.agenteId,
          versao: v.versao,
          origem: v.origem,
          autor: v.autor ?? "pessoa",
          propostaId: v.propostaId ?? null,
          restauradaDe: v.restauradaDe ?? null,
          perfil: redigirPerfil(v.perfil),
          campos: [...v.campos],
          criadoEm: agora(),
          redigida: temRedacao(redigirPerfil(v.perfil)),
        };
        b.versoesPerfil.push({ ...nova, tenantId: escopo.tenantId });
        return nova;
      },
      async listar(agenteId, antes, limite = VERSOES_POR_PAGINA) {
        const todas = b.versoesPerfil.filter((x) => x.tenantId === escopo.tenantId && x.agenteId === agenteId && (!antes || x.versao < antes)).sort((x, y) => y.versao - x.versao);
        return { versoes: todas.slice(0, limite).map(({ tenantId: _t, ...v }) => v), mais: todas.length > limite };
      },
      async buscar(agenteId, versao) {
        const v = b.versoesPerfil.find((x) => x.tenantId === escopo.tenantId && x.agenteId === agenteId && x.versao === versao);
        if (!v) return null;
        const { tenantId: _t, ...resto } = v;
        return resto;
      },
      async ultima(agenteId) {
        const todas = b.versoesPerfil.filter((x) => x.tenantId === escopo.tenantId && x.agenteId === agenteId).sort((x, y) => y.versao - x.versao);
        const v = todas[0];
        if (!v) return null;
        const { tenantId: _t, ...resto } = v;
        return resto;
      },
      async contar(agenteId) {
        return b.versoesPerfil.filter((x) => x.tenantId === escopo.tenantId && x.agenteId === agenteId).length;
      },
      async podar(agenteId) {
        const minhas = b.versoesPerfil.filter((x) => x.tenantId === escopo.tenantId && x.agenteId === agenteId);
        const max = Math.max(0, ...minhas.map((x) => x.versao));
        const antes = b.versoesPerfil.length;
        b.versoesPerfil = b.versoesPerfil.filter((x) => !(x.tenantId === escopo.tenantId && x.agenteId === agenteId && x.versao <= max - MAX_VERSOES_PERFIL));
        return antes - b.versoesPerfil.length;
      },
    },

    conversas: {
      async criar(c) {
        const conversa: Conversa = {
          tenantId: escopo.tenantId,
          id: c.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: c.visibility ?? "privado",
          tipo: c.tipo,
          agenteId: c.tipo === "propria" ? c.agenteId : null,
          salaId: c.tipo === "sala" ? c.salaId : null,
          sessaoCli: null,
          criadoEm: agora(),
        };
        b.conversas.push(conversa);
        return conversa;
      },
      async buscar(id) {
        return doTenant(b.conversas).find((c) => c.id === id) ?? null;
      },
      async buscarPropriaDoAgente(agenteId) {
        return doTenant(b.conversas).find((c) => c.tipo === "propria" && c.agenteId === agenteId) ?? null;
      },
      async propriasDosAgentes(agenteIds) {
        const saida = new Map<string, Conversa>();
        for (const id of agenteIds) {
          const c = doTenant(b.conversas).find((x) => x.tipo === "propria" && x.agenteId === id);
          if (c) saida.set(id, c);
        }
        return saida;
      },
      async buscarDaSala(salaId) {
        return doTenant(b.conversas).find((c) => c.tipo === "sala" && c.salaId === salaId) ?? null;
      },
      async listar() {
        return doTenant(b.conversas).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async recomecar(id) {
        const c = doTenant(b.conversas).find((x) => x.id === id);
        if (!c) return false;
        Object.assign(c, { sessaoCli: null, sessaoExecutor: null, sessaoHarness: null, sessaoEm: null, recomecoEm: agora() });
        b.maquinaDaSessao.delete(`conversa:${id}`);
        return true;
      },
      async atualizarSessaoCli(id, sessaoCli, sessaoExecutor = null, sessaoHarness = null, maquinaId = null) {
        const c = doTenant(b.conversas).find((x) => x.id === id);
        if (!c) return false;
        c.sessaoCli = sessaoCli;
        c.sessaoExecutor = sessaoCli ? sessaoExecutor : null;
        c.sessaoHarness = sessaoCli ? sessaoHarness : null;
        c.sessaoEm = sessaoCli ? agora() : null;
        b.contaDaSessao.delete(`conversa:${id}`);
        b.maquinaDaSessao.set(`conversa:${id}`, sessaoCli ? maquinaId : null);
        return true;
      },
      async definirContaDaSessao(id, contaId) { b.contaDaSessao.set(`conversa:${id}`, contaId); },
      async contaDaSessao(id) { return b.contaDaSessao.get(`conversa:${id}`) ?? null;
      },
      async maquinaDaSessao(id) { return b.maquinaDaSessao.get(`conversa:${id}`) ?? null; },
    },

    anexos: {
      async criar(a) {
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), conversaId: a.conversaId, mensagemId: null, nome: a.nome, mime: a.mime, bytes: Buffer.from(a.conteudo), criadoEm: Date.now() };
        b.anexos.push(l);
        return { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength, conversaId: l.conversaId, mensagemId: null };
      },
      async buscar(id) {
        const l = doTenant(b.anexos).find((x) => x.id === id);
        return l ? { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength, conversaId: l.conversaId, mensagemId: l.mensagemId } : null;
      },
      async conteudo(id) {
        const l = doTenant(b.anexos).find((x) => x.id === id);
        return l ? { meta: { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength, conversaId: l.conversaId, mensagemId: l.mensagemId }, bytes: l.bytes } : null;
      },
      async prender(ids, p) {
        return ids.flatMap((id) => {
          const l = doTenant(b.anexos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.conversaId === p.conversaId && x.mensagemId === null && x.origem !== "bot");
          if (!l) return [];
          l.mensagemId = p.mensagemId;
          return [{ id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength }];
        });
      },
      async daMensagens(ids) {
        const saida = new Map<string, { id: string; nome: string; mime: MimeAnexo; tamanho: number }[]>();
        for (const l of doTenant(b.anexos)) {
          if (!l.mensagemId || !ids.includes(l.mensagemId)) continue;
          saida.set(l.mensagemId, [...(saida.get(l.mensagemId) ?? []), { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength }]);
        }
        return saida;
      },
      async metas(ids) {
        return ids.flatMap((id) => {
          const l = doTenant(b.anexos).find((x) => x.id === id);
          return l ? [{ id: l.id, nome: l.nome, mime: l.mime, tamanho: l.bytes.byteLength }] : [];
        });
      },
      async faixa(id, inicio, fim) {
        const l = doTenant(b.anexos).find((x) => x.id === id);
        return l ? l.bytes.subarray(inicio, fim + 1) : null;
      },
      async criarDoBot(a) {
        const ja = doTenant(b.anexos).find((x) => x.origem === "bot" && x.turnoId === a.turnoId && x.sha256 === a.sha256);
        const l = ja ?? {
          tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), conversaId: a.conversaId, mensagemId: null, nome: a.nome,
          mime: a.mime as MimeAnexo, bytes: Buffer.from(a.conteudo), criadoEm: Date.now(), origem: "bot" as const, turnoId: a.turnoId, sha256: a.sha256,
          semBytes: a.semBytes, tamanho: a.tamanho, largura: a.largura, altura: a.altura, duracaoMs: a.duracaoMs,
          caminhoRelativo: a.caminhoRelativo, machineId: a.machineId,
        };
        if (!ja) b.anexos.push(l);
        return { anexo: { id: l.id, nome: l.nome, mime: l.mime, tamanho: l.tamanho ?? l.bytes.byteLength, conversaId: l.conversaId, mensagemId: l.mensagemId, origem: "bot", semBytes: !!l.semBytes }, novo: !ja };
      },
      async localDoBot(id) {
        const l = doTenant(b.anexos).find((x) => x.id === id && x.origem === "bot" && x.ownerId === escopo.pessoaId);
        return l?.caminhoRelativo && l.machineId ? { conversaId: l.conversaId, caminhoRelativo: l.caminhoRelativo, machineId: l.machineId } : null;
      },
      async doBotPorSha(turnoId, sha256) {
        return doTenant(b.anexos).find((x) => x.origem === "bot" && x.turnoId === turnoId && x.sha256 === sha256)?.id ?? null;
      },
      async contarDoTurno(turnoId) {
        return doTenant(b.anexos).filter((x) => x.origem === "bot" && x.turnoId === turnoId).length;
      },
      async prenderDoTurno(turnoId, mensagemId) {
        const soltos = doTenant(b.anexos).filter((x) => x.origem === "bot" && x.turnoId === turnoId && x.mensagemId === null);
        for (const l of soltos) l.mensagemId = mensagemId;
        return soltos.map((l) => l.id);
      },
      async daConversa(ids) {
        const saida = new Map<string, AnexoDaConversa[]>();
        for (const l of doTenant(b.anexos)) {
          if (!l.mensagemId || !ids.includes(l.mensagemId)) continue;
          const a: AnexoDaConversa = {
            id: l.id, nome: l.nome, mime: l.mime, tamanho: l.tamanho ?? l.bytes.byteLength,
            ...(l.origem ? { origem: l.origem } : {}),
            ...(l.largura !== undefined ? { largura: l.largura } : {}),
            ...(l.altura !== undefined ? { altura: l.altura } : {}),
            ...(l.duracaoMs !== undefined ? { duracaoMs: l.duracaoMs } : {}),
            ...(l.semBytes ? { semBytes: true as const } : {}),
          };
          saida.set(l.mensagemId, [...(saida.get(l.mensagemId) ?? []), a]);
        }
        return saida;
      },
      // NOD-326: o espelho do Postgres (ms × 1000 viram os µs do instante; a ordem e o cursor são os mesmos).
      async daBiblioteca(conversaId, antes, limite) {
        const instante = (ms: number) => new Date(ms).toISOString().replace("Z", "000Z");
        const chave = (l: { criadoEm: number; id: string }) => `${instante(l.criadoEm)}|${l.id}`;
        const todos = doTenant(b.anexos)
          .filter((l) => l.conversaId === conversaId && l.origem === "bot" && l.mensagemId !== null)
          .sort((x, y) => (chave(y) < chave(x) ? -1 : chave(y) > chave(x) ? 1 : 0))
          .filter((l) => !antes || chave(l) < `${antes.criadoEm}|${antes.id}`);
        const pagina = todos.slice(0, limite);
        const itens = pagina.map((l) => ({
          id: l.id, nome: l.nome, mime: l.mime, tamanho: l.tamanho ?? l.bytes.byteLength, origem: "bot" as const,
          ...(l.largura !== undefined ? { largura: l.largura } : {}),
          ...(l.altura !== undefined ? { altura: l.altura } : {}),
          ...(l.duracaoMs !== undefined ? { duracaoMs: l.duracaoMs } : {}),
          ...(l.semBytes ? { semBytes: true as const } : {}),
          mensagemId: l.mensagemId!, criadoEm: instante(l.criadoEm),
        }));
        const u = pagina.at(-1);
        return { itens, ultimo: u ? { criadoEm: instante(u.criadoEm), id: u.id } : null, temMais: todos.length > limite };
      },
      async apagarSoltosDoBot(antesDe) {
        const antes = b.anexos.length;
        const vivo = (turnoId: string | null | undefined) => doTenant(b.turnos).some((t) => t.id === turnoId && (t.estado === "pendente" || t.estado === "despachando"));
        b.anexos = b.anexos.filter((x) => !(x.tenantId === escopo.tenantId && x.origem === "bot" && x.mensagemId === null && x.criadoEm < antesDe.getTime() && !vivo(x.turnoId)));
        return antes - b.anexos.length;
      },
    },

    artefatos: {
      async criar(a) {
        const t = agora();
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), agenteId: a.agenteId, conversaId: a.conversaId, titulo: a.titulo, versaoAtual: 1, criadoEm: t, atualizadoEm: t };
        b.artefatos.push(l);
        return semDono(l);
      },
      async buscar(id) {
        // Sem RLS aqui (o isolamento por pessoa se prova na integração), mas o artefato é privado da dona.
        const l = doTenant(b.artefatos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        return l ? semDono(l) : null;
      },
      async proximaVersao(id, titulo) {
        const l = doTenant(b.artefatos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!l) return null;
        l.versaoAtual += 1;
        l.titulo = titulo;
        l.atualizadoEm = agora();
        return semDono(l);
      },
      async gravarVersao(v) {
        if (doTenant(b.artefatoVersoes).some((x) => x.artefatoId === v.artefatoId && x.versao === v.versao)) throw new Error("artefato_versoes_unica");
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, artefatoId: v.artefatoId, versao: v.versao, html: v.html, mensagemId: v.mensagemId, criadoEm: agora() };
        b.artefatoVersoes.push(l);
        return { artefatoId: l.artefatoId, versao: l.versao, html: l.html, mensagemId: l.mensagemId, criadoEm: l.criadoEm };
      },
      async versao(artefatoId, versao) {
        const l = doTenant(b.artefatoVersoes).find((x) => x.artefatoId === artefatoId && x.versao === versao && x.ownerId === escopo.pessoaId);
        return l ? { artefatoId: l.artefatoId, versao: l.versao, html: l.html, mensagemId: l.mensagemId, criadoEm: l.criadoEm } : null;
      },
      async estado(artefatoId) {
        const l = doTenant(b.artefatoEstados).find((x) => x.artefatoId === artefatoId && x.ownerId === escopo.pessoaId);
        return l ? { artefatoId: l.artefatoId, dados: l.dados, atualizadoEm: l.atualizadoEm } : null;
      },
      async salvarEstado(artefatoId, json) {
        // O banco mede o texto normalizado do jsonb; aqui, o texto recebido (a validação veio antes).
        if (Buffer.byteLength(json, "utf8") > ESTADO_MAX_BYTES_ARTEFATO) return null;
        const dados: unknown = JSON.parse(json);
        const existente = doTenant(b.artefatoEstados).find((x) => x.artefatoId === artefatoId && x.ownerId === escopo.pessoaId);
        if (existente) {
          existente.dados = dados;
          existente.json = json;
          existente.atualizadoEm = agora();
          return { artefatoId, dados, atualizadoEm: existente.atualizadoEm };
        }
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, artefatoId, dados, json, atualizadoEm: agora() };
        b.artefatoEstados.push(l);
        return { artefatoId, dados, atualizadoEm: l.atualizadoEm };
      },
    },

    mensagens: {
      async criar(m) {
        const chave = m.idEnvio ? `${escopo.tenantId}:${m.conversaId}:${m.idEnvio}` : null;
        if (chave && b.idsDeEnvio.has(chave)) return null;
        const mensagem: Mensagem = {
          tenantId: escopo.tenantId,
          id: m.id ?? randomUUID(),
          conversaId: m.conversaId,
          turnoId: m.turnoId ?? null,
          autoria: m.autoria,
          kind: m.kind,
          texto: m.texto,
          payload: m.payload ?? null,
          confianca: m.confianca,
          parcial: m.parcial ?? false,
          criadoEm: agora() + b.mensagens.length / 1000,
        };
        b.mensagens.push(mensagem);
        if (chave) b.idsDeEnvio.set(chave, mensagem.id);
        return mensagem;
      },
      async buscarPorIdEnvio(conversaId, idEnvio) {
        const id = b.idsDeEnvio.get(`${escopo.tenantId}:${conversaId}:${idEnvio}`);
        return id ? (doTenant(b.mensagens).find((m) => m.id === id) ?? null) : null;
      },
      async buscar(id) {
        return doTenant(b.mensagens).find((m) => m.id === id) ?? null;
      },
      async listarDaConversa(conversaId, limite = 200) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return todas.slice(Math.max(0, todas.length - limite));
      },
      async textosDaPessoa(conversaId, limite) {
        return doTenant(b.mensagens).filter((m) => m.conversaId === conversaId && m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === escopo.pessoaId && m.kind === "texto").sort((x, y) => y.criadoEm - x.criadoEm).slice(0, limite).map((m) => m.texto);
      },
      async falasDaPessoaNoTurno(turnoId, conversaId) {
        const ids = new Set(doTenant(b.turnos).filter((t) => t.conversaId === conversaId && t.mensagemOrigemId && (t.id === turnoId || t.absorvidoPor === turnoId)).map((t) => t.mensagemOrigemId));
        return doTenant(b.mensagens)
          .filter((m) => ids.has(m.id) && m.conversaId === conversaId && m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === escopo.pessoaId && m.autoria.sob_procuracao_de == null && m.confianca === "confiavel" && m.kind === "texto")
          .sort((x, y) => x.criadoEm - y.criadoEm)
          .map((m) => ({ id: m.id, conversaId: m.conversaId, texto: m.texto, criadoEm: m.criadoEm }));
      },
      async listarComTurno(conversaId, limite = 200) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return comTurno(todas.slice(Math.max(0, todas.length - limite)));
      },
      async doTrabalho(trabalhoId, limite = 300) {
        const turnos = doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId);
        const ids = new Set(turnos.map((t) => t.id));
        const origens = new Set(turnos.flatMap((t) => (t.mensagemOrigemId ? [t.mensagemOrigemId] : [])));
        const todas = doTenant(b.mensagens).filter((m) => (m.turnoId !== null && ids.has(m.turnoId)) || origens.has(m.id)).sort((x, y) => x.criadoEm - y.criadoEm);
        return comTurno(todas.slice(Math.max(0, todas.length - limite)));
      },
      async janelaAte(conversaId, ancoraId, desde, limite = 100) {
        const ancora = doTenant(b.mensagens).find((m) => m.id === ancoraId);
        const todas = doTenant(b.mensagens)
          .filter((m) => m.conversaId === conversaId && m.criadoEm >= desde && (m.id === ancoraId || (ancora ? m.criadoEm <= ancora.criadoEm : true)))
          .sort((x, y) => x.criadoEm - y.criadoEm);
        return todas.slice(Math.max(0, todas.length - limite));
      },
      // O assunto (0091) não mora na Mensagem em memória: o aviso do PR 6 tem teste de integração.
      ultimaComAssunto: soNoPostgres,
      // NOD-380: a busca depende do nod_sem_acento e da RLS do Postgres; os testes são de integração.
      buscarTexto: soNoPostgres,
      buscarDoAgente: soNoPostgres,
      janelaDoAgente: soNoPostgres,
      async contarDesde(conversaId, mensagemId) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId);
        const alvo = todas.find((m) => m.id === mensagemId);
        return alvo ? todas.filter((m) => m.criadoEm >= alvo.criadoEm).length : null;
      },
      async ultimaDaConversa(conversaId) {
        const todas = doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return todas[todas.length - 1] ?? null;
      },
      async ultimasDasConversas(conversaIds) {
        const saida = new Map<string, Mensagem>();
        for (const id of conversaIds) {
          const todas = doTenant(b.mensagens).filter((m) => m.conversaId === id).sort((x, y) => x.criadoEm - y.criadoEm);
          const ultima = todas[todas.length - 1];
          if (ultima) saida.set(id, ultima);
        }
        return saida;
      },
      async pedidoAPessoaDaDecisao(turnoId, decisaoId) {
        return doTenant(b.mensagens).filter((m) => m.turnoId === turnoId && m.payload?.kind === "pedido_a_pessoa" && m.payload.decisaoId === decisaoId).sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async pedidosAPessoaDasDecisoes(turnoIds) {
        const ids = new Set(turnoIds);
        return comTurno(doTenant(b.mensagens).filter((m) => m.turnoId !== null && ids.has(m.turnoId) && m.payload?.kind === "pedido_a_pessoa").sort((x, y) => x.criadoEm - y.criadoEm));
      },
      async pedidoDaTarefa(turnoId) {
        return doTenant(b.mensagens).filter((m) => m.turnoId === turnoId && m.payload?.kind === "peer_pedido").sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async pedidosDeColega(turnoIds) {
        const saida: Record<string, { agenteId: string; nome: string | null }> = {};
        for (const id of turnoIds) {
          const m = doTenant(b.mensagens).filter((x) => x.turnoId === id && x.payload?.kind === "peer_pedido").sort((x, y) => x.criadoEm - y.criadoEm)[0];
          if (m?.payload?.kind === "peer_pedido") saida[id] = { agenteId: m.autoria.autor_id, nome: m.payload.nome ?? null };
        }
        return saida;
      },
      async marcarParcial(id, parcial) {
        const m = doTenant(b.mensagens).find((x) => x.id === id);
        if (!m) return false;
        m.parcial = parcial;
        return true;
      },
      async atualizarSistema(id, m) {
        const x = doTenant(b.mensagens).find((y) => y.id === id && y.kind === "sistema");
        if (!x) return false;
        Object.assign(x, { texto: m.texto, payload: m.payload, turnoId: x.turnoId ?? m.turnoId ?? null });
        return true;
      },
      async acoesNaUltimaFalaDoTurno(turnoId, agenteId, payload) {
        const x = doTenant(b.mensagens).filter((m) => m.turnoId === turnoId && m.autoria.autor_tipo === "agente" && m.autoria.autor_id === agenteId && m.kind === "texto").sort((p, q) => p.criadoEm - q.criadoEm).at(-1);
        if (!x || x.payload) return false;
        x.payload = payload;
        return true;
      },
      async ultimaFalaDoTurno(turnoId, agenteId) {
        return doTenant(b.mensagens).filter((m) => m.turnoId === turnoId && m.autoria.autor_tipo === "agente" && m.autoria.autor_id === agenteId && m.kind === "texto").sort((p, q) => p.criadoEm - q.criadoEm).at(-1)?.id ?? null;
      },
      async marcarParciaisDoTurno(turnoId) {
        let n = 0;
        for (const m of doTenant(b.mensagens)) {
          if (m.turnoId === turnoId && m.autoria.autor_tipo === "agente") {
            m.parcial = true;
            n += 1;
          }
        }
        return n;
      },
    },

    propostas: {
      async criar(p) {
        // O índice único propostas_acesso_de_rotina_aberta (0026) vale aqui também: quem insere pedido de
        // rotina por `criar` em vez de `criarAcessoDeRotina` recebe o mesmo 23505 que o Postgres daria.
        if (p.payload.kind === "acesso" && p.payload.rotinaId && acessoDeRotinaAberto(p.agenteId, p.payload.conector)) {
          throw Object.assign(new Error("duplicate key value violates unique constraint \"propostas_acesso_de_rotina_aberta\""), { code: "23505" });
        }
        const proposta: Proposta = { tenantId: escopo.tenantId, id: p.id ?? randomUUID(), conversaId: p.conversaId, agenteId: p.agenteId, kind: p.payload.kind, estado: "pendente", payload: p.payload, criadoEm: agora() };
        b.propostas.push(proposta);
        return proposta;
      },
      async conexoesPendentes(conector) {
        return doTenant(b.propostas).filter((p) => p.estado === "pendente" && p.payload.kind === "acesso" && p.payload.conector === conector && p.payload.conectar === true).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async criarAcessoDeRotina(p) {
        const existente = acessoDeRotinaAberto(p.agenteId, p.payload.conector);
        if (existente) return { proposta: existente, criada: false };
        const proposta: Proposta = { tenantId: escopo.tenantId, id: p.id ?? randomUUID(), conversaId: p.conversaId, agenteId: p.agenteId, kind: "acesso", estado: "pendente", payload: p.payload, criadoEm: agora() };
        b.propostas.push(proposta);
        return { proposta, criada: true };
      },
      async acessoDeRotinaAberto(agenteId, conector) {
        return acessoDeRotinaAberto(agenteId, conector);
      },
      async exclusoesPendentesDoQuadro(quadroId) {
        return doTenant(b.propostas).filter((p) => p.payload.kind === "quadro_exclusao" && p.estado === "pendente" && p.payload.quadroId === quadroId).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async assumirDoQuadro(quadroId, estado) {
        return doTenant(b.propostas).filter((p) => p.payload.kind === "assumir_quadro" && p.estado === estado && p.payload.quadroId === quadroId).sort((x, y) => y.criadoEm - x.criadoEm);
      },
      async pendentesDeAcessoDaRotina(rotinaId) {
        return doTenant(b.propostas).filter((p) => p.payload.kind === "acesso" && p.estado === "pendente" && p.payload.rotinaId === rotinaId);
      },
      async buscar(id) {
        return doTenant(b.propostas).find((p) => p.id === id) ?? null;
      },
      async travarPedidosDoTurno() {},
      async buscarParaAtualizar(id) {
        // Espelha `buscar`; sem concorrência na memória, sem lock.
        return doTenant(b.propostas).find((p) => p.id === id) ?? null;
      },
      async pendentesDaConversa(conversaId) {
        return doTenant(b.propostas).filter((p) => p.conversaId === conversaId && p.estado === "pendente");
      },
      async acessosPendentesCriadosEntre(desde, ate) {
        return doTenant(b.propostas).filter((p) => p.estado === "pendente" && p.kind === "acesso" && p.criadoEm >= desde && p.criadoEm < ate);
      },
      async decidir(id, estado) {
        const p = doTenant(b.propostas).find((x) => x.id === id && x.estado === "pendente");
        if (!p) return null;
        p.estado = estado;
        return p;
      },
      async ultimaMudancaDaRotina(rotinaId) {
        const confirmadas = doTenant(b.propostas)
          .filter((p) => p.estado === "confirmada" && p.payload.kind === "rotina_atualizacao" && p.payload.rotinaId === rotinaId)
          .map((p) => ({ p, d: doTenant(b.decisoes).find((d) => d.id === p.id && d.estado === "decidida") }))
          .filter((x) => x.d !== undefined)
          .sort((x, y) => Date.parse(y.d?.desfecho?.em ?? "0") - Date.parse(x.d?.desfecho?.em ?? "0") || y.p.criadoEm - x.p.criadoEm);
        const ultima = confirmadas[0];
        return ultima ? { porRegra: ultima.d?.desfecho?.tipo === "decidida_por_regra" } : null;
      },
      async atualizarPayload(id, payload) {
        const p = doTenant(b.propostas).find((x) => x.id === id && x.kind === payload.kind);
        if (!p) return null;
        p.payload = payload;
        return p;
      },
    },

    contasIa: contasIaMemoria(b.contasIa, escopo),
    rotinaRitmo: (() => {
      const da = (rotinaId: string) => b.rotinaRitmo.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.rotinaId === rotinaId);
      const sem = ({ tenantId: _t, ownerId: _o, ...r }: RitmoRotina & { tenantId: string; ownerId: string }): RitmoRotina => ({ ...r });
      return {
        async buscar(rotinaId: string) {
          const r = da(rotinaId);
          return r ? sem(r) : null;
        },
        async tentarTravarParaDesfazer(rotinaId: string) {
          const r = da(rotinaId);
          return r ? sem(r) : null;
        },
        async contar(rotinaId: string, efeito: "soma" | "zera") {
          let r = da(rotinaId);
          if (!r && efeito === "zera") return null;
          if (!r) {
            r = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, rotinaId, semNovidadeSeguidas: 0, sugestaoMensagemId: null, sugeridaEm: null, silenciadaAte: null, desfazer: null };
            b.rotinaRitmo.push(r);
          }
          r.semNovidadeSeguidas = efeito === "soma" ? r.semNovidadeSeguidas + 1 : 0;
          return sem(r);
        },
        async reivindicarCard(rotinaId: string, agora: number, minimo: number) {
          const r = da(rotinaId);
          if (!r || r.sugeridaEm !== null || r.semNovidadeSeguidas < minimo || (r.silenciadaAte !== null && r.silenciadaAte > agora)) return false;
          r.sugeridaEm = agora;
          return true;
        },
        async fixarCard(rotinaId: string, mensagemId: string) {
          const r = da(rotinaId);
          if (r) Object.assign(r, { sugestaoMensagemId: mensagemId, desfazer: null });
        },
        async fecharCard(rotinaId: string, campos: { silenciadaAte: number | null; desfazer: RitmoRotina["desfazer"] }) {
          const r = da(rotinaId);
          if (r) Object.assign(r, { sugeridaEm: null, semNovidadeSeguidas: 0, silenciadaAte: campos.silenciadaAte ?? r.silenciadaAte, desfazer: campos.desfazer });
        },
        async reabrirCard(rotinaId: string, agora: number) {
          const r = da(rotinaId);
          if (r) Object.assign(r, { sugeridaEm: agora, desfazer: null });
        },
      };
    })(),
    trocasDeIa: (() => {
      const minhas = () => b.trocasDeIa.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId);
      const sem = ({ tenantId: _t, ownerId: _o, ...t }: TrocaDeIa & { tenantId: string; ownerId: string }): TrocaDeIa => ({ ...t });
      return {
        async abrir(n) {
          // Revisão do PR 2 (I2): um aberto por bot E IA que parou.
          const aberta = minhas().find((x) => x.agenteId === n.agenteId && x.iaDe === n.iaDe && x.decididoEm === null);
          if (aberta) {
            Object.assign(aberta, { iaPara: n.iaPara, recomendacao: n.recomendacao, voltaEm: n.voltaEm, fixo: n.fixo, machineId: n.machineId, contaDe: n.contaDe ?? aberta.contaDe, aplicarEm: n.recomendacao === "levar" ? aberta.aplicarEm ?? n.aplicarEm : null });
            return { troca: sem(aberta), nova: false };
          }
          const t = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), agenteId: n.agenteId, conversaId: n.conversaId, iaDe: n.iaDe, iaPara: n.iaPara, recomendacao: n.recomendacao, voltaEm: n.voltaEm, criadaEm: n.agora, aplicarEm: n.aplicarEm, decididoEm: null, decisao: null, mensagemId: null, fixo: n.fixo, voltaAoFixo: null, restauradoEm: null, machineId: n.machineId, contaDe: n.contaDe ?? null, voltouEm: null };
          b.trocasDeIa.push(t);
          return { troca: sem(t), nova: true };
        },
        async definirMensagem(id, mensagemId) { const t = minhas().find((x) => x.id === id); if (t) t.mensagemId = mensagemId; },
        async buscar(id) { const t = minhas().find((x) => x.id === id); return t ? sem(t) : null; },
        async abertaDoAgente(agenteId, iaDe) {
          const t = minhas().filter((x) => x.agenteId === agenteId && x.decididoEm === null && (!iaDe || x.iaDe === iaDe)).sort((x, y) => x.criadaEm - y.criadaEm)[0];
          return t ? sem(t) : null;
        },
        async abertasDoAgente(agenteId) { return minhas().filter((x) => x.agenteId === agenteId && x.decididoEm === null).sort((x, y) => x.criadaEm - y.criadaEm).map(sem); },
        async esperaDecidida(agenteId, iaDe) {
          const t = minhas().filter((x) => x.agenteId === agenteId && x.iaDe === iaDe && x.decisao === "esperar" && x.voltouEm === null).sort((x, y) => (y.decididoEm ?? 0) - (x.decididoEm ?? 0))[0];
          return t ? sem(t) : null;
        },
        async fechadaRecente(agenteId, iaDe, desde) {
          const t = minhas().filter((x) => x.agenteId === agenteId && x.iaDe === iaDe && x.decididoEm !== null && x.decididoEm >= desde && x.mensagemId !== null).sort((x, y) => (y.decididoEm ?? 0) - (x.decididoEm ?? 0))[0];
          return t ? sem(t) : null;
        },
        async marcarVoltou(id, em) {
          const t = minhas().find((x) => x.id === id && (x.decisao === "esperar" || x.decisao === "conta") && x.voltouEm === null);
          if (!t) return false;
          t.voltouEm = em;
          return true;
        },
        async fechar(id, decisao, em, voltaAoFixo) {
          const t = minhas().find((x) => x.id === id && x.decididoEm === null);
          if (!t) return null;
          Object.assign(t, { decididoEm: em, decisao, voltaAoFixo: voltaAoFixo ?? null });
          return sem(t);
        },
        async marcarRestaurada(id, em) {
          const t = minhas().find((x) => x.id === id && x.voltaAoFixo !== null && x.restauradoEm === null);
          if (!t) return false;
          t.restauradoEm = em;
          return true;
        },
        async paraVarrer() { return minhas().filter((x) => x.decididoEm === null || (x.voltaAoFixo !== null && x.restauradoEm === null) || ((x.decisao === "esperar" || x.decisao === "conta") && x.voltouEm === null)).sort((x, y) => x.criadaEm - y.criadaEm).map(sem); },
      };
    })(),

    // definido em 2026-10-15 (NOD-277): a espera da cota é leitura SQL (esperas-da-cota.repo.ts); em memória, nenhuma.
    esperasDaCota: {
      async doTrabalhos() {
        return new Map();
      },
      async livres() {
        return [];
      },
    },

    esperas: {
      async criar(e) {
        if (b.esperas.some((x) => x.tenantId === escopo.tenantId && x.turnoId === e.turnoId)) return null;
        const linha = { ...e, tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), estado: "rodando" as const, codigoSaida: null, saida: null, motivoFim: null, quedas: 0, iniciadaEm: null, vistoEm: null, acordouEm: null, criadoEm: agora(), terminadoEm: null };
        b.esperas.push(linha);
        return semDonoEspera(linha);
      },
      async buscar(id) { const e = minhasEsperas().find((x) => x.id === id); return e ? semDonoEspera(e) : null; },
      async buscarTravado(id) { const e = minhasEsperas().find((x) => x.id === id); return e ? semDonoEspera(e) : null; },
      async doTurnoTravada(turnoId) { const e = minhasEsperas().find((x) => x.turnoId === turnoId); return e ? semDonoEspera(e) : null; },
      async paraAMaquina(maquinaId, quando) {
        return minhasEsperas().filter((x) => x.maquinaId === maquinaId && x.estado === "rodando").map((x) => { x.vistoEm = quando; return { id: x.id, comando: x.comando, pasta: x.pasta, iniciada: x.iniciadaEm !== null }; });
      },
      async marcarIniciada(id, quando) { const e = minhasEsperas().find((x) => x.id === id && x.estado === "rodando"); if (!e) return false; e.iniciadaEm ??= quando; e.vistoEm = quando; return true; },
      async gravarQuedas(id, quedas, quando) { const e = minhasEsperas().find((x) => x.id === id && x.estado === "rodando"); if (!e) return false; e.quedas = quedas; e.vistoEm = quando; return true; },
      async finalizar(id, f) {
        const e = minhasEsperas().find((x) => x.id === id && x.estado === "rodando");
        if (!e) return null;
        Object.assign(e, { estado: f.estado, codigoSaida: f.codigo ?? null, saida: f.saida ?? null, motivoFim: f.motivoFim ?? null, terminadoEm: f.agora });
        return semDonoEspera(e);
      },
      async marcarAcordou(id, quando) { const e = minhasEsperas().find((x) => x.id === id && x.acordouEm === null); if (!e) return false; e.acordouEm = quando; return true; },
      async cancelarRodando(alvo, motivoFim, quando) {
        const alvos = minhasEsperas().filter((x) => x.estado === "rodando" && ("conversaId" in alvo ? x.conversaId === alvo.conversaId && (!alvo.soDoChat || !x.trabalhoId) : "trabalhoId" in alvo ? x.trabalhoId === alvo.trabalhoId : true));
        for (const e of alvos) Object.assign(e, { estado: "cancelada", motivoFim, terminadoEm: quando });
        return alvos.map((e) => ({ id: e.id, turnoId: e.turnoId }));
      },
      // O varredor das esperas sem notícia se prova no Postgres (tests/integration/esperar-comando.test.ts).
      async semNoticia() { return []; },
    },
    acoesPeloModo: {
      async registrar(a) {
        const id = randomUUID();
        b.acoesPeloModo.push({ ...a, veredito: a.veredito ?? null, falha: a.falha ?? null, motivo: a.motivo ?? null, revisorModelo: a.revisorModelo ?? null, revisorHarness: a.revisorHarness ?? null, revisorMaquina: a.revisorMaquina ?? null, id, entregueEm: null, revisorMs: null, fichasEntrada: null, fichasSaida: null, desfechoPessoa: null, contestadaEm: null, criadoEm: agora() });
        return id;
      },
      async daDecisao(decisaoId) {
        return b.acoesPeloModo.find((a) => a.decisaoId === decisaoId) ?? null;
      },
      async doTurno(turnoId) {
        return b.acoesPeloModo.filter((a) => a.turnoId === turnoId);
      },
      async concluir(decisaoId, c) {
        const a = b.acoesPeloModo.find((x) => x.decisaoId === decisaoId && x.veredito === null);
        if (!a) return false;
        Object.assign(a, { veredito: c.veredito, falha: c.falha ?? null, motivo: c.motivo ?? null, entregueEm: c.entregueEm ?? null, revisorMs: c.revisorMs ?? null, fichasEntrada: c.fichasEntrada ?? null, fichasSaida: c.fichasSaida ?? null });
        return true;
      },
      async revisoesDoTurno(turnoId) {
        return b.acoesPeloModo.filter((a) => a.turnoId === turnoId && a.revisorModelo !== null).length;
      },
      async pedidasNoTurno(turnoId) {
        return b.acoesPeloModo.filter((a) => a.turnoId === turnoId && a.veredito === "pede").length;
      },
      async revisoesDaPessoaDesde(desde) {
        return b.acoesPeloModo.filter((a) => a.criadoEm >= desde && a.revisorModelo !== null).length;
      },
      async registrarDesfechoPessoa(decisaoId, desfecho) {
        const a = b.acoesPeloModo.find((x) => x.decisaoId === decisaoId && x.desfechoPessoa === null);
        if (a) a.desfechoPessoa = desfecho;
      },
      async naFalaDosTurnos(turnoIds) {
        return b.acoesPeloModo
          .filter((a) => turnoIds.includes(a.turnoId) && ((a.modo === "total" && (a.gatilho === "credencial" || a.gatilho === "arriscado")) || (a.modo === "automatico" && a.veredito === "libera")))
          .map((a) => {
            const itens = a.modo === "automatico" && a.veredito === "libera" && a.decisaoId ? b.itens.filter((i) => i.decisaoId === a.decisaoId) : [];
            const item = itens.length === 1 && itens[0] ? { texto_final: itens[0].textoFinal, destino: itens[0].destino } : null;
            return { id: a.id, turno_id: a.turnoId, modo: a.modo, tipo: a.tipo, gatilho: a.gatilho, resumo: a.resumo, risco: a.risco, veredito: a.veredito ?? null, motivo: a.motivo ?? null, criado_em: new Date(a.criadoEm), linux: false, item };
          });
      },
      async semAprovacaoDoDia(agenteId, f, limite) {
        return b.acoesPeloModo
          .filter((a) => a.agenteId === agenteId && a.criadoEm >= f.ini.getTime() && a.criadoEm < f.fim.getTime() && (a.modo === "total" || a.veredito === "libera"))
          .sort((x, y) => y.criadoEm - x.criadoEm)
          .slice(0, limite)
          .map((a) => ({ id: a.id, modo: a.modo, tipo: a.tipo, gatilho: a.gatilho, resumo: a.resumo, risco: a.risco, veredito: a.veredito ?? null, motivo: a.motivo ?? null, contestada_em: a.contestadaEm === null ? null : new Date(a.contestadaEm), criado_em: new Date(a.criadoEm) }));
      },
      async contarSemAprovacaoDoDia(agenteId, f) {
        return b.acoesPeloModo.filter((a) => a.agenteId === agenteId && a.criadoEm >= f.ini.getTime() && a.criadoEm < f.fim.getTime() && (a.modo === "total" || a.veredito === "libera")).length;
      },
      async contestar(id) {
        const a = b.acoesPeloModo.find((x) => x.id === id && x.modo === "automatico" && x.veredito === "libera");
        if (!a) return null;
        const jaContestada = a.contestadaEm !== null;
        if (!jaContestada) a.contestadaEm = agora();
        return { acao: { id: a.id, agente_id: a.agenteId, tipo: a.tipo, gatilho: a.gatilho, criado_em: new Date(a.criadoEm), contestada_em: new Date(a.contestadaEm ?? agora()) }, jaContestada };
      },
      async podar(antesDe) {
        const antes = b.acoesPeloModo.length;
        b.acoesPeloModo = b.acoesPeloModo.filter((a) => a.criadoEm >= antesDe);
        return antes - b.acoesPeloModo.length;
      },
    },
    turnoCredenciais: {
      async gravar(c) {
        const i = b.credenciais.findIndex((x) => x.tenantId === escopo.tenantId && x.turnoId === c.turnoId);
        if (i >= 0 && b.credenciais[i]!.epoch > c.epoch) return;
        if (i >= 0) b.credenciais.splice(i, 1);
        b.credenciais.push({ ...c, falasSeq: 0, tenantId: escopo.tenantId, ownerId: escopo.pessoaId });
      },
      async buscar(turnoId) { return minhasCredenciais().find((x) => x.turnoId === turnoId) ?? null; },
      async buscarPorHash(hash) { return minhasCredenciais().find((x) => x.tokenHash.equals(hash)) ?? null; },
      async registrarFalas(turnoId, seq) { const c = minhasCredenciais().find((x) => x.turnoId === turnoId); if (c) c.falasSeq = Math.max(c.falasSeq, seq); },
      async apagar(turnoId) { b.credenciais = b.credenciais.filter((x) => !(x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.turnoId === turnoId)); },
      async quaisSobrevivem(ids) { return new Set(minhasCredenciais().filter((x) => ids.includes(x.turnoId) && x.sobreviveReinicio).map((x) => x.turnoId)); },
    },
    trabalhos: {
      async tarefasComFrenteAberta() { return new Set<string>(); },
      async criar(n) {
        const linha: Trabalho & { ownerId: string } = {
          tenantId: escopo.tenantId,
          ownerId: escopo.pessoaId,
          id: n.id ?? randomUUID(),
          agenteId: n.agenteId,
          conversaId: n.conversaId,
          titulo: n.titulo,
          origem: n.origem,
          pedidoPorAgenteId: n.pedidoPorAgenteId ?? null,
          rotinaId: n.rotinaId ?? null,
          trabalhoMaeId: n.trabalhoMaeId ?? null,
          depoisDeTrabalhoId: n.depoisDeTrabalhoId ?? null,
          estado: n.estado ?? "na_fila",
          sessaoCli: n.sessaoCli ?? null,
          sessaoHarness: n.sessaoHarness ?? null,
          sessaoExecutor: n.sessaoCli ? (n.sessaoExecutor ?? null) : null,
          pasta: n.pasta ?? null,
          memoriaMb: null,
          custoUsd: null,
          pessoaEsperando: n.pessoaEsperando === true,
          forma: n.forma ?? "task",
          loteId: n.loteId ?? null,
          resumo: null,
          criadoEm: agora() + b.trabalhos.length / 1000,
          iniciadoEm: n.iniciadoEm ?? null,
          terminadoEm: null,
        };
        b.trabalhos.push(linha);
        return semDonoTrabalho(linha);
      },
      async buscar(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id);
        return t ? semDonoTrabalho(t) : null;
      },
      async buscarTravado(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id);
        return t ? semDonoTrabalho(t) : null;
      },
      async listar(p) {
        return doTenant(b.trabalhos)
          .filter((t) => (!p.agenteId || t.agenteId === p.agenteId) && (t.terminadoEm === null || t.terminadoEm >= p.terminadosDesde))
          .sort((x, y) => Number(x.terminadoEm !== null) - Number(y.terminadoEm !== null) || y.criadoEm - x.criadoEm)
          .map(semDonoTrabalho);
      },
      async abertosDoAgente(agenteId) {
        return doTenant(b.trabalhos).filter((t) => t.agenteId === agenteId && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado)).sort((x, y) => x.criadoEm - y.criadoEm).map(semDonoTrabalho);
      },
      async filhaAbertaDaRotina(rotinaId, colegaAntesDe = null) {
        // NOD-274 (C9): a frente 'rodando' sem turno vivo cujo único fato aberto é o colega pedido antes do prazo não segura.
        const soColegaAntigo = (w: Trabalho): boolean => {
          if (colegaAntesDe === null || w.estado !== "rodando") return false;
          const dele = doTenant(b.turnos).filter((t) => t.trabalhoId === w.id);
          const ids = new Set(dele.map((t) => t.id));
          if (dele.some((t) => t.estado === "pendente" || t.estado === "despachando")) return false;
          if (b.esperas.some((e) => e.tenantId === escopo.tenantId && e.trabalhoId === w.id && e.estado === "rodando")) return false;
          if (doTenant(b.decisoes).some((d) => d.turnoId !== null && ids.has(d.turnoId) && (d.estado === "pendente" || d.estado === "reaberta"))) return false;
          return doTenant(b.mensagens).some((h) => h.kind === "handoff" && h.turnoId !== null && ids.has(h.turnoId) && h.payload?.kind === "handoff" && Boolean(h.payload.tarefaId)
            && h.criadoEm < colegaAntesDe
            && !doTenant(b.mensagens).some((r) => r.conversaId === h.conversaId && r.payload?.kind === "peer_ask" && h.payload?.kind === "handoff" && r.payload.tarefaId === h.payload.tarefaId)
            && !doTenant(b.trabalhos).some((c) => h.payload?.kind === "handoff" && c.id === h.payload.trabalhoId && ["terminado", "parado", "falhou"].includes(c.estado)));
        };
        const t = doTenant(b.trabalhos).find((x) => x.rotinaId === rotinaId && (x.trabalhoMaeId !== null || x.forma === "frente") && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(x.estado) && !soColegaAntigo(x));
        return t ? semDonoTrabalho(t) : null;
      },
      async atividade(id) {
        const meus = doTenant(b.turnos).filter((t) => t.trabalhoId === id);
        const vivos = meus.filter((t) => t.estado === "pendente" || t.estado === "despachando").length;
        return { vivos, ultimaEm: meus.length ? Math.max(...meus.map((t) => t.criadoEm)) : null };
      },
      async filhos(maeId) {
        return doTenant(b.trabalhos).filter((t) => t.trabalhoMaeId === maeId).map(semDonoTrabalho);
      },
      async mudarEstado(id, estado, em, opcoes = {}) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return null;
        const finais = ["terminado", "parado", "falhou"];
        if (finais.includes(t.estado) && !finais.includes(estado) && opcoes.reabrir !== true) return null;
        t.estado = estado;
        if (estado === "rodando" || estado === "precisa_de_voce") t.iniciadoEm ??= em;
        t.terminadoEm = estado === "terminado" || estado === "parado" || estado === "falhou" ? em : null;
        return semDonoTrabalho(t);
      },
      async atualizarSessao(id, sessaoCli, harness, executor = null, maquinaId = null) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return false;
        t.sessaoCli = sessaoCli;
        t.sessaoHarness = harness;
        t.sessaoExecutor = executor;
        b.contaDaSessao.delete(`trabalho:${id}`);
        b.maquinaDaSessao.set(`trabalho:${id}`, maquinaId);
        return true;
      },
      async definirContaDaSessao(id, contaId) { b.contaDaSessao.set(`trabalho:${id}`, contaId); },
      async contaDaSessao(id) { return b.contaDaSessao.get(`trabalho:${id}`) ?? null;
      },
      async marcarCustoParcial(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (t) t.custoParcial = true;
      },
      async maquinaDaSessao(id) { return b.maquinaDaSessao.get(`trabalho:${id}`) ?? null; },
      async largarSessao(id) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return false;
        Object.assign(t, { sessaoCli: null, sessaoHarness: null, sessaoExecutor: null });
        b.contaDaSessao.delete(`trabalho:${id}`);
        b.maquinaDaSessao.delete(`trabalho:${id}`);
        return true;
      },
      async somarCusto(id, custoUsd) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return false;
        t.custoUsd = (t.custoUsd ?? 0) + custoUsd;
        return true;
      },
      async atualizarMemoria(porTurno) {
        let n = 0;
        for (const p of porTurno) {
          const turno = doTenant(b.turnos).find((x) => x.id === p.turnoId);
          const t = turno?.trabalhoId ? doTenant(b.trabalhos).find((x) => x.id === turno.trabalhoId && x.ownerId === escopo.pessoaId) : undefined;
          const mb = Math.max(0, Math.round(p.mb));
          if (!t || t.memoriaMb === mb) continue;
          t.memoriaMb = mb;
          n += 1;
        }
        return n;
      },
      async travarEsperas() {
        // Em memória tudo roda em série: não há o que travar.
      },
      async marcarDepoisDe(id, depoisDeId) {
        const t = doTenant(b.trabalhos).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!t) return null;
        t.depoisDeTrabalhoId = depoisDeId;
        return semDonoTrabalho(t);
      },
      async redeComSessao(conversaId, sessaoCli) {
        const t = doTenant(b.trabalhos).filter((x) => x.conversaId === conversaId && x.origem === "rede" && x.sessaoCli === sessaoCli).sort((x, y) => y.criadoEm - x.criadoEm)[0];
        return t ? semDonoTrabalho(t) : null;
      },
      async fatos(id) {
        const dele = doTenant(b.turnos).filter((t) => t.trabalhoId === id);
        const ids = new Set(dele.map((t) => t.id));
        const terminais = dele.filter((t) => (t.estado === "concluido" || t.estado === "interrompido") && t.motivoInterrupcao !== "absorvido").sort((x, y) => y.criadoEm - x.criadoEm);
        const ultimo = terminais[0];
        const depoisDe = doTenant(b.trabalhos).find((w) => w.id === id)?.depoisDeTrabalhoId ?? null;
        const dep = depoisDe ? doTenant(b.trabalhos).find((w) => w.id === depoisDe) : undefined;
        return {
          parando: dele.filter((t) => t.estado === "despachando" && t.pararSolicitadoEm !== null).length,
          despachando: dele.filter((t) => t.estado === "despachando" && t.pararSolicitadoEm === null).length,
          pendentes: dele.filter((t) => t.estado === "pendente" && (t.acordarEm ?? 0) <= agora()).length,
          aguardandoDespertar: dele.some((t) => t.estado === "pendente" && (t.acordarEm ?? 0) > agora()),
          aguardandoComando: b.esperas.some((e) => e.tenantId === escopo.tenantId && e.trabalhoId === id && e.estado === "rodando"),
          esperandoOutro: dep !== undefined && !["terminado", "parado", "falhou"].includes(dep.estado),
          decisaoPendente: doTenant(b.decisoes).some((d) => d.turnoId !== null && ids.has(d.turnoId) && (d.estado === "pendente" || d.estado === "reaberta") && (d.tipo !== "retomar_turno" || d.turnoId === ultimo?.id)),
          ...((() => {
            const pergunta = doTenant(b.decisoes).filter((d) => d.turnoId !== null && ids.has(d.turnoId) && d.tipo !== "retomar_turno").sort((x, y) => Date.parse(y.criadoEm) - Date.parse(x.criadoEm))[0];
            return pergunta && pergunta.estado === "vencida" && pergunta.turnoId === ultimo?.id ? { perguntaVencida: true } : {};
          })()),
          aguardandoColega: doTenant(b.mensagens).some((h) => h.kind === "handoff" && h.turnoId !== null && ids.has(h.turnoId) && h.payload?.kind === "handoff" && Boolean(h.payload.tarefaId)
            && !doTenant(b.mensagens).some((r) => r.conversaId === h.conversaId && r.payload?.kind === "peer_ask" && h.payload?.kind === "handoff" && r.payload.tarefaId === h.payload.tarefaId)
            && !doTenant(b.trabalhos).some((c) => h.payload?.kind === "handoff" && c.id === h.payload.trabalhoId && ["terminado", "parado", "falhou"].includes(c.estado))),
          ultimo:ultimo ? { estado: ultimo.estado, motivo: ultimo.motivoInterrupcao } : null,
        };
      },
      async extras(ids) {
        const saida = new Map<string, ExtrasTrabalho>();
        for (const id of ids) {
          const t = doTenant(b.trabalhos).find((x) => x.id === id);
          if (!t) continue;
          const turnos = doTenant(b.turnos).filter((x) => x.trabalhoId === id);
          const doTurno = new Set(turnos.map((x) => x.id));
          const falas = doTenant(b.mensagens).filter((m) => m.turnoId !== null && doTurno.has(m.turnoId) && m.kind === "texto" && m.autoria.autor_tipo === "agente");
          saida.set(id, {
            pedidoPorNome: doTenant(b.agentes).find((a) => a.id === t.pedidoPorAgenteId)?.nome ?? null,
            rotinaNome: doTenant(b.rotinas).find((r) => r.id === t.rotinaId)?.instrucao ?? null,
            ultimaFala: falas.at(-1)?.texto ?? null,
            turnoVivoId: turnos.find((x) => x.estado === "despachando")?.id ?? null,
            turnosAbertos: turnos.filter((x) => x.estado === "pendente" || x.estado === "despachando").map((x) => x.id),
            deFora: t.origem === "colega" || turnos.some((x) => b.contaminados.has(x.id) || x.entradaConfianca !== "confiavel"),
            // O tempo e o colega esperado se provam no Postgres (tests/integration/repos/trabalhos.test.ts).
            esperandoColega: null,
            trabalhouMs: 0,
            acordaEm: turnos.filter((x) => x.estado === "pendente" && x.acordarEm).map((x) => x.acordarEm!).sort((a, z) => a - z)[0] ?? null,
            // As esperas de comando (ADR-099) se provam no Postgres (tests/integration/esperar-comando.test.ts).
            esperandoComando: null,
            // O alvo pela chave viva (desta vez → bot → padrão) se prova no Postgres; aqui, só a máquina do bot.
            maquinaVivaId: turnos.find((x) => x.estado === "despachando")?.machineId ?? null,
            maquinaAlvoId: doTenant(b.agentes).find((a) => a.id === t.agenteId)?.maquinaId ?? null,
            pendente: (() => {
              const p = turnos.filter((x) => x.estado === "pendente").sort((a, z) => a.criadoEm - z.criadoEm)[0];
              return p ? { harness: p.harness ?? "auto", modelo: p.modelo } : null;
            })(),
          });
        }
        return saida;
      },
      // Os pedidos parados se provam no Postgres (tests/integration/pedidos-parados.test.ts); a memória não os vê.
      async pedidosAColegaParados() {
        return [];
      },
      // A limpeza (ADR-088) se prova no Postgres (tests/integration/limpeza-das-tasks.test.ts); a memória não a vê.
      async candidatosALimpeza() {
        return [];
      },
    },

    turnos: {
      async somarRecusasDeMidia(id, recusas) {
        const t = b.turnos.find((x) => x.id === id);
        if (!t || t.estado !== "despachando") return false;
        const soma = new Map((b.midiaRecusas.get(id) ?? []).map((r) => [r.motivo, r.n]));
        for (const r of recusas) soma.set(r.motivo, Math.min(1000, (soma.get(r.motivo) ?? 0) + r.n));
        b.midiaRecusas.set(id, [...soma].sort(([x], [y]) => x.localeCompare(y)).map(([motivo, n]) => ({ motivo, n })));
        return true;
      },
      async recusasDeMidia(id) {
        return (b.midiaRecusas.get(id) as RecusasMidia | undefined) ?? null;
      },
      // NOD-219: os órfãos se provam no Postgres (tests/integration/turnos-orfaos.test.ts) — a geração do agente vive na
      // tabela e no trigger da 0012, que a memória não tem.
      async orfaosCandidatos() {
        return [];
      },
      // NOD-309 (PR 4): como os órfãos, o fundo preso se prova no Postgres (tests/integration/turnos-orfaos.test.ts).
      async fundosPresos() {
        return [];
      },
      async encerrarOrfao() {
        return null;
      },
      // NOD-314: o preso sem contato depende do alvo (maquina_tokens) e se prova no Postgres, como os órfãos.
      async encerrarPresoSemContato() {
        return null;
      },
      async buscarPorMensagemOrigem(mensagemId: string) {
        return doTenant(b.turnos).filter((t) => t.mensagemOrigemId === mensagemId).sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async buscarTravado(id: string) {
        return doTenant(b.turnos).find((t) => t.id === id) ?? null;
      },
      async travarRetomadas() {
        // Em memória tudo roda em série: não há o que travar.
      },
      async quedasDaCadeia(raizId: string, exceto: string, desde: number) {
        const todos = doTenant(b.turnos);
        const cadeia = new Set([raizId]);
        for (let mudou = true; mudou;) {
          mudou = false;
          for (const t of todos) if (t.retomaTurnoId && cadeia.has(t.retomaTurnoId) && !cadeia.has(t.id)) { cadeia.add(t.id); mudou = true; }
        }
        return todos.filter((t) => cadeia.has(t.id) && t.id !== exceto && t.estado === "interrompido"
          && (MOTIVOS_DE_QUEDA as readonly string[]).includes(t.motivoInterrupcao ?? "") && !QUEDAS_FORA_DO_TETO.includes(t.motivoInterrupcao ?? "") && !(MOTIVOS_FALHA_SEM_QUEDA as readonly string[]).includes(t.motivoFalha ?? "")
          && (ULTIMO_SINAL.get(t) ?? t.criadoEm) >= desde).length;
      },
      async reescreverFundoDoBot(agenteId: string, para: { harness: NonNullable<Turno["harness"]>; modelo: string }) {
        const todos = doTenant(b.turnos);
        const raizDeFundo = (t: Turno): boolean => {
          let atual: Turno | undefined = t;
          for (let saltos = 0; atual && atual.origem === "retomada" && saltos < 50; saltos++) atual = todos.find((x) => x.id === atual?.retomaTurnoId);
          return atual !== undefined && atual !== t && ["rotina", "delegacao", "peer"].includes(atual.origem);
        };
        const alvo = todos.filter((t) => t.ownerId === escopo.pessoaId && t.agenteId === agenteId && t.estado === "pendente" && t.origem !== "ligacao"
          && (t.trabalhoId ?? null) === null && (["rotina", "delegacao", "peer"].includes(t.origem) || (t.origem === "retomada" && raizDeFundo(t))));
        for (const t of alvo) {
          t.harness = para.harness;
          t.modelo = para.modelo;
          b.contaDoTurno.delete(t.id);
          if (t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)) t.acordarEm = null;
        }
        return alvo.length;
      },
      async anteciparEsperasDaCota(ia: string | null, opcoes: { turnoId?: string; agenteId?: string } = {}) {
        const iaDe = (t: Turno): string | null => (t.harness ?? "auto") !== "auto" ? t.harness! : t.modelo === "auto" ? null : (iaDoModelo(t.modelo) ?? HARNESS_LEGADO);
        const alvo = doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (t.acordarEm ?? null) !== null && t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)
          && (opcoes.turnoId === undefined || t.id === opcoes.turnoId) && (opcoes.agenteId === undefined || t.agenteId === opcoes.agenteId)
          && (ia === null || iaDe(t) === null || iaDe(t) === ia));
        for (const t of alvo) t.acordarEm = null;
        return alvo.map((t) => t.id);
      },
      async voltaDaCotaNaFila(trabalhoId: string) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.trabalhoId === trabalhoId && t.origem === "retomada" && t.estado === "pendente" && (t.acordarEm ?? null) !== null && ehVoltaDoFundo(t.entradaTexto))
          .sort((x, y) => x.criadoEm - y.criadoEm)[0] ?? null;
      },
      async retomadaNaFila(retomaTurnoId: string) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.retomaTurnoId === retomaTurnoId && t.origem === "retomada" && t.estado === "pendente" && (t.acordarEm ?? 0) <= agora()).sort((x, y) => y.criadoEm - x.criadoEm)[0] ?? null;
      },
      async marcarDespertar(id: string, em: number, motivo: string, ci: { prUrl: string } | null = null) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "despachando" && x.pararSolicitadoEm === null);
        if (!t) return false;
        despertares.set(id, { em, motivo, prUrlCi: ci?.prUrl ?? null });
        return true;
      },
      marcarVoltaCi: soNoPostgres,
      voltasCiPendentes: async () => [],
      acordarVolta: soNoPostgres,
      async despertarDoTurno(id: string) {
        return despertares.get(id) ?? null;
      },
      async voltasMarcadas(retomaTurnoId: string) {
        return doTenant(b.turnos).filter((t) => t.retomaTurnoId === retomaTurnoId && t.acordarEm != null && !ehVoltaDoFundo(t.entradaTexto)).length;
      },
      async ultimasVoltas(retomaTurnoId: string, limite: number) {
        return doTenant(b.turnos)
          .filter((t) => t.retomaTurnoId === retomaTurnoId && t.acordarEm != null)
          .sort((x, y) => y.criadoEm - x.criadoEm)
          .slice(0, limite)
          .map((t) => ({
            estado: t.estado,
            marcouVolta: despertares.has(t.id) || b.esperas.some((e) => e.tenantId === escopo.tenantId && e.turnoId === t.id),
            perguntou: doTenant(b.decisoes).some((d) => d.turnoId === t.id),
            pediuAColega: doTenant(b.mensagens).some((m) => m.turnoId === t.id && m.kind === "handoff"),
            porCota: ehVoltaDoFundo(t.entradaTexto),
          }));
      },
      async contarTasksNaIa(agenteId, iaDe) {
        return new Set(tasksNaIa(agenteId, iaDe).map((t) => t.trabalhoId)).size;
      },
      async levarTasksDoBot(p) {
        const ids: string[] = [];
        for (const t of tasksNaIa(p.agenteId, p.iaDe)) {
          const daCota = t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA);
          Object.assign(t, { harness: p.harness, modelo: p.modelo, ...(daCota ? { acordarEm: null, entradaTexto: entradaLevadaComPedido(t.entradaTexto, p.entradaDaVolta) } : {}) });
          ids.push(t.id);
        }
        return ids;
      },
      async trazerTasksDeVolta(p) {
        const ids: string[] = [];
        for (const t of doTenant(b.turnos).filter((x) => x.ownerId === escopo.pessoaId && x.agenteId === p.agenteId && x.estado === "pendente" && x.trabalhoId && x.harness === p.de)) {
          Object.assign(t, { harness: p.harness, modelo: p.modelo });
          ids.push(t.id);
        }
        return ids;
      },
      async acordarEsperasDaCota(agenteId, iaDe) {
        const alvo = tasksNaIa(agenteId, iaDe).filter((t) => t.acordarEm !== null && t.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA));
        for (const t of alvo) t.acordarEm = null;
        return alvo.length;
      },
      async juntarEntrada(id: string, texto: string, anexos: readonly string[] = [], opcoes: { profundidade?: Profundidade } = {}) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "pendente" && x.pararSolicitadoEm == null);
        if (!t) return null;
        if (opcoes.profundidade !== undefined && opcoes.profundidade > t.profundidade) t.profundidade = opcoes.profundidade;
        t.entradaTexto = `${t.entradaTexto}\n\n${texto}`;
        t.entradaAnexos = [...new Set([...t.entradaAnexos, ...anexos])];
        return t;
      },
      async raizDaCadeia(id: string) {
        let atual = doTenant(b.turnos).find((t) => t.id === id) ?? null;
        for (let saltos = 0; atual?.retomaTurnoId && saltos < 50; saltos++) atual = doTenant(b.turnos).find((t) => t.id === atual?.retomaTurnoId) ?? atual;
        return atual;
      },
      async liberarComputador(raizId: string) {
        if (!doTenant(b.turnos).some((t) => t.id === raizId && t.ownerId === escopo.pessoaId)) return false;
        b.computadorLiberado.add(raizId);
        return true;
      },
      async computadorLiberado(raizId: string) {
        return b.computadorLiberado.has(raizId);
      },
      async liberarTerminal(raizId: string) {
        if (!doTenant(b.turnos).some((t) => t.id === raizId && t.ownerId === escopo.pessoaId)) return false;
        b.terminalLiberado.add(raizId);
        return true;
      },
      async terminalLiberado(raizId: string) {
        return b.terminalLiberado.has(raizId);
      },
      async contaminar(id: string) {
        if (!doTenant(b.turnos).some((t) => t.id === id && t.ownerId === escopo.pessoaId)) return false;
        b.contaminados.add(id);
        return true;
      },
      async trabalhosDosTurnos(ids: readonly string[]) {
        return new Map(doTenant(b.turnos).filter((t) => ids.includes(t.id)).map((t) => [t.id, t.trabalhoId ?? null] as [string, string | null]));
      },
      async contaminado(id: string) {
        return b.contaminados.has(id);
      },
      // A janela de 24 h não é simulada (a marca em memória não guarda o instante): qualquer turno da conversa conta.
      async conversaLeuDeFora(conversaId: string) {
        return doTenant(b.turnos).some((t) => t.conversaId === conversaId && (b.contaminados.has(t.id) || t.entradaConfianca !== "confiavel"));
      },
      // ADR-066: os repositórios em memória não guardam sessão do CLI — a retomada de rotina/delegação começa nova.
      async sessaoDoTurno() {
        return null;
      },
      async largarSessao() {
        return false;
      },
      // NOD-312: sem sessão do CLI em memória (acima), nunca há o que perder.
      async ultimaSessaoDaConversa() {
        return null;
      },
      async registrarMotivoRecomeco(id, motivo) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (!t || t.motivoRecomeco) return false;
        t.motivoRecomeco = motivo;
        return true;
      },
      async limparMotivoRecomeco(id) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (t) delete t.motivoRecomeco;
      },
      async ultimosDaConversa(conversaId, agenteId, antesDe, desde, limite = 8) {
        return doTenant(b.turnos)
          .filter((t) => t.conversaId === conversaId && t.agenteId === agenteId && (t.origem === "conversa" || t.origem === "retomada") && !t.trabalhoId && !t.sobProcuracaoDe && !t.ligacaoId
            && t.motivoInterrupcao !== "absorvido" && t.id !== antesDe.id && t.criadoEm < antesDe.criadoEm && (desde === null || t.criadoEm > desde))
          .sort((a, c) => a.criadoEm - c.criadoEm)
          .slice(-limite);
      },
      async registrarExecutor(id, executor) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (t) t.executor = executor;
      },
      async registrarConta(id, contaId) { b.contaDoTurno.set(id, contaId); },
      async contaDoTurno(id) { return b.contaDoTurno.get(id) ?? null; },
      async registrarIa(id, harness, contaId) { b.harnessEfetivo.set(id, harness); b.contaDoTurno.set(id, contaId); },
      async enfileirar(t) {
        const turno: Turno = {
          tenantId: escopo.tenantId,
          id: t.id ?? randomUUID(),
          conversaId: t.conversaId,
          agenteId: t.agenteId,
          ownerId: escopo.pessoaId,
          origem: t.origem,
          estado: t.interrompidoCom ? "interrompido" : "pendente",
          sinais: { attempted: false, rejected: false, promptSubmitted: false, producedOutput: false },
          machineId: null,
          leaseAte: null,
          prazoEm: t.prazoEm,
          motivoInterrupcao: t.interrompidoCom ?? null,
          motivoFalha: null,
          semNovidadeMotivo: null,
          retomaTurnoId: t.retomaTurnoId ?? null,
          profundidade: t.profundidade,
          reenvios: t.reenvios ?? 0,
          pararSolicitadoEm: null,
          entradaTexto: t.entradaTexto,
          entradaAnexos: [...(t.entradaAnexos ?? [])],
          entradaConfianca: t.entradaConfianca,
          custoUsd: null,
          modelo: t.modelo,
          harness: t.harness ?? "auto",
          executor: t.executor,
          criadoEm: agora() + b.turnos.length / 1000,
          mensagemOrigemId: t.mensagemOrigemId ?? null,
          absorvidoPor: null,
          sobProcuracaoDe: t.sobProcuracaoDe ?? null,
          // Auditoria A3 (2026-10-15): o turno-cérebro guarda a ligação, como a coluna `ligacao_id` do repo real.
          ligacaoId: t.ligacaoId ?? null,
          // A retomada herda o trabalho do turno que continua, como o INSERT do repo real.
          trabalhoId: t.trabalhoId !== undefined ? t.trabalhoId : t.retomaTurnoId ? (doTenant(b.turnos).find((r) => r.id === t.retomaTurnoId)?.trabalhoId ?? null) : null,
          acordarEm: t.acordarEm ?? null,
          pessoaEsperando: t.pessoaEsperando === true,
          tentativasTransitorias: t.tentativasTransitorias ?? 0,
        };
        b.turnos.push(turno);
        if (t.maquinaDestaVez) { b.maquinaDestaVez.set(turno.id, t.maquinaDestaVez); turno.maquinaDestaVez = t.maquinaDestaVez; }
        // NOD-287: a marca da web do turno de origem nasce junto, como o INSERT do repo real.
        if (t.contaminadoDe && b.contaminados.has(t.contaminadoDe)) b.contaminados.add(turno.id);
        // ADR-130: a faixa nasce no INSERT; a retomada e a repetição herdam a do turno que continuam.
        if (nasceNosBastidores(t) || [t.retomaTurnoId, t.contaminadoDe].some((x) => x && b.bastidores.has(x))) { b.bastidores.add(turno.id); turno.bastidores = true; }
        return turno;
      },
      async buscar(id) {
        return doTenant(b.turnos).find((t) => t.id === id) ?? null;
      },
      async reivindicar(p) {
        // NOD-94: a máquina só-computador nunca pega turno (como o turnos.repo.ts).
        if (b.maquinaTokens.some((k) => k.tenantId === escopo.tenantId && k.ownerId === escopo.pessoaId && k.id === p.machineId && k.papel === "computador")) return null;
        const cota = p.cota;
        const fimDaFila = (t: Turno) => ["rotina", "delegacao", "peer"].includes(t.origem) || ["rotina", "colega"].includes(doTenant(b.trabalhos).find((x) => x.id === t.trabalhoId)?.origem ?? "");
        const vivos = doTenant(b.turnos);
        const candidatos = vivos
          .filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (t.acordarEm ?? 0) <= p.agora)
          // ADR-083: a faixa é o trabalho ou, sem ele, a conversa; o trabalho espera o de que depende.
          .filter((t) => {
            // ADR-099 §7 / NOD-253: o portão da cota (seguradoPelaCotaSql).
            if (cota && seguradoPelaCota(t, cota)) return false;
            // ADR-130: a drenagem do motor só pega o que a pessoa espera agora.
            if (p.soDaPessoa === true && !(t.origem === "ligacao" || t.pessoaEsperando || (!t.trabalhoId && !b.bastidores.has(t.id)))) return false;
            // ADR-130: e, sem trabalho, só a MESMA faixa da conversa (a da pessoa ou a dos bastidores) segura.
            if (!t.trabalhoId) return !vivos.some((d) => d.estado === "despachando" && !d.trabalhoId && d.conversaId === t.conversaId && d.origem !== "ligacao" && b.bastidores.has(d.id) === b.bastidores.has(t.id));
            if (vivos.some((d) => d.estado === "despachando" && d.trabalhoId === t.trabalhoId)) return false;
            const dono = doTenant(b.trabalhos).find((x) => x.id === t.trabalhoId);
            const dep = dono?.depoisDeTrabalhoId ? doTenant(b.trabalhos).find((x) => x.id === dono.depoisDeTrabalhoId) : null;
            if (dep && !["terminado", "parado", "falhou"].includes(dep.estado)) return false;
            // ADR-085: a mesma regra do SQL (seguravelPeloMac; o espaço segura também o que passou da espera máxima).
            if (dono && p.espacarFundo === true && seguravelPeloMac({ ...dono, criadoEm: p.agora }, p.agora)) return false;
            // #219: disco crítico — nenhum trabalho novo, nem a volta marcada (que só ele segura, revisão do #224);
            // memória crítica — o segundo plano novo sem prazo.
            if (p.segurarNovo === true && (t.acordarEm || (dono && dono.iniciadoEm === null))) return false;
            return !(dono && p.segurarFundo === true && seguravelPeloMac(p.fundoSemPrazo === true ? { ...dono, criadoEm: p.agora } : dono, p.agora));
          })
          .sort((x, y) => Number(fimDaFila(x)) - Number(fimDaFila(y)) || x.criadoEm - y.criadoEm);
        const t = candidatos[0];
        if (!t) return null;
        t.estado = "despachando";
        t.despachadoEm = p.agora; // NOD-276 (J3)
        t.machineId = p.machineId;
        t.leaseAte = p.agora + LEASE_MS;
        t.sinais = { ...t.sinais, attempted: true };
        return t;
      },
      // NOD-302: a regra de seguradoPelaCotaSql (o fake não aplica a máquina-alvo, como no reivindicar).
      async seguradosPelaCota(p) {
        return doTenant(b.turnos)
          .filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (t.acordarEm ?? 0) <= p.agora && t.origem !== "ligacao")
          .filter((t) => seguradoPelaCota(t, p.cota))
          .sort((x, y) => x.criadoEm - y.criadoEm)
          .slice(0, p.limite ?? 200);
      },
      async pedidosNaFila(p = {}) {
        return doTenant(b.turnos)
          .filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && !t.trabalhoId && (t.origem === "delegacao" || t.origem === "peer") && (!p.agenteId || t.agenteId === p.agenteId))
          .sort((x, y) => x.criadoEm - y.criadoEm)
          .slice(0, p.limite ?? 100);
      },
      async renovarLease(id, machineId, sinais, em, o = {}) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.machineId === machineId);
        if (!t) return { ativo: false, motivo: "lease_vencido" as const };
        // NOD-214: como o repo real — lease vencido só passa na adoção dentro da carência (a sessão do turno não é modelada aqui).
        if (!((t.leaseAte ?? 0) > em || (o.aceitaVencido === true && t.estado === "despachando"))) return { ativo: false, motivo: "lease_vencido" as const };
        t.sinais = {
          attempted: t.sinais.attempted || !!sinais.attempted,
          rejected: t.sinais.rejected || !!sinais.rejected,
          promptSubmitted: t.sinais.promptSubmitted || !!sinais.promptSubmitted,
          producedOutput: t.sinais.producedOutput || !!sinais.producedOutput,
        };
        const ativo = t.estado === "despachando" && t.pararSolicitadoEm === null;
        if (ativo) t.leaseAte = em + LEASE_MS;
        return ativo ? { ativo } : { ativo, motivo: "parado" as const };
      },
      async marcarSinal(id, sinal) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (!t) return false;
        t.sinais = { ...t.sinais, [sinal]: true };
        return true;
      },
      async marcarSemNovidade(id, motivo) {
        const t = doTenant(b.turnos).find((x) => x.id === id);
        if (!t) return false;
        // coalesce: a primeira chamada prevalece, como o UPDATE do repo real.
        t.semNovidadeMotivo = t.semNovidadeMotivo ?? motivo;
        return true;
      },
      async assentar(id, a) {
        const t = doTenant(b.turnos).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "despachando"));
        if (!t) return null;
        if (a.estado === "interrompido" && a.ultimoSinalEm !== undefined && a.ultimoSinalEm !== null && !ULTIMO_SINAL.has(t)) ULTIMO_SINAL.set(t, a.ultimoSinalEm);
        t.estado = a.estado;
        t.motivoInterrupcao = a.estado === "interrompido" ? (a.motivoInterrupcao ?? "sem_progresso") : null;
        t.motivoFalha = a.motivoFalha ?? null;
        t.sinais = {
          attempted: t.sinais.attempted || !!a.sinais?.attempted,
          rejected: t.sinais.rejected || !!a.sinais?.rejected,
          promptSubmitted: t.sinais.promptSubmitted || !!a.sinais?.promptSubmitted,
          producedOutput: t.sinais.producedOutput || !!a.sinais?.producedOutput,
        };
        if (a.custoUsd !== undefined && a.custoUsd !== null) t.custoUsd = a.custoUsd;
        if (a.sessaoCli && a.custoSessaoUsd !== undefined && a.custoSessaoUsd !== null) b.custoSessao.set(id, { sessaoCli: a.sessaoCli, total: a.custoSessaoUsd });
        t.leaseAte = null;
        return t;
      },
      async totalAnteriorDaSessao(sessaoCli, turnoId) {
        const totais = [...b.custoSessao].filter(([id, c]) => id !== turnoId && c.sessaoCli === sessaoCli && doTenant(b.turnos).some((t) => t.id === id)).map(([, c]) => c.total);
        if (totais.length > 0) return Math.max(...totais);
        // NOD-291: a cópia da sessão desconta o total da mãe até o instante em que saiu dela.
        const origem = b.sessaoOrigem.get(turnoId);
        const filho = doTenant(b.turnos).find((t) => t.id === turnoId);
        if (!origem || origem === sessaoCli || !filho) return null;
        const daMae = [...b.custoSessao]
          .filter(([id, c]) => id !== turnoId && c.sessaoCli === origem && doTenant(b.turnos).some((t) => t.id === id && t.criadoEm < filho.criadoEm))
          .map(([, c]) => c.total);
        return daMae.length === 0 ? null : Math.max(...daMae);
      },
      async registrarSessaoOrigem(id, sessaoCli) {
        if (doTenant(b.turnos).some((t) => t.id === id)) b.sessaoOrigem.set(id, sessaoCli);
      },
      async concluirTardia(id, a) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.estado === "interrompido" && ehMotivoDaQueda(x.motivoInterrupcao));
        if (!t) return null;
        const filhas = doTenant(b.turnos).filter((r) => r.retomaTurnoId === id);
        // NOD-309 (PR 3): a retomada da queda ainda na fila, única, é absorvida pelo sucesso tardio.
        if (filhas.length === 1 && filhas[0]!.estado === "pendente" && filhas[0]!.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA)) {
          Object.assign(filhas[0]!, { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: id, leaseAte: null });
        } else if (filhas.length > 0) return null;
        t.estado = "concluido";
        t.motivoInterrupcao = null;
        t.motivoFalha = null;
        t.sinais = {
          attempted: t.sinais.attempted || !!a.sinais?.attempted,
          rejected: t.sinais.rejected || !!a.sinais?.rejected,
          promptSubmitted: t.sinais.promptSubmitted || !!a.sinais?.promptSubmitted,
          producedOutput: t.sinais.producedOutput || !!a.sinais?.producedOutput,
        };
        if (a.custoUsd !== undefined && a.custoUsd !== null) t.custoUsd = a.custoUsd;
        t.leaseAte = null;
        return t;
      },
      async temRetomada(retomaTurnoId) {
        const filhas = doTenant(b.turnos).filter((r) => r.retomaTurnoId === retomaTurnoId);
        return filhas.length > 0 && !(filhas.length === 1 && filhas[0]!.estado === "pendente" && filhas[0]!.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA));
      },
      async interromper(id, motivo, o = {}) {
        const t = doTenant(b.turnos).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "despachando"));
        if (!t) return null;
        // NOD-241: a guarda do varredor, como o UPDATE do repo real (o lease renovado no meio não é interrompido).
        if (o.leaseVencidoEm !== undefined && t.leaseAte !== null && t.leaseAte >= o.leaseVencidoEm) return null;
        t.estado = "interrompido";
        t.motivoInterrupcao = motivo;
        if (o.ultimoSinalEm !== undefined && !ULTIMO_SINAL.has(t)) ULTIMO_SINAL.set(t, o.ultimoSinalEm);
        t.leaseAte = null;
        return t;
      },
      async reclassificarInterrupcao(id, de, para) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.estado === "interrompido" && x.motivoInterrupcao === de);
        if (!t) return null;
        t.motivoInterrupcao = para;
        return t;
      },
      async delegacoesPendentesDoAgente(agenteId, limite = 20) {
        return doTenant(b.turnos).filter((t) => t.agenteId === agenteId && t.origem === "delegacao" && t.estado === "pendente").sort((x, y) => x.criadoEm - y.criadoEm || x.id.localeCompare(y.id)).slice(0, limite);
      },
      async absorverDelegacao(id, porTurnoId) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.origem === "delegacao" && x.estado === "pendente");
        if (!t) return null;
        t.estado = "interrompido";
        t.motivoInterrupcao = "absorvido";
        t.absorvidoPor = porTurnoId;
        t.leaseAte = null;
        return t;
      },
      async absorverPendentes(turno, entrada, ids) {
        if (!turno.mensagemOrigemId || (turno.origem !== "conversa" && turno.origem !== "sala")) return { turno, absorvidos: [] };
        const absorvidos = doTenant(b.turnos)
          .filter((t) => (!ids || ids.includes(t.id)) && t.id !== turno.id && t.conversaId === turno.conversaId && t.agenteId === turno.agenteId && t.estado === "pendente" && (t.origem === "conversa" || t.origem === "sala") && t.mensagemOrigemId && (t.trabalhoId ?? null) === (turno.trabalhoId ?? null))
          .sort((x, y) => x.criadoEm - y.criadoEm);
        for (const t of absorvidos) {
          t.estado = "interrompido";
          t.motivoInterrupcao = "absorvido";
          t.absorvidoPor = turno.id;
          t.leaseAte = null;
        }
        if (absorvidos.length === 0) return { turno, absorvidos };
        const alvo = doTenant(b.turnos).find((t) => t.id === turno.id) ?? turno;
        alvo.entradaTexto = entrada([turno.entradaTexto, ...absorvidos.map((a) => a.entradaTexto)]);
        alvo.entradaAnexos = [...new Set([...turno.entradaAnexos, ...absorvidos.flatMap((a) => a.entradaAnexos)])];
        // NOD-312 (revisão 9): como o SQL — o motivo da repetição absorvida vai para quem absorve.
        const motivo = absorvidos.find((a) => a.motivoRecomeco)?.motivoRecomeco;
        if (!alvo.motivoRecomeco && motivo) alvo.motivoRecomeco = motivo;
        return { turno: alvo, absorvidos };
      },
      async absorverNaSessao(turno, ids) {
        // NOD-286: como o SQL — fora de trabalho, e só até a primeira fala pendente com anexo do mesmo escopo.
        const escopoDaFala = doTenant(b.turnos).filter((t) => t.id !== turno.id && t.ownerId === escopo.pessoaId && t.conversaId === turno.conversaId && t.agenteId === turno.agenteId && t.estado === "pendente" && t.origem === "conversa" && t.mensagemOrigemId && !t.trabalhoId);
        const absorvidos = ateOPrimeiroAnexo(escopoDaFala).filter((t) => !ids || ids.includes(t.id));
        for (const t of absorvidos) {
          t.estado = "interrompido";
          t.motivoInterrupcao = "absorvido";
          t.absorvidoPor = turno.id;
          t.leaseAte = null;
        }
        return absorvidos;
      },
      async absorverDoTrabalho(turno, ids) {
        if (!turno.trabalhoId || (ids && ids.length === 0)) return [];
        const daFaixa = doTenant(b.turnos).filter((t) => t.id !== turno.id && t.ownerId === escopo.pessoaId && t.trabalhoId === turno.trabalhoId && t.estado === "pendente" && t.mensagemOrigemId);
        const absorvidos = ateOPrimeiroAnexo(daFaixa).filter((t) => !ids || ids.includes(t.id));
        for (const t of absorvidos) {
          t.estado = "interrompido";
          t.motivoInterrupcao = "absorvido";
          t.absorvidoPor = turno.id;
          t.leaseAte = null;
        }
        return absorvidos;
      },
      // ADR-090: o fake não guarda nem aplica a máquina do turno (o reivindicar dele ignora onde o bot trabalha); a regra é
      // coberta só por tests/integration/maquina-do-bot.test.ts, contra o Postgres.
      async rodarDestaVez(conversaId, maquinaId) {
        const ts = doTenant(b.turnos).filter((t) => t.conversaId === conversaId && t.ownerId === escopo.pessoaId && t.estado === "pendente" && !t.trabalhoId);
        for (const t of ts) { b.maquinaDestaVez.set(t.id, maquinaId); t.maquinaDestaVez = maquinaId; }
        return ts.length;
      },
      async rodarDestaVezDoTrabalho(trabalhoId, maquinaId) {
        const ts = doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId && t.ownerId === escopo.pessoaId && t.estado === "pendente");
        const jaNela = ts.filter((t) => b.maquinaDestaVez.get(t.id) === maquinaId).length;
        for (const t of ts) { b.maquinaDestaVez.set(t.id, maquinaId); t.maquinaDestaVez = maquinaId; }
        return { movidos: ts.length - jaNela, jaNela };
      },
      async anteciparEsperasDoLimite(p) {
        let n = 0;
        const ts = doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId);
        for (const t of ts) {
          if (t.estado !== "pendente" || (t.acordarEm ?? null) === null || t.acordarEm! <= p.agora || !(t.harness === p.ia || (t.harness ?? "auto") === "auto")) continue;
          const de = ts.some((x) => x.conversaId === t.conversaId && x.agenteId === t.agenteId && x.estado === "interrompido" && (x.motivoFalha === "limite_do_plano" || x.motivoFalha === "sem_conta")
            && (x.id === t.retomaTurnoId || (t.retomaTurnoId !== null && x.retomaTurnoId === t.retomaTurnoId) || (!!t.mensagemOrigemId && x.mensagemOrigemId === t.mensagemOrigemId)));
          if (!de) continue;
          t.acordarEm = p.agora;
          n += 1;
        }
        return n;
      },
      async cancelarPendente(id, motivo = "parado_pela_pessoa", _o = {}) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.estado === "pendente");
        if (!t) return null;
        t.estado = "interrompido";
        t.motivoInterrupcao = motivo;
        t.leaseAte = null;
        return t;
      },
      async pedirInterrupcao(ids, em) {
        let n = 0;
        for (const t of doTenant(b.turnos)) {
          if (ids.includes(t.id) && t.estado === "despachando") {
            t.pararSolicitadoEm ??= em;
            n += 1;
          }
        }
        return n;
      },
      async vencidos(em) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "despachando" && t.leaseAte !== null && t.leaseAte < em);
      },
      async despachandoDaPessoa() {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "despachando");
      },
      async pendentesDaPessoa(conversaId) {
        return doTenant(b.turnos).filter((t) => t.ownerId === escopo.pessoaId && t.estado === "pendente" && (!conversaId || t.conversaId === conversaId)).sort(porChegada);
      },
      async bastidoresVivos(conversaId) {
        return doTenant(b.turnos).filter((t) => t.conversaId === conversaId && t.estado === "despachando" && !t.trabalhoId && b.bastidores.has(t.id) && t.origem !== "ligacao");
      },
      async vivosDaConversa(conversaId) {
        return doTenant(b.turnos).filter((t) => t.conversaId === conversaId && (t.estado === "pendente" || t.estado === "despachando") && (t.acordarEm ?? 0) <= agora());
      },
      async pendentesRenderizaveis(conversaId) {
        const todos = doTenant(b.turnos);
        const saida: { id: string; motivo: "agente_ocupado_em"; conversaId: string }[] = [];
        for (const p of todos.filter((t) => t.conversaId === conversaId && t.estado === "pendente" && !t.trabalhoId && (t.acordarEm ?? 0) <= agora())) {
          // ADR-130: só a mesma faixa (a da pessoa ou a dos bastidores) segura.
          const daConversa = todos.filter((d) => d.estado === "despachando" && !d.trabalhoId && d.conversaId === conversaId && b.bastidores.has(d.id) === b.bastidores.has(p.id));
          const ocupado = daConversa.find((d) => d.agenteId === p.agenteId) ?? daConversa[0];
          if (ocupado) saida.push({ id: p.id, motivo: "agente_ocupado_em", conversaId: ocupado.conversaId });
        }
        return saida;
      },
      async registrarEntrega(turnoId, seqLocal) {
        const chave = `${escopo.tenantId}:${turnoId}:${seqLocal}`;
        if (b.entregas.has(chave)) return false;
        b.entregas.add(chave);
        return true;
      },
      async concluidosPorConversa(conversaIds) {
        const saida = new Map<string, number>();
        for (const id of conversaIds) {
          const n = doTenant(b.turnos).filter((t) => t.conversaId === id && t.estado === "concluido").length;
          if (n > 0) saida.set(id, n);
        }
        return saida;
      },
      async custoPorAgente(janelas) {
        // NOD-273: espelha o SQL — soma `gastos` pelo instante do gasto (`em`), com tokens e a marca de sem custo.
        const somas = new Map<string, { agenteId: string; janela: number; usd: number; tokens: number; semCusto: boolean }>();
        for (const g of doTenant(b.gastos)) {
          if (g.ownerId !== escopo.pessoaId) continue;
          const t = doTenant(b.turnos).find((x) => x.id === g.turnoId);
          if (!t) continue;
          janelas.forEach((j, janela) => {
            if (g.em < j.inicio || g.em >= j.fim) return;
            const chave = `${t.agenteId}:${janela}`;
            const atual = somas.get(chave) ?? { agenteId: t.agenteId, janela, usd: 0, tokens: 0, semCusto: false };
            const tokens = g.tokensEntrada + g.tokensSaida;
            atual.usd += g.custoUsd ?? 0;
            atual.tokens += tokens;
            atual.semCusto ||= g.custoUsd === null && tokens > 0;
            somas.set(chave, atual);
          });
        }
        return [...somas.values()];
      },
      async barradosPorFaltaDeIa(desde) {
        const meus = doTenant(b.turnos);
        return meus
          .filter((t) => t.ownerId === escopo.pessoaId && t.origem === "conversa" && !t.trabalhoId && t.estado === "interrompido" && t.motivoInterrupcao === "executor_indisponivel" && t.motivoFalha !== "sem_conta" && t.motivoFalha !== "limite_do_plano" && t.criadoEm >= desde)
          .filter((t) => !meus.some((n) => n.conversaId === t.conversaId && n.criadoEm > t.criadoEm))
          .filter((t) => !doTenant(b.paradas).some((p) => p.conversaId === t.conversaId && p.ativaDesde > t.criadoEm))
          .sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async travarAbertosDoTrabalho(trabalhoId: string) {
        return doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId && (t.estado === "pendente" || t.estado === "despachando")).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async doTrabalho(trabalhoId) {
        return doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId).sort((x, y) => x.criadoEm - y.criadoEm);
      },
      async vincularTrabalho(id, trabalhoId) {
        const t = doTenant(b.turnos).find((x) => x.id === id && x.ownerId === escopo.pessoaId && !x.trabalhoId && x.estado === "despachando");
        if (!t) return null;
        t.trabalhoId = trabalhoId;
        return t;
      },
      async listarDaConversa(conversaId, limite = 50) {
        const todos = doTenant(b.turnos).filter((t) => t.conversaId === conversaId).sort((x, y) => x.criadoEm - y.criadoEm);
        return todos.slice(Math.max(0, todos.length - limite));
      },
    },

    decisoes: {
      async criar(d) {
        const em = agora();
        const decisao = {
          tenantId: escopo.tenantId,
          id: d.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          decisorId: d.decisorId ?? escopo.pessoaId,
          agenteId: d.agenteId,
          conversaId: d.conversaId,
          turnoId: d.turnoId ?? null,
          tipo: d.tipo,
          estado: d.estado ?? ("pendente" as const),
          prazoDecisaoEm: iso(d.prazoDecisaoEm),
          prazoExecucaoEm: d.prazoExecucaoEm === null || d.prazoExecucaoEm === undefined ? null : iso(d.prazoExecucaoEm),
          frase: d.frase,
          desfecho: null,
          vistaEm: null,
          criadoEm: iso(em + b.decisoes.length),
          decididaEm: null,
          fioId: d.fioId ?? null,
          ...(d.tarefaId ? { tarefaId: d.tarefaId } : {}),
          ...(d.tarefaPedeDone ? { tarefaPedeDone: true as const } : {}),
        };
        b.decisoes.push(decisao);
        return decisao;
      },
      async ligarATarefa(id, tarefaId) {
        const i = b.decisoes.findIndex((d) => d.tenantId === escopo.tenantId && d.ownerId === escopo.pessoaId && d.id === id && (d.estado === "pendente" || d.estado === "reaberta"));
        if (i < 0) return null;
        b.decisoes[i] = { ...b.decisoes[i]!, tarefaId };
        return b.decisoes[i]!;
      },
      async abertasDasTarefas(tarefaIds) {
        return doTenant(b.decisoes).filter((d) => d.tarefaId !== undefined && tarefaIds.includes(d.tarefaId) && (d.estado === "pendente" || d.estado === "reaberta"));
      },
      async buscar(id) {
        return doTenant(b.decisoes).find((d) => d.id === id) ?? null;
      },
      async doTurno(turnoId) {
        return doTenant(b.decisoes).filter((d) => d.turnoId === turnoId).sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm));
      },
      async dosFios(ids) {
        const alvo = new Set(ids);
        return doTenant(b.decisoes).filter((d) => alvo.has(d.id) || (d.fioId !== null && alvo.has(d.fioId))).sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm));
      },
      async listarSuaVez(em) {
        return doTenant(b.decisoes)
          .filter((d) => d.decisorId === escopo.pessoaId)
          .filter((d) => d.estado === "pendente" || d.estado === "reaberta" || (d.estado === "vencida" && Date.parse(d.prazoDecisaoEm) >= em - 7 * 24 * 60 * 60 * 1000))
          .sort((x, y) => Date.parse(x.criadoEm) - Date.parse(y.criadoEm))
          .map((d) => ({ ...d, agenteNome: b.agentes.find((a) => a.id === d.agenteId)?.nome ?? "agente", trabalhoId: b.turnos.find((t) => t.id === d.turnoId)?.trabalhoId ?? null }));
      },
      async abertasDoTrabalho(trabalhoId) {
        const turnos = new Set(doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId).map((t) => t.id));
        return doTenant(b.decisoes).filter((d) => d.turnoId !== null && turnos.has(d.turnoId) && (d.estado === "pendente" || d.estado === "reaberta"));
      },
      async pendentesDaConversa(conversaId) {
        return doTenant(b.decisoes).filter((d) => d.conversaId === conversaId && (d.estado === "pendente" || d.estado === "reaberta"));
      },
      async marcarVista(id, em) {
        const d = doTenant(b.decisoes).find((x) => x.id === id);
        if (!d) return false;
        d.vistaEm ??= iso(em);
        return true;
      },
      async reivindicarContinuacao(id, por) {
        if (!doTenant(b.decisoes).some((x) => x.id === id)) return null;
        if (!b.continuacoes.has(id)) {
          b.continuacoes.set(id, por);
          return "minha";
        }
        return b.continuacoes.get(id) ?? null;
      },
      async aContinuarDoTurno(turnoId) {
        return doTenant(b.decisoes).filter((d) => d.turnoId === turnoId && d.tipo === "aprovacao" && d.estado === "decidida" && !b.continuacoes.has(d.id)).sort((x, y) => (x.decididaEm ?? 0) - (y.decididaEm ?? 0));
      },
      async decidir(id, p) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "reaberta"));
        if (!d) return null;
        d.estado = "decidida";
        d.desfecho = { tipo: "decidida", por: p.por, em: iso(p.agora) };
        d.decididaEm = p.agora;
        return d;
      },
      async dispensar(id, p) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && x.estado === p.antes && (x.estado === "vencida" || (TIPOS_DISPENSAVEIS_ABERTOS as readonly string[]).includes(x.tipo)));
        if (!d) return null;
        d.estado = "decidida";
        d.desfecho = { tipo: "dispensada", por: p.por, em: iso(p.agora), antes: p.antes };
        d.decididaEm = p.agora;
        return d;
      },
      async reabrir(id, prazoDecisaoEm) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && x.estado === "vencida");
        if (!d) return null;
        d.estado = "reaberta";
        d.prazoDecisaoEm = iso(prazoDecisaoEm);
        d.desfecho = null;
        return d;
      },
      async vencerPendentes(em) {
        const vencidas: Decisao[] = [];
        for (const d of doTenant(b.decisoes)) {
          if ((d.estado === "pendente" || d.estado === "reaberta") && Date.parse(d.prazoDecisaoEm) <= em) {
            d.estado = "vencida";
            d.desfecho = { tipo: d.vistaEm === null ? "expirou_sem_ninguem_ver" : "expirou_com_alguem_ciente", em: iso(em) };
            vencidas.push(d);
          }
        }
        return vencidas;
      },
      async marcarVarrida(id, tipoDeEvento) {
        const chave = `${escopo.tenantId}:${id}:${tipoDeEvento}`;
        if (b.varridos.has(chave)) return false;
        b.varridos.add(chave);
        return true;
      },
      async concluirRevisao(id, p) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.estado === "em_revisao");
        if (!d) return null;
        if ("liberar" in p) {
          d.estado = "decidida";
          d.desfecho = { tipo: "decidida_por_regra", regra: p.liberar.regra, regraVersao: p.liberar.regraVersao, em: new Date(p.agora).toISOString() };
          d.decididaEm = p.agora;
        } else {
          d.estado = "pendente";
          d.prazoDecisaoEm = new Date(p.pendente.prazoDecisaoEm).toISOString();
        }
        return d;
      },
      async emRevisaoAntesDe(antesDe) {
        return doTenant(b.decisoes).filter((d) => d.ownerId === escopo.pessoaId && d.estado === "em_revisao" && Date.parse(d.criadoEm) < antesDe);
      },
      async fecharPorRegra(id, p) {
        const d = doTenant(b.decisoes).find((x) => x.id === id && (x.estado === "pendente" || x.estado === "reaberta" || (p.tambemVencida === true && x.estado === "vencida")));
        if (!d) return null;
        d.estado = "decidida";
        d.desfecho = { tipo: "decidida_por_regra", regra: p.regra, regraVersao: p.regraVersao, em: new Date(p.agora).toISOString() };
        d.decididaEm = p.agora;
        return d;
      },
      async fecharRetomarAnteriores(trabalhoId, turnoIdAtual, p) {
        const atual = doTenant(b.turnos).find((t) => t.id === turnoIdAtual);
        if (!atual) return [];
        const anteriores = new Set(doTenant(b.turnos).filter((t) => t.trabalhoId === trabalhoId && t.id !== atual.id && (t.criadoEm < atual.criadoEm || (t.criadoEm === atual.criadoEm && t.id < atual.id))).map((t) => t.id));
        const fechadas: Decisao[] = [];
        for (const d of doTenant(b.decisoes)) {
          if (d.tipo !== "retomar_turno" || (d.estado !== "pendente" && d.estado !== "reaberta") || d.turnoId === null || !anteriores.has(d.turnoId)) continue;
          d.estado = "decidida";
          d.desfecho = { tipo: "decidida_por_regra", regra: p.regra, regraVersao: p.regraVersao, em: new Date(p.agora).toISOString() };
          d.decididaEm = p.agora;
          fechadas.push(d);
        }
        return fechadas;
      },

      async ultimaDecisaoEm() {
        const ems = doTenant(b.decisoes).filter((d) => d.decisorId === escopo.pessoaId && d.decididaEm !== null).map((d) => d.decididaEm as number);
        return ems.length === 0 ? null : iso(Math.max(...ems));
      },
    },

    itensAprovacao: {
      async criarLote(decisaoId, itens) {
        const criados: ItemAprovacao[] = [];
        for (const i of itens) {
          const item: ItemAprovacao = {
            tenantId: escopo.tenantId,
            id: i.id ?? randomUUID(),
            decisaoId,
            idx: i.idx,
            textoOriginal: i.texto,
            textoFinal: i.texto,
            destino: i.destino,
            selecionado: !i.origemSensivel,
            origemSensivel: i.origemSensivel,
            justificativa: i.justificativa ?? null,
            marcadoPor: null,
            marcadoEm: null,
            editadoPor: null,
            desfecho: i.desfecho ?? null,
            motivoManual: i.motivoManual ?? null,
            ...(i.sempreServe !== undefined && i.sempreServe !== null ? { sempreServe: i.sempreServe } : {}),
          };
          b.itens.push(item);
          criados.push(item);
        }
        return criados;
      },
      async listar(decisaoId) {
        return doTenant(b.itens).filter((i) => i.decisaoId === decisaoId).sort((x, y) => x.idx - y.idx);
      },
      async executadosDepois(decisaoId) {
        const base = doTenant(b.decisoes).find((d) => d.id === decisaoId);
        if (!base) return [];
        const faixa = (turnoId: string | null) => (turnoId ? (doTenant(b.turnos).find((t) => t.id === turnoId)?.trabalhoId ?? null) : null);
        const depois = new Set(doTenant(b.decisoes).filter((d) => d.id !== base.id && d.conversaId === base.conversaId && d.criadoEm > base.criadoEm && faixa(d.turnoId) === faixa(base.turnoId)).map((d) => d.id));
        return doTenant(b.itens).filter((i) => depois.has(i.decisaoId) && i.desfecho === "executado");
      },
      async aprovadoNaCadeia(turnoId, texto, arquivo) {
        const cadeia = new Set<string>();
        let atual = doTenant(b.turnos).find((t) => t.id === turnoId) ?? null;
        for (let saltos = 0; atual && saltos < 50; saltos++) {
          cadeia.add(atual.id);
          atual = atual.retomaTurnoId ? doTenant(b.turnos).find((t) => t.id === atual?.retomaTurnoId) ?? null : null;
        }
        const porRevisor = (d: Decisao) => d.desfecho?.tipo === "decidida_por_regra" && d.desfecho.regra === "regra:revisor";
        const decisoes = new Map(doTenant(b.decisoes).filter((d) => d.turnoId !== null && cadeia.has(d.turnoId)).map((d) => [d.id, d]));
        const achados = doTenant(b.itens).filter((i) => decisoes.has(i.decisaoId) && i.destino.conector === "terminal" && i.textoOriginal === texto && ("arquivo" in (i.destino.argumentos ?? {})) === arquivo && i.selecionado && i.desfecho === "executado").map((i) => decisoes.get(i.decisaoId)!);
        if (achados.some((d) => !porRevisor(d))) return "pessoa";
        return achados.some((d) => d.turnoId === turnoId) ? "revisor" : null;
      },
      async recusadoNaCadeia(turnoId, acao) {
        const cadeia = new Set<string>();
        let atual = doTenant(b.turnos).find((t) => t.id === turnoId) ?? null;
        for (let saltos = 0; atual && saltos < 50; saltos++) {
          cadeia.add(atual.id);
          atual = atual.retomaTurnoId ? doTenant(b.turnos).find((t) => t.id === atual?.retomaTurnoId) ?? null : null;
        }
        const decisoes = new Map(doTenant(b.decisoes).filter((d) => d.turnoId !== null && cadeia.has(d.turnoId)).map((d) => [d.id, d]));
        return doTenant(b.itens).some((i) => {
          const d = decisoes.get(i.decisaoId);
          const mesma = typeof acao === "string"
            ? i.destino.conector === "terminal" && i.textoOriginal === acao
            : i.destino.conector === acao.conector && i.destino.ferramenta === acao.ferramenta && JSON.stringify(i.destino.argumentos) === JSON.stringify(acao.argumentos);
          return d && mesma && (i.motivoManual === "revisor_pediu" || d.estado === "vencida" || (d.estado === "decidida" && (!i.selecionado || i.desfecho === "retirado_pela_pessoa" || i.desfecho === "sensivel_nao_aprovado")));
        });
      },
      async marcarRevisao(id, p) {
        const item = doTenant(b.itens).find((i) => i.id === id);
        if (!item) return null;
        if ("liberado" in p) {
          if (item.desfecho !== null) return null;
          item.motivoManual = null;
          item.justificativa = null;
          item.desfecho = p.executar ? null : "executado";
        } else {
          item.motivoManual = p.motivoManual;
          item.justificativa = p.justificativa;
          if (p.motivoManual === "revisor_falhou" && item.sempreServe !== undefined) item.sempreServe = false;
        }
        return item;
      },
      async pendentesNaMaquina() {
        return doTenant(b.itens).flatMap((item) => {
          const d = doTenant(b.decisoes).find((x) => x.id === item.decisaoId);
          if (!d || d.estado !== "decidida" || !item.selecionado || item.desfecho !== null || item.destino.execucao !== "maquina") return [];
          return [{ item, decididaEm: d.desfecho ? Date.parse(d.desfecho.em) : 0, porRegra: d.desfecho?.tipo === "decidida_por_regra" }];
        });
      },
      async registrarDesfechoSeAberto(id, desfecho) {
        const i = doTenant(b.itens).find((x) => x.id === id && x.desfecho === null);
        if (!i) return null;
        i.desfecho = desfecho;
        return i;
      },
      async buscar(id) {
        return doTenant(b.itens).find((i) => i.id === id) ?? null;
      },
      async marcar(id, p) {
        const i = doTenant(b.itens).find((x) => x.id === id);
        if (!i) return null;
        i.selecionado = p.selecionado;
        i.marcadoPor = escopo.pessoaId;
        i.marcadoEm = iso(p.agora);
        if (p.textoFinal !== undefined) {
          i.textoFinal = p.textoFinal;
          i.editadoPor = escopo.pessoaId;
        }
        return i;
      },
      async registrarDesfecho(id, desfecho) {
        const i = doTenant(b.itens).find((x) => x.id === id);
        if (!i) return null;
        i.desfecho = desfecho;
        return i;
      },
    },

    rotinas: {
      async criar(r) {
        const rotina: Rotina = {
          tenantId: escopo.tenantId,
          id: r.id ?? randomUUID(),
          agenteId: r.agenteId,
          conversaId: r.conversaId,
          ownerId: escopo.pessoaId,
          cron: r.cron,
          fusoIana: r.fusoIana,
          instrucao: r.instrucao,
          fonte: r.fonte,
          entregavel: r.entregavel,
          limitesAprovacao: r.limitesAprovacao,
          politicaSemDado: r.politicaSemDado,
          exigeAprovacao: r.exigeAprovacao ?? true,
          estado: r.estado ?? "ativa",
          proximaExecucao: r.proximaExecucao,
          criadoEm: agora(),
          excluidoEm: null,
          acessos: r.acessos ?? null,
          gatilho: r.gatilho ?? "horario",
          provedor: r.provedor ?? null,
          eventos: r.eventos ?? null,
        };
        b.rotinas.push(rotina);
        return rotina;
      },
      async buscar(id) {
        return doTenant(b.rotinas).find((r) => r.id === id) ?? null;
      },
      async buscarParaAtualizar(id) {
        // Espelha o SQL: só a dona (o FOR UPDATE passa pela policy de UPDATE). Sem concorrência na memória, sem lock.
        return doTenant(b.rotinas).find((r) => r.id === id && r.ownerId === escopo.pessoaId) ?? null;
      },
      async listar() {
        return doTenant(b.rotinas).filter((r) => r.excluidoEm === null);
      },
      async listarDoAgente(agenteId) {
        return doTenant(b.rotinas).filter((r) => r.agenteId === agenteId && r.excluidoEm === null);
      },
      async contarDoAgente(agenteId) {
        return doTenant(b.rotinas).filter((r) => r.agenteId === agenteId && r.excluidoEm === null).length;
      },
      async ativasVencidas(em) {
        return doTenant(b.rotinas).filter((r) => r.ownerId === escopo.pessoaId && r.estado === "ativa" && r.excluidoEm === null && r.proximaExecucao <= em);
      },
      async atualizarEstado(id, estado) {
        const r = doTenant(b.rotinas).find((x) => x.id === id);
        if (!r) return null;
        r.estado = estado;
        return r;
      },
      async atualizar(id, campos) {
        // Espelha o SQL: só a dona, nunca excluída, e campo ausente fica como está.
        const r = doTenant(b.rotinas).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.excluidoEm === null);
        if (!r) return null;
        for (const [k, v] of Object.entries(campos)) if (v !== undefined) Object.assign(r, { [k]: v });
        return r;
      },
      async excluir(id, em) {
        const r = doTenant(b.rotinas).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.excluidoEm === null);
        if (!r) return null;
        r.excluidoEm = em;
        return r;
      },
      async reagendar(id, proximaExecucao) {
        const r = doTenant(b.rotinas).find((x) => x.id === id);
        if (!r) return null;
        r.proximaExecucao = proximaExecucao;
        return r;
      },
    },

    rotinaJanelas: {
      async reivindicar(p) {
        if (doTenant(b.janelas).some((j) => j.rotinaId === p.rotinaId && j.instanteAgendado === p.instanteAgendado)) return false;
        b.janelas.push({ tenantId: escopo.tenantId, rotinaId: p.rotinaId, instanteAgendado: p.instanteAgendado, executor: p.executor, machineId: p.machineId, turnoId: null });
        return true;
      },
      async vincularTurno(p) {
        const j = doTenant(b.janelas).find((x) => x.rotinaId === p.rotinaId && x.instanteAgendado === p.instanteAgendado);
        if (!j) return false;
        j.turnoId = p.turnoId;
        return true;
      },
      async listar(rotinaId) {
        return doTenant(b.janelas).filter((j) => j.rotinaId === rotinaId).sort((x, y) => x.instanteAgendado - y.instanteAgendado);
      },
      async buscarPorTurno(turnoId) {
        return doTenant(b.janelas).find((j) => j.turnoId === turnoId) ?? null;
      },
      // Sem concorrência em memória: travar só confirma que a janela existe.
      async travar(rotinaId, instanteAgendado) {
        return doTenant(b.janelas).some((j) => j.rotinaId === rotinaId && j.instanteAgendado === instanteAgendado);
      },
      async esperaDaCotaDe(raizId, prefixo, agora) {
        const cadeia = new Set([raizId]);
        for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
        const v = doTenant(b.turnos).filter((x) => x.id !== raizId && cadeia.has(x.id) && x.estado === "pendente" && x.acordarEm !== null && x.acordarEm !== undefined && x.acordarEm > agora && x.entradaTexto.startsWith(prefixo))
          .sort((x, y) => (x.acordarEm ?? 0) - (y.acordarEm ?? 0))[0];
        return v ? { voltaEm: v.acordarEm as number, entrada: v.entradaTexto, harness: v.harness ?? null } : null;
      },
      async retomadaPendenteDe(raizId, exceto) {
        const cadeia = new Set([raizId]);
        for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
        return doTenant(b.turnos).find((v) => v.id !== raizId && v.id !== exceto && cadeia.has(v.id) && (v.estado === "pendente" || v.estado === "despachando"))?.id ?? null;
      },
      async contarAbertas(rotinaId, ref) {
        return (await abertasDaRotina(rotinaId, ref)).length;
      },
      async turnoAberto(rotinaId, ref) {
        const abertas = await abertasDaRotina(rotinaId, ref);
        const j = abertas[0];
        const t = j ? doTenant(b.turnos).find((x) => x.id === j.turnoId) : undefined;
        return j && t
          ? { turnoId: t.id, instanteAgendado: j.instanteAgendado, estado: t.estado, attempted: t.sinais.attempted, acordarEm: t.acordarEm ?? null, criadoEm: t.criadoEm, trabalhoId: t.trabalhoId ?? null }
          : null;
      },
      // definido em 2026-10-15 (pacote A3): a execução aberta com o instante da janela (a lista conta os horários pulados).
      async execucaoAberta(rotinaId, ref) {
        const a = await this.turnoAberto(rotinaId, ref);
        return a ? { turnoId: a.turnoId, instanteAgendado: a.instanteAgendado } : null;
      },
      async turnosPendentesDaRotina(rotinaId, ref) {
        const saida: { turnoId: string; conversaId: string; janelaTurnoId: string }[] = [];
        const vistos = new Set<string>();
        for (const j of doTenant(b.janelas).filter((x) => x.rotinaId === rotinaId && x.turnoId !== null && x.instanteAgendado > ref - 7 * 86_400_000)) {
          const t = doTenant(b.turnos).find((x) => x.id === j.turnoId);
          if (!t) continue;
          const cadeia = new Set<string>([t.id]);
          if (t.trabalhoId) for (const v of doTenant(b.turnos)) if (v.trabalhoId === t.trabalhoId) cadeia.add(v.id);
          for (let n = 0; n < 10; n++) for (const v of doTenant(b.turnos)) if (v.origem === "retomada" && v.retomaTurnoId && cadeia.has(v.retomaTurnoId)) cadeia.add(v.id);
          for (const v of doTenant(b.turnos)) {
            if (!cadeia.has(v.id) || v.estado !== "pendente" || vistos.has(v.id)) continue;
            vistos.add(v.id);
            saida.push({ turnoId: v.id, conversaId: v.conversaId, janelaTurnoId: t.id });
          }
        }
        return saida;
      },
      async podar(rotinaId, ref) {
        const minhas = doTenant(b.janelas).filter((j) => j.rotinaId === rotinaId);
        const sai = new Set(minhas.filter((j) => {
          if (j.instanteAgendado >= ref - 30 * 86_400_000) return false;
          const t = j.turnoId ? doTenant(b.turnos).find((x) => x.id === j.turnoId) : undefined;
          return !t || (t.estado !== "pendente" && t.estado !== "despachando");
        }));
        b.janelas = b.janelas.filter((j) => !sai.has(j));
        return sai.size;
      },
    },

    rotinaExecucoes: {
      async registrar(e) {
        const exec: ExecucaoRotina = { tenantId: escopo.tenantId, id: e.id ?? randomUUID(), rotinaId: e.rotinaId, instanteAgendado: e.instanteAgendado, turnoId: e.turnoId ?? null, desfecho: e.desfecho, motivo: e.motivo ?? null, em: e.em, voltaEm: e.voltaEm ?? null };
        b.execucoes.push(exec);
        return exec;
      },
      async atualizarDesfecho(id, desfecho, motivo = null, em, voltaEm = null) {
        const e = doTenant(b.execucoes).find((x) => x.id === id);
        if (!e) return null;
        e.desfecho = desfecho;
        e.motivo = motivo;
        e.voltaEm = voltaEm;
        if (em !== undefined) e.em = em;
        return e;
      },
      async daJanela(rotinaId, instanteAgendado) {
        return doTenant(b.execucoes).filter((e) => e.rotinaId === rotinaId && e.instanteAgendado === instanteAgendado).sort((x, y) => y.em - x.em || y.id.localeCompare(x.id))[0] ?? null;
      },
      async listar(rotinaId, limite = EXECUCOES_GUARDADAS) {
        return doTenant(b.execucoes).filter((e) => e.rotinaId === rotinaId).sort((x, y) => y.em - x.em || y.id.localeCompare(x.id)).slice(0, limite);
      },
      async dasRotinas(rotinaIds) {
        const ids = new Set(rotinaIds);
        return doTenant(b.execucoes).filter((e) => ids.has(e.rotinaId)).sort((x, y) => x.instanteAgendado - y.instanteAgendado || x.id.localeCompare(y.id));
      },
      async podar(rotinaId, guardar = EXECUCOES_GUARDADAS) {
        const minhas = doTenant(b.execucoes).filter((e) => e.rotinaId === rotinaId).sort((x, y) => y.em - x.em || y.id.localeCompare(x.id));
        const sobra = new Set(minhas.slice(guardar).map((e) => e.id));
        b.execucoes = b.execucoes.filter((e) => !sobra.has(e.id));
        return sobra.size;
      },
    },

    salas: {
      async criarComMembros(s, membros) {
        const sala: Sala = {
          tenantId: escopo.tenantId,
          id: s.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: "privado",
          nome: s.nome,
          conversaId: s.conversaId,
          politica: s.politica ?? "lead",
          leadAgenteId: s.leadAgenteId ?? null,
          orcamento: s.orcamento ?? { ...ORCAMENTO_INICIAL },
          criadoEm: agora(),
        };
        b.salas.push(sala);
        const criados: MembroSala[] = [];
        for (const m of membros) {
          const membro = await repos.salas.adicionarMembro(sala.id, m);
          if (membro) criados.push(membro);
        }
        return { sala, membros: criados };
      },
      async buscar(id) {
        return doTenant(b.salas).find((s) => s.id === id) ?? null;
      },
      async buscarPorConversa(conversaId) {
        return doTenant(b.salas).find((s) => s.conversaId === conversaId) ?? null;
      },
      async listar() {
        return doTenant(b.salas);
      },
      async membros(salaId) {
        return doTenant(b.membros)
          .filter((m) => m.salaId === salaId && m.removidoEm === null)
          .sort((x, y) => x.criadoEm - y.criadoEm)
          .map(({ criadoEm: _c, ...m }) => m);
      },
      async adicionarMembro(salaId, m) {
        const existente = doTenant(b.membros).find((x) => x.salaId === salaId && x.agenteId === m.agenteId);
        if (existente) {
          existente.removidoEm = null;
          existente.pessoaLeitoraId = m.pessoaLeitoraId;
          const { criadoEm: _c, ...semCriado } = existente;
          return semCriado;
        }
        const membro = { tenantId: escopo.tenantId, salaId, agenteId: m.agenteId, pessoaLeitoraId: m.pessoaLeitoraId, logInteiro: true as const, removidoEm: null, criadoEm: agora() + b.membros.length / 1000 };
        b.membros.push(membro);
        const { criadoEm: _c, ...semCriado } = membro;
        return semCriado;
      },
      async removerMembro(salaId, agenteId, em) {
        const m = doTenant(b.membros).find((x) => x.salaId === salaId && x.agenteId === agenteId && x.removidoEm === null);
        if (!m) return false;
        m.removidoEm = em;
        return true;
      },
      async atualizarOrcamento(id, orcamento) {
        const s = doTenant(b.salas).find((x) => x.id === id);
        if (!s) return false;
        s.orcamento = orcamento;
        return true;
      },
      async atualizarPolitica(id, p) {
        const s = doTenant(b.salas).find((x) => x.id === id);
        if (!s) return null;
        if (p.politica !== undefined) s.politica = p.politica;
        if (p.leadAgenteId !== undefined) s.leadAgenteId = p.leadAgenteId;
        return s;
      },
    },

    githubApp: {
      async config() { return b.githubApp.get(escopo.tenantId) ?? null; },
      async salvar(c) { b.githubApp.set(escopo.tenantId, { ...c, ownerId: b.githubApp.get(escopo.tenantId)?.ownerId ?? escopo.pessoaId }); },
    },
    composio: {
      async chave() { return b.composioChaves.get(escopo.tenantId + escopo.pessoaId) ?? null; },
      async salvarChave(c) { b.composioChaves.set(escopo.tenantId + escopo.pessoaId, c); },
      async salvarChaveSeAusente(c) { if (b.composioChaves.has(escopo.tenantId + escopo.pessoaId)) return false; b.composioChaves.set(escopo.tenantId + escopo.pessoaId, c); return true; },
      async sessao(t) { return b.composioSessoes.get(escopo.tenantId + escopo.pessoaId + t) ?? null; },
      async salvarSessao(s) { b.composioSessoes.set(escopo.tenantId + escopo.pessoaId + s.toolkit, s); },
    },
    conectores: {
      async atualizarEndpoint(id, url, envCifrado, envChaves) {
        const c = b.conectores.find((c) => c.id === id && c.ownerId === escopo.pessoaId);
        if (!c) return null;
        Object.assign(c, { url, envCifrado, env: Object.fromEntries(envChaves.map((k) => [k, true])), habilitado: false, catalogo: [], sondadoEm: null, ultimaFalha: null, falhasSeguidas: 0, timeoutsSeguidos: 0, ultimoTimeoutEm: null, proximaSondaEm: null, foraDoArDesde: null });
        return c;
      },
      async tornarNativo(id, p) {
        const c = b.conectores.find((c) => c.id === id && c.ownerId === escopo.pessoaId);
        if (!c) return null;
        Object.assign(c, { transporte: "stdio", comando: p.comando, args: [], url: null, envCifrado: p.envCifrado, env: Object.fromEntries(p.envChaves.map((k) => [k, true])), habilitado: false, catalogo: [], sondadoEm: null, ultimaFalha: null, falhasSeguidas: 0, timeoutsSeguidos: 0, ultimoTimeoutEm: null, proximaSondaEm: null, foraDoArDesde: null });
        return c;
      },
      async criar(c) {
        const env: Record<string, true> = {};
        for (const k of c.envChaves ?? []) env[k] = true;
        const conector: ConectorGuardado = {
          tenantId: escopo.tenantId,
          id: c.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          visibility: c.visibility ?? "privado",
          nome: c.nome,
          slug: c.slug,
          transporte: c.transporte,
          comando: c.comando ?? null,
          args: c.args ?? [],
          url: c.url ?? null,
          env,
          declaracao: c.declaracao,
          habilitado: false,
          catalogo: [],
          sondadoEm: null,
          ultimaFalha: null,
          criadoEm: agora(),
          falhasSeguidas: 0,
          timeoutsSeguidos: 0,
          ultimoTimeoutEm: null,
          proximaSondaEm: null,
          foraDoArDesde: null,
          envCifrado: c.envCifrado ?? null,
        };
        b.conectores.push(conector);
        return conector;
      },
      async buscar(id) {
        return doTenant(b.conectores).find((c) => c.id === id) ?? null;
      },
      async buscarPorSlug(slug) {
        return doTenant(b.conectores).find((c) => c.slug === slug) ?? null;
      },
      async listar() {
        return doTenant(b.conectores);
      },
      async listarHabilitados() {
        return doTenant(b.conectores).filter((c) => c.habilitado);
      },
      async registrarSonda(id, r) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c) return null;
        c.sondadoEm = r.agora;
        if (r.ok) {
          c.catalogo = r.catalogo;
          c.habilitado = true;
          Object.assign(c, { ultimaFalha: null, falhasSeguidas: 0, timeoutsSeguidos: 0, ultimoTimeoutEm: null, proximaSondaEm: null, foraDoArDesde: null });
        } else {
          c.ultimaFalha = { motivo: r.motivo, em: c.ultimaFalha?.em ?? r.agora, ...(r.causa ? { causa: r.causa } : {}) };
          c.foraDoArDesde = c.foraDoArDesde ?? r.agora;
        }
        return c;
      },
      async habilitar(id, habilitado) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c) return null;
        c.habilitado = habilitado;
        return c;
      },
      async atualizarEnv(id, p) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c) return false;
        c.envCifrado = p.envCifrado;
        const env: Record<string, true> = {};
        for (const k of p.envChaves) env[k] = true;
        c.env = env;
        return true;
      },
      async atualizarEnvSe(id, esperado, p) {
        const c = doTenant(b.conectores).find((x) => x.id === id);
        if (!c || (c.envCifrado ?? null) !== esperado) return false;
        c.envCifrado = p.envCifrado;
        const env: Record<string, true> = {};
        for (const k of p.envChaves) env[k] = true;
        c.env = env;
        return true;
      },
      async estadoFalhaTravado(id) {
        const c = doTenant(b.conectores).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        return c ? estadoDoConector(c) : null;
      },
      async gravarEstadoFalha(id, e) {
        const c = doTenant(b.conectores).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!c) return false;
        Object.assign(c, { ultimaFalha: e.ultimaFalha, falhasSeguidas: e.falhasSeguidas, timeoutsSeguidos: e.timeoutsSeguidos, ultimoTimeoutEm: e.ultimoTimeoutEm ?? null, proximaSondaEm: e.proximaSondaEm, foraDoArDesde: e.foraDoArDesde });
        return true;
      },
      async limparFalha(id) {
        const c = doTenant(b.conectores).find((x) => x.id === id && x.ownerId === escopo.pessoaId);
        if (!c || !temFalha(estadoDoConector(c))) return false;
        const antes = c.ultimaFalha;
        Object.assign(c, { ultimaFalha: null, falhasSeguidas: 0, timeoutsSeguidos: 0, ultimoTimeoutEm: null, proximaSondaEm: null, foraDoArDesde: null });
        return antes;
      },
      async comFalhaAberta() {
        return doTenant(b.conectores)
          .filter((c) => c.ownerId === escopo.pessoaId && c.habilitado && c.ultimaFalha !== null && c.ultimaFalha.causa !== "acesso_recusado")
          .map((c) => ({ id: c.id, slug: c.slug, nome: c.nome, estado: estadoDoConector(c) }));
      },
    },

    concessoes: {
      async conceder(c) {
        if (doTenant(b.concessoes).some((x) => x.agenteId === c.agenteId && x.conectorId === c.conectorId && x.capacidade === c.capacidade)) return null;
        const concessao: Concessao = { tenantId: escopo.tenantId, id: c.id ?? randomUUID(), ownerId: escopo.pessoaId, agenteId: c.agenteId, conectorId: c.conectorId, capacidade: c.capacidade, mensagemId: c.mensagemId, criadoEm: agora() };
        b.concessoes.push(concessao);
        return concessao;
      },
      async buscar(id) {
        return doTenant(b.concessoes).find((c) => c.id === id) ?? null;
      },
      async doAgente(agenteId) {
        return doTenant(b.concessoes).filter((c) => c.agenteId === agenteId);
      },
      async contarPorAgente(agenteIds) {
        const saida = new Map<string, number>();
        for (const id of agenteIds) {
          const n = doTenant(b.concessoes).filter((c) => c.agenteId === id).length;
          if (n > 0) saida.set(id, n);
        }
        return saida;
      },
      // Sem concorrência em memória: a trava advisory não tem o que serializar.
      async travar() {
        return undefined;
      },
      async migrarCapacidades(conectorId, mapa) {
        let n = 0;
        for (const c of doTenant(b.concessoes).filter((x) => x.conectorId === conectorId && x.capacidade in mapa)) {
          for (const nova of mapa[c.capacidade] ?? []) {
            if (doTenant(b.concessoes).some((x) => x.agenteId === c.agenteId && x.conectorId === conectorId && x.capacidade === nova)) continue;
            b.concessoes.push({ ...c, id: randomUUID(), capacidade: nova });
            n += 1;
          }
        }
        b.concessoes = b.concessoes.filter((x) => !(x.tenantId === escopo.tenantId && x.conectorId === conectorId && x.capacidade in mapa));
        return n;
      },
      async revogar(id) {
        const i = b.concessoes.findIndex((c) => c.tenantId === escopo.tenantId && c.id === id);
        if (i === -1) return false;
        b.concessoes.splice(i, 1);
        return true;
      },
    },

    procuracoes: {
      async criar(p) {
        const procuracao: Procuracao = { tenantId: escopo.tenantId, id: p.id ?? randomUUID(), ownerId: escopo.pessoaId, agenteConcedenteId: p.agenteConcedenteId, agenteBeneficiarioId: p.agenteBeneficiarioId, classesPermitidas: p.classesPermitidas, tetoDiario: p.tetoDiario, criadoEm: agora() };
        b.procuracoes.push(procuracao);
        return procuracao;
      },
      async listarDoBeneficiario(agenteBeneficiarioId) {
        return doTenant(b.procuracoes).filter((p) => p.agenteBeneficiarioId === agenteBeneficiarioId);
      },
    },

    inventario: {
      async registrar(motor, inv) {
        const existente = b.inventario.find((i) => i.tenantId === escopo.tenantId && i.pessoaId === escopo.pessoaId && i.motor === motor);
        if (existente) existente.inventario = inv;
        else b.inventario.push({ tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, motor, inventario: inv });
        return inv;
      },
      async buscar(motor) {
        return b.inventario.find((i) => i.tenantId === escopo.tenantId && i.pessoaId === escopo.pessoaId && i.motor === motor)?.inventario ?? null;
      },
      async listar() {
        return b.inventario.filter((i) => i.tenantId === escopo.tenantId && i.pessoaId === escopo.pessoaId).map(({ motor, inventario }) => ({ motor, inventario }));
      },
    },

    reacoes: {
      async por(p) {
        const ja = b.reacoes.some((r) => r.tenantId === escopo.tenantId && r.mensagemId === p.mensagemId && r.ownerId === escopo.pessoaId && r.emoji === p.emoji);
        if (ja) return false;
        b.reacoes.push({ tenantId: escopo.tenantId, ownerId: escopo.pessoaId, conversaId: p.conversaId, mensagemId: p.mensagemId, emoji: p.emoji, criadoEm: Date.now() });
        return true;
      },
      async tirar(p) {
        const antes = b.reacoes.length;
        b.reacoes = b.reacoes.filter((r) => !(r.tenantId === escopo.tenantId && r.mensagemId === p.mensagemId && r.ownerId === escopo.pessoaId && r.emoji === p.emoji));
        return b.reacoes.length < antes;
      },
      async dasMensagens(ids) {
        const saida: ReacaoNaFala[] = [];
        for (const id of ids) {
          const desta = doTenant(b.reacoes).filter((r) => r.mensagemId === id);
          for (const emoji of [...new Set(desta.map((r) => r.emoji))]) {
            const comEle = desta.filter((r) => r.emoji === emoji);
            saida.push({ mensagemId: id, emoji, total: comEle.length, minha: comEle.some((r) => r.ownerId === escopo.pessoaId) });
          }
        }
        return saida;
      },
    },

    relatos: {
      async criar(r) {
        const relato: Relato = {
          tenantId: escopo.tenantId,
          id: randomUUID(),
          mensagemId: r.mensagemId,
          tipo: r.tipo ?? "bug",
          origem: r.origem ?? "botao",
          conversaId: r.conversaId,
          turnoId: r.turnoId,
          categoria: r.categoria,
          alcance: r.alcance,
          mensagensAnexadas: r.mensagensAnexadas,
          metadados: {
            estadoTurno: r.estadoTurno,
            origemTurno: r.origemTurno,
            sinais: r.sinais,
            motivoFalha: r.motivoFalha,
            motivoInterrupcao: r.motivoInterrupcao,
            modelo: r.modelo,
            harness: r.harness,
            executor: r.executor,
            machineId: r.machineId,
            custoUsd: r.custoUsd,
            reenvios: r.reenvios,
            confiancaMensagem: r.confiancaMensagem,
            mensagemParcial: r.mensagemParcial,
            versaoApp: r.versaoApp,
            correlationId: r.correlationId,
          },
          diagnostico: null,
          criadoEm: Date.now(),
        };
        b.relatos.push({ ...relato, ownerId: escopo.pessoaId });
        return relato;
      },
      async gravarProsa() {},
      async listar(limite = 100) {
        return doTenant(b.relatos).sort((x, y) => y.criadoEm - x.criadoEm).slice(0, limite);
      },
      async buscar(id) {
        return doTenant(b.relatos).find((r) => r.id === id) ?? null;
      },
      async prosaDe() {
        return null;
      },
      async contarDoNodDesde(desde) {
        return doTenant(b.relatos).filter((r) => r.ownerId === escopo.pessoaId && r.origem === "nod" && r.criadoEm >= desde).length;
      },
      async registrarDiagnostico() {},
      async diagnosticoDoTurno() {
        return null;
      },
    },

    incidentes: {
      // Espelha o SQL (incidentes.repo.ts): um em curso (voltouEm null) por pessoa e tipo; sem advisory lock em memória.
      async travarUltimo(tipo) {
        const meus = b.incidentes.filter((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.tipo === tipo);
        return meus.find((i) => i.voltouEm === null) ?? [...meus].sort((x, y) => (y.voltouEm ?? 0) - (x.voltouEm ?? 0) || y.comecouEm - x.comecouEm)[0] ?? null;
      },
      async abrir(n) {
        if (n.voltouEm === null && b.incidentes.some((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.tipo === n.tipo && i.voltouEm === null)) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "incidente_em_curso"'), { code: "23505" });
        }
        const incidente = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), tipo: n.tipo, machineId: n.machineId, comecouEm: n.comecouEm, voltouEm: n.voltouEm, rotinas: n.rotinas, conversas: n.conversas, agentes: [...new Set(n.agentes)], dispensadoEm: null, criadoEm: agora() };
        b.incidentes.push(incidente);
        return incidente;
      },
      async mesclar(id, m) {
        const i = b.incidentes.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (!i) return null;
        i.comecouEm = Math.min(i.comecouEm, m.comecouEm);
        i.voltouEm = m.voltouEm === null ? null : Math.max(i.voltouEm ?? m.voltouEm, m.voltouEm);
        i.rotinas += m.rotinas;
        i.conversas += m.conversas;
        i.agentes = [...new Set([...i.agentes, ...m.agentes])];
        return i;
      },
      async emCurso() {
        return b.incidentes.filter((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.voltouEm === null).sort((x, y) => x.comecouEm - y.comecouEm);
      },
      async marcarVolta(id, em) {
        const i = b.incidentes.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id && x.voltouEm === null);
        if (!i) return null;
        i.voltouEm = Math.max(i.comecouEm, em);
        return i;
      },
      async dispensar(id, em) {
        const i = b.incidentes.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (!i) return null;
        i.dispensadoEm ??= em;
        return i;
      },
      async visiveis(desde) {
        return b.incidentes
          .filter((i) => i.tenantId === escopo.tenantId && i.ownerId === escopo.pessoaId && i.dispensadoEm === null && (i.voltouEm === null || i.voltouEm > desde))
          .sort((x, y) => x.comecouEm - y.comecouEm);
      },
    },

    gastos: {
      async registrar(g) {
        const gasto = { ...g, id: randomUUID(), tenantId: escopo.tenantId, ownerId: escopo.pessoaId };
        b.gastos.push(gasto);
        const { tenantId: _t, ownerId: _o, ...semEscopo } = gasto;
        return semEscopo;
      },
      async algumSemCusto(p) {
        const daConversa = (turnoId: string) => !p.conversaId || doTenant(b.turnos).some((t) => t.id === turnoId && t.conversaId === p.conversaId);
        return doTenant(b.gastos).some((g) => g.ownerId === escopo.pessoaId && g.custoUsd === null && g.tokensEntrada + g.tokensSaida > 0 && g.em >= p.desde && g.em <= p.ate && daConversa(g.turnoId));
      },
      async doTurno(turnoId) {
        // NOD-361: mesma ordem do Postgres (`order by em, id`).
        return doTenant(b.gastos)
          .filter((g) => g.turnoId === turnoId)
          .sort((x, y) => x.em - y.em || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
          .map(({ tenantId: _t, ownerId: _o, ...g }) => g);
      },
      async somarMes(em, executor) {
        const inicio = new Date(em);
        inicio.setUTCDate(1);
        inicio.setUTCHours(0, 0, 0, 0);
        return doTenant(b.gastos)
          .filter((g) => g.ownerId === escopo.pessoaId && g.em >= inicio.getTime() && (executor === undefined || g.executor === executor))
          .reduce((s, g) => s + (g.custoUsd ?? 0), 0);
      },
    },

    trilha: {
      async registrar(t) {
        const linha: LinhaTrilha = {
          tenantId: escopo.tenantId,
          id: randomUUID(),
          ownerId: escopo.pessoaId,
          agenteId: t.agenteId,
          turnoId: t.turnoId ?? null,
          conectorId: t.conectorId ?? null,
          ferramenta: t.ferramenta,
          kind: t.kind,
          motivo: t.motivo ?? null,
          regra: t.regra,
          regraVersao: t.regraVersao,
          em: iso(t.em ?? agora()),
        };
        b.trilha.push(linha);
        return linha;
      },
      async doTurno(turnoId) {
        return doTenant(b.trilha).filter((l) => l.turnoId === turnoId);
      },
      async doTurnos(turnoIds) {
        return doTenant(b.trilha).filter((l) => l.turnoId !== null && turnoIds.includes(l.turnoId));
      },
      async agentesComNegacaoDoConector(conectorId, desde) {
        const ids = doTenant(b.trilha).filter((l) => l.ownerId === escopo.pessoaId && l.kind === "negacao" && (MOTIVOS_DE_CONECTOR_FORA as readonly string[]).includes(l.motivo ?? "") && l.conectorId === conectorId && Date.parse(l.em) >= desde).map((l) => l.agenteId);
        return [...new Set(ids)].sort();
      },
      async decisoesDoAgente(f) {
        const decisoes = doTenant(b.trilha)
          .filter((l) => l.ownerId === escopo.pessoaId && l.agenteId === f.agenteId && f.kinds.includes(l.kind) && ehDecisao(l))
          .filter((l) => Date.parse(l.em) >= f.desde && Date.parse(l.em) < f.ate)
          .sort((x, y) => (x.em === y.em ? (x.id < y.id ? 1 : -1) : x.em < y.em ? 1 : -1));
        const i = f.cursor ? decisoes.findIndex((l) => l.id === f.cursor) : -1;
        if (f.cursor && i < 0) return [];
        return decisoes.slice(i + 1, i + 1 + f.limite);
      },
      async contarDecisoesDoAgente(f) {
        const n: Record<string, number> = {};
        for (const l of doTenant(b.trilha)) {
          if (l.ownerId !== escopo.pessoaId || l.agenteId !== f.agenteId || !ehDecisao(l)) continue;
          if (Date.parse(l.em) < f.desde || Date.parse(l.em) >= f.ate) continue;
          n[l.kind] = (n[l.kind] ?? 0) + 1;
        }
        return n;
      },
      async temDecisaoAntes(f) {
        return doTenant(b.trilha).some((l) => l.ownerId === escopo.pessoaId && l.agenteId === f.agenteId && ehDecisao(l) && Date.parse(l.em) < f.antes);
      },
      async filtrar(f = {}) {
        return doTenant(b.trilha)
          .filter((l) => !f.agenteId || l.agenteId === f.agenteId)
          .filter((l) => !f.conectorId || l.conectorId === f.conectorId)
          .filter((l) => !f.dia || l.em.slice(0, 10) === f.dia)
          .sort((x, y) => Date.parse(y.em) - Date.parse(x.em))
          .slice(0, f.limite ?? 500);
      },
    },

    nativasIdempotencia: {
      async travar(turnoId, chave) {
        return b.nativasIdempotencia.get(`${escopo.tenantId}:${escopo.pessoaId}:${turnoId}:${chave}`) ?? null;
      },
      async registrar(turnoId, chave, resposta) {
        b.nativasIdempotencia.set(`${escopo.tenantId}:${escopo.pessoaId}:${turnoId}:${chave}`, resposta);
      },
      async podar() {
        return 0;
      },
    },

    paradas: {
      async ativar(p) {
        const parada = { tenantId: escopo.tenantId, id: randomUUID(), pessoaId: escopo.pessoaId, conversaId: p.conversaId, ativaDesde: p.agora, encerradaEm: null, faixa: null };
        b.paradas.push(parada);
        const { tenantId: _t, ...semTenant } = parada;
        return semTenant;
      },
      async encerrar(id, p) {
        const x = doTenant(b.paradas).find((y) => y.id === id && y.encerradaEm === null);
        if (!x) return null;
        x.encerradaEm = p.agora;
        x.faixa = p.faixa;
        const { tenantId: _t, ...semTenant } = x;
        return semTenant;
      },
      async encerrarAbertas(p) {
        let n = 0;
        for (const x of doTenant(b.paradas)) {
          if (x.pessoaId === escopo.pessoaId && x.encerradaEm === null && (p.conversaId === null || x.conversaId === null || x.conversaId === p.conversaId)) {
            x.encerradaEm = p.agora;
            n += 1;
          }
        }
        return n;
      },
      async ativa(pessoaId, conversaId) {
        return doTenant(b.paradas).some((x) => x.pessoaId === pessoaId && x.encerradaEm === null && (x.conversaId === null || x.conversaId === conversaId));
      },
      async listarAbertas() {
        return doTenant(b.paradas)
          .filter((x) => x.pessoaId === escopo.pessoaId && x.encerradaEm === null)
          .map(({ tenantId: _t, ...p }) => p);
      },
    },

    catcher: {
      async registrar(r) {
        const reg = { tenantId: escopo.tenantId, id: randomUUID(), turnoId: r.turnoId, tipo: r.tipo, dados: r.dados, em: agora() + b.catcher.length / 1000 };
        b.catcher.push(reg);
        const { tenantId: _t, ...semTenant } = reg;
        return semTenant;
      },
      async listar(turnoId) {
        return doTenant(b.catcher)
          .filter((r) => r.turnoId === turnoId)
          .sort((x, y) => x.em - y.em)
          .map(({ tenantId: _t, ...r }) => r);
      },
      async listarRecentes(limite = 100) {
        return doTenant(b.catcher)
          .sort((x, y) => y.em - x.em)
          .slice(0, limite)
          .map(({ tenantId: _t, ...r }) => r);
      },
    },
    rotinaGatilhos: {
      async criar(e, agora) {
        for (const g of daDona(b.rotinaGatilhos)) if (g.rotinaId === e.rotinaId && g.revogadoEm === null) g.revogadoEm = agora;
        const g = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), rotinaId: e.rotinaId, prefixo: e.prefixo, hash: e.hash, tokenCifrado: e.tokenCifrado, segredoHmacCifrado: e.segredoHmacCifrado, criadoEm: agora, assinadoEm: null, revogadoEm: null };
        b.rotinaGatilhos.push(g);
        return { id: g.id, rotinaId: g.rotinaId, prefixo: g.prefixo, criadoEm: g.criadoEm, assinadoEm: null };
      },
      async vivoDaRotina(rotinaId) {
        const g = daDona(b.rotinaGatilhos).find((x) => x.rotinaId === rotinaId && x.revogadoEm === null);
        return g ? { id: g.id, rotinaId: g.rotinaId, prefixo: g.prefixo, criadoEm: g.criadoEm, assinadoEm: g.assinadoEm, hash: g.hash, tokenCifrado: g.tokenCifrado, segredoHmacCifrado: g.segredoHmacCifrado } : null;
      },
      async vivosDaPessoa() {
        return daDona(b.rotinaGatilhos).filter((x) => x.revogadoEm === null).map((g) => ({ id: g.id, rotinaId: g.rotinaId, prefixo: g.prefixo, criadoEm: g.criadoEm, assinadoEm: g.assinadoEm }));
      },
      async revogarDaRotina(rotinaId, agora) {
        let n = 0;
        for (const g of daDona(b.rotinaGatilhos)) if (g.rotinaId === rotinaId && g.revogadoEm === null) { g.revogadoEm = agora; n++; }
        return n;
      },
      async marcarAssinado(id, agora) {
        const g = daDona(b.rotinaGatilhos).find((x) => x.id === id && x.revogadoEm === null);
        if (!g) return false;
        g.assinadoEm ??= agora;
        return true;
      },
    },
    rotinaChamadas: {
      async registrar(c) {
        if (c.entregaId && daDona(b.rotinaChamadas).some((x) => x.rotinaId === c.rotinaId && x.entregaId === c.entregaId)) return null;
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), rotinaId: c.rotinaId, em: c.em, desfecho: c.desfecho, motivo: c.motivo ?? null, evento: c.evento ?? null, entregaId: c.entregaId ?? null, turnoId: c.turnoId ?? null };
        b.rotinaChamadas.push(l);
        const { tenantId: _t, ownerId: _o, entregaId: _e, ...dto } = l;
        return dto;
      },
      async jaEntregue(rotinaId, entregaId) {
        return daDona(b.rotinaChamadas).some((x) => x.rotinaId === rotinaId && x.entregaId === entregaId);
      },
      async listar(rotinaId, n) {
        return daDona(b.rotinaChamadas).filter((x) => x.rotinaId === rotinaId).sort((x, y) => y.em - x.em).slice(0, n)
          .map(({ tenantId: _t, ownerId: _o, entregaId: _e, ...dto }) => dto);
      },
      async contarDesde(rotinaId, desde, desfecho) {
        return daDona(b.rotinaChamadas).filter((x) => x.rotinaId === rotinaId && x.em >= desde && (!desfecho || x.desfecho === desfecho)).length;
      },
      async comRecusaPendente() {
        const ids = new Set(daDona(b.rotinaChamadas).map((x) => x.rotinaId));
        return [...ids].filter((id) => recusaPendente(daDona(b.rotinaChamadas).filter((x) => x.rotinaId === id)));
      },
      async podar(rotinaId, agora, manter) {
        const dela = daDona(b.rotinaChamadas).filter((x) => x.rotinaId === rotinaId).sort((x, y) => y.em - x.em);
        const fica = new Set(dela.slice(0, manter).map((x) => x.id));
        const sai = dela.filter((x) => !fica.has(x.id) && x.em < agora - 72 * 3_600_000).map((x) => x.id);
        b.rotinaChamadas = b.rotinaChamadas.filter((x) => !sai.includes(x.id));
        return sai.length;
      },
    },
    maquinaTokens: {
      async criar(e) {
        const papel = e.papel ?? "motor";
        // O índice único parcial da 0105 (maquina_tokens_um_computador), como no Postgres.
        if (papel === "computador" && b.maquinaTokens.some((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.papel === "computador" && x.revogadaEm === null)) throw Object.assign(new Error("23505"), { code: "23505" });
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), nome: e.nome, prefixo: e.prefixo, hash: e.hash, criadaEm: agora(), ultimoUsoEm: null as number | null, expiraEm: null as number | null, revogadaEm: null as number | null, papel };
        b.maquinaTokens.push(l);
        return { id: l.id, nome: l.nome, prefixo: l.prefixo, criadaEm: l.criadaEm, ultimoUsoEm: null, revogadaEm: null, papel };
      },
      async computadorVivo(em) {
        const dela = b.maquinaTokens.filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.papel === "computador" && x.revogadaEm === null);
        for (const x of dela) if (x.expiraEm !== null && x.expiraEm <= em) x.revogadaEm = x.expiraEm;
        const viva = dela.find((x) => x.revogadaEm === null);
        return viva ? { id: viva.id, nome: viva.nome } : null;
      },
      async listar() {
        return b.maquinaTokens
          .filter((l) => l.tenantId === escopo.tenantId && l.ownerId === escopo.pessoaId)
          .sort((x, y) => y.criadaEm - x.criadaEm)
          .map(({ id, nome, prefixo, criadaEm, ultimoUsoEm, revogadaEm, expiraEm, papel }) => ({ id, nome, prefixo, criadaEm, ultimoUsoEm, revogadaEm: revogadaEm ?? (expiraEm !== null && expiraEm <= Date.now() ? expiraEm : null), papel: papel ?? "motor" }));
      },
      async vivasComPlataforma() {
        return b.maquinaTokens
          .filter((l) => l.tenantId === escopo.tenantId && l.ownerId === escopo.pessoaId && l.revogadaEm === null && (l.expiraEm === null || l.expiraEm > Date.now()) && (l.papel ?? "motor") === "motor")
          .sort((x, y) => y.criadaEm - x.criadaEm)
          .map((l) => ({ id: l.id, nome: l.nome, plataforma: l.plataforma ?? null }));
      },
      async revogar(id, em) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (!l) return false;
        l.revogadaEm ??= em;
        return true;
      },
      async vencerEm(id, ate) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id && x.revogadaEm === null);
        if (!l) return false;
        l.expiraEm = l.expiraEm === null ? ate : Math.min(l.expiraEm, ate);
        return true;
      },
      async buscarVivaPorHash(hash, em) {
        // Filtra expiração como o repo real (maquina-tokens.repo.ts): duplo que ignora `em` esconde bug.
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.revogadaEm === null && (x.expiraEm === null || x.expiraEm > em) && x.hash.equals(hash));
        return l ? { id: l.id, hash: l.hash } : null;
      },
      async marcarUso(id, em) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        // Como o repo real (NOD-293 A8): grava no máximo a cada MARCAR_USO_A_CADA_MS.
        if (!l || (l.ultimoUsoEm !== null && l.ultimoUsoEm >= em - MARCAR_USO_A_CADA_MS)) return false;
        l.ultimoUsoEm = em;
        return true;
      },
      async renomear(id, nome) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id && x.revogadaEm === null);
        if (!l) return false;
        l.nome = nome;
        return true;
      },
      async registrarPlataforma(id, plataforma) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        if (l) l.plataforma = plataforma;
      },
      async removida(id, em) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        return l !== undefined && (l.revogadaEm !== null || (l.expiraEm !== null && l.expiraEm <= em));
      },
      async identificar(id) {
        const l = b.maquinaTokens.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.id === id);
        return l ? { nome: l.nome, plataforma: l.plataforma ?? null, papel: l.papel ?? "motor", ultimoUsoEm: (l as { ultimoUsoEm?: Date | null }).ultimoUsoEm?.getTime() ?? null } : null;
      },
    },
    maquinasSsh: {
      async registrar(e, em) {
        const minha = (x: { tenantId: string; ownerId: string }) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId;
        const ja = b.maquinasSsh.find((x) => minha(x) && x.host.toLowerCase() === e.host.toLowerCase() && x.porta === e.porta);
        if (ja) {
          Object.assign(ja, { maquinaId: e.maquinaId, usuario: e.usuario, impressaoHost: e.impressaoHost, atualizadoEm: em });
          const { tenantId: _t, ownerId: _o, ...dto } = ja;
          return dto;
        }
        const l = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), ...e, criadoEm: em, atualizadoEm: em };
        b.maquinasSsh.push(l);
        const { tenantId: _t, ownerId: _o, ...dto } = l;
        return dto;
      },
      async doEndereco(host, porta) {
        const l = b.maquinasSsh.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.host.toLowerCase() === host.toLowerCase() && x.porta === porta);
        if (!l) return null;
        const { tenantId: _t, ownerId: _o, ...dto } = l;
        return dto;
      },
      async trocarImpressao(host, porta, impressaoHost, em) {
        const l = b.maquinasSsh.find((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.host.toLowerCase() === host.toLowerCase() && x.porta === porta);
        if (!l) return false;
        l.impressaoHost = impressaoHost;
        l.atualizadoEm = em;
        return true;
      },
      async daMaquina(maquinaId) {
        const l = b.maquinasSsh
          .filter((x) => x.tenantId === escopo.tenantId && x.ownerId === escopo.pessoaId && x.maquinaId === maquinaId)
          .sort((x, y) => y.atualizadoEm - x.atualizadoEm)[0];
        if (!l) return null;
        const { tenantId: _t, ownerId: _o, ...dto } = l;
        return dto;
      },
    },
    // ADR-121: a máquina na nuvem só existe no Postgres (os testes dela são de integração); aqui a pessoa não tem nenhuma.
    maquinasNuvem: {
      criarConectada: async () => { throw new Error("maquinas_nuvem: só no Postgres"); },
      buscar: async () => null,
      buscarPorMaquina: async () => null,
      listarDaPessoa: async () => [],
      idsAcordando: async () => new Set<string>(),
      definirDormirApos: async () => false,
      pedirAcordar: async () => false,
      tentarDormir: async () => ({ ok: false, motivo: "nao_encontrada" }),
      ociosasParaDormir: async () => [],
      marcarAtividade: async () => 0,
      acordarSePreciso: async () => 0,
      paraReconciliar: async () => [],
      reservar: async () => false,
      concluir: async () => false,
      soltar: async () => undefined,
      marcarExclusaoPendente: async () => false,
      eventos: async () => [],
      criarIntencao: async () => { throw new Error("maquinas_nuvem: só no Postgres"); },
      dadosDaCriacao: async () => null,
      convitesAtivos: async () => [],
      vincularCriada: async () => null,
      confirmarCriada: async () => false,
      criandoSemMaquina: async () => [],
      marcarExcluida: async () => null,
    },
    credenciaisNuvem: {
      gravar: async () => { throw new Error("credenciais_nuvem: só no Postgres"); },
      atual: async () => null,
      chaveCifrada: async () => null,
      revogar: async () => false,
    },
    permissoesPermanentes: {
      async criar(p) {
        const ja = doTenant(b.permissoes).some((x) => x.agenteId === p.agenteId && x.conectorId === p.conectorId && x.capacidade === p.capacidade && x.inativoEm === null);
        if (ja) return null;
        const permissao = {
          tenantId: escopo.tenantId,
          id: p.id ?? randomUUID(),
          ownerId: escopo.pessoaId,
          agenteId: p.agenteId,
          conectorId: p.conectorId,
          capacidade: p.capacidade,
          itemOrigemId: p.itemOrigemId,
          mensagemId: p.mensagemId,
          regraVersao: p.regraVersao,
          criadoEm: agora(),
          inativoEm: null,
          inativoMotivo: null,
        };
        b.permissoes.push(permissao);
        return permissao;
      },
      async ativasDoAgente(agenteId) {
        return doTenant(b.permissoes).filter((p) => p.agenteId === agenteId && p.ownerId === escopo.pessoaId && p.inativoEm === null);
      },
      async listar(agenteId) {
        return doTenant(b.permissoes).filter((p) => p.ownerId === escopo.pessoaId && (!agenteId || p.agenteId === agenteId));
      },
      async buscar(id) {
        return doTenant(b.permissoes).find((p) => p.id === id) ?? null;
      },
      async desativar(id, motivo, quando) {
        const p = doTenant(b.permissoes).find((x) => x.id === id && x.ownerId === escopo.pessoaId && x.inativoEm === null);
        if (!p) return false;
        p.inativoEm = quando;
        p.inativoMotivo = motivo;
        return true;
      },
      async migrarCapacidades(conectorId, mapa, quando) {
        let n = 0;
        for (const p of doTenant(b.permissoes).filter((x) => x.conectorId === conectorId && x.inativoEm === null && x.capacidade in mapa)) {
          b.permissoes.push({ ...p, id: randomUUID(), capacidade: mapa[p.capacidade] ?? p.capacidade });
          p.inativoEm = quando;
          p.inativoMotivo = "capacidade_fora_do_catalogo";
          n += 1;
        }
        return n;
      },
      async desativarPor(filtro, motivo, quando) {
        const alvos = doTenant(b.permissoes).filter((p) => p.inativoEm === null
          && (!filtro.agenteId || p.agenteId === filtro.agenteId)
          && (!filtro.conectorId || p.conectorId === filtro.conectorId)
          && (!filtro.capacidade || p.capacidade === filtro.capacidade));
        for (const p of alvos) { p.inativoEm = quando; p.inativoMotivo = motivo; }
        return alvos.length;
      },
    },
    raioX: {
      async gravarComposicao(turnoId, composicao) {
        b.raioX.set(turnoId, { execucao: null, ...b.raioX.get(turnoId), composicao });
      },
      async gravarExecucao(turnoId, execucao) {
        b.raioX.set(turnoId, { composicao: null, ...b.raioX.get(turnoId), execucao });
      },
      async doTurno(turnoId) {
        const t = doTenant(b.turnos).find((x) => x.id === turnoId);
        if (!t) return null;
        const r = b.raioX.get(t.id);
        return { turnoId: t.id, agenteId: t.agenteId, estado: t.estado, custoUsd: t.custoUsd, criadoEm: t.criadoEm, composicao: r?.composicao ?? null, execucao: r?.execucao ?? null };
      },
      async ultimaJanela(conversaId, agenteId, modelo) {
        const t = doTenant(b.turnos).filter((x) => x.conversaId === conversaId && x.agenteId === agenteId && x.modelo === modelo).sort((x, y) => y.criadoEm - x.criadoEm).slice(0, TURNOS_DA_JANELA)
          .find((x) => typeof b.raioX.get(x.id)?.execucao?.janela === "number");
        return t ? b.raioX.get(t.id)?.execucao?.janela ?? null : null;
      },
      async daConversa(conversaId, limite) {
        return doTenant(b.turnos).filter((t) => t.conversaId === conversaId).sort((x, y) => y.criadoEm - x.criadoEm).slice(0, limite)
          .map((t) => ({ turnoId: t.id, agenteId: t.agenteId, estado: t.estado, custoUsd: t.custoUsd, criadoEm: t.criadoEm, composicao: null, execucao: b.raioX.get(t.id)?.execucao ?? null }));
      },
      async totalDesde(conversaId, desde) {
        const comGasto = (id: string) => doTenant(b.gastos).some((g) => g.turnoId === id && g.tokensEntrada + g.tokensSaida > 0);
        const com = doTenant(b.turnos).filter((t) => t.conversaId === conversaId && t.criadoEm >= desde && (t.custoUsd !== null || comGasto(t.id)));
        const parcial = com.some((t) => t.custoUsd === null);
        return { custoUsd: com.reduce((s, t) => s + (t.custoUsd ?? 0), 0), turnos: com.length, ...(parcial ? { parcial: true } : {}) };
      },
    },
    preferencias: (() => {
      const chave = `${escopo.tenantId}:${escopo.pessoaId}`;
      const atual = (): Preferencias => b.preferencias.get(chave) ?? { modoDev: false, avisosFechados: [], usoDoMac: "equilibrado", maquinaPadraoId: null, ordemIas: null, iasNoLimite: {} };
      const abertos = new Map<string, string>();
      return {
        async quadrosNLiberado() {
          return true;
        },
        async quadroAberto(agenteId) {
          return abertos.get(agenteId) ?? null;
        },
        async abrirQuadro(agenteId, quadroId) {
          abertos.set(agenteId, quadroId);
        },
        async buscar() {
          return atual();
        },
        async gravar(p) {
          const nova = { ...atual(), ...(p.modoDev !== undefined ? { modoDev: p.modoDev } : {}), ...(p.usoDoMac !== undefined ? { usoDoMac: p.usoDoMac } : {}), ...(p.ordemIas !== undefined ? { ordemIas: p.ordemIas } : {}) };
          b.preferencias.set(chave, nova);
          return nova;
        },
        async registrarLimite(ia, limite) {
          const nova = { ...atual(), iasNoLimite: { ...atual().iasNoLimite, [ia]: limite } };
          b.preferencias.set(chave, nova);
          return nova.iasNoLimite;
        },
        async limparLimite(ia) {
          const a = atual();
          if (!a.iasNoLimite?.[ia]) return false;
          const limites = { ...a.iasNoLimite };
          delete limites[ia];
          b.preferencias.set(chave, { ...a, iasNoLimite: limites });
          return true;
        },
        async definirMaquinaPadrao(maquinaId) {
          const nova = { ...atual(), maquinaPadraoId: maquinaId };
          b.preferencias.set(chave, nova);
          return nova;
        },
        async exibirQuadro(quadroId, e, max) {
          const a = atual();
          const m = a.quadroExibir ?? {};
          if (!(quadroId in m) && Object.keys(m).length >= max) return null;
          const nova = { ...a, quadroExibir: { ...(a.quadroExibir ?? {}), [quadroId]: { recolhidas: true, compacto: false, ...m[quadroId], ...e } } };
          b.preferencias.set(chave, nova);
          return nova;
        },
        async fecharAviso(aviso) {
          const a = atual();
          const nova = a.avisosFechados.includes(aviso) ? a : { ...a, avisosFechados: [...a.avisosFechados, aviso] };
          b.preferencias.set(chave, nova);
          return nova;
        },
      };
    })(),
    onboarding: (() => {
      const chave = `${escopo.tenantId}:${escopo.pessoaId}`;
      const atual = (): LinhaOnboarding => b.onboarding.get(chave) ?? { etapa: null, guiaId: null, botId: null, concluidoEm: null, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null } };
      const mudar = async (fn: (l: LinhaOnboarding) => LinhaOnboarding) => {
        const l = fn(atual());
        b.onboarding.set(chave, l);
        return l;
      };
      const CAMPO = { apelido: "apelido", como_conheceu: "comoConheceu", objetivo: "objetivo", tamanho_time: "tamanhoTime" } as const;
      return {
        async buscar() { return atual(); },
        definirEtapa: (etapa: Exclude<LinhaOnboarding["etapa"], "concluido" | null>) => mudar((l) => ({ ...l, etapa })),
        reiniciar: () => mudar((l) => ({ ...l, etapa: "ola", concluidoEm: null, botId: null, campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null } })),
        concluir: (em: number) => mudar((l) => ({ ...l, etapa: "concluido", concluidoEm: em })),
        anotar: (campo: keyof typeof CAMPO, valor: string) => mudar((l) => ({ ...l, campos: { ...l.campos, [CAMPO[campo]]: valor } })),
        definirGuia: (id: string) => mudar((l) => ({ ...l, guiaId: id })),
        definirBot: (id: string) => mudar((l) => ({ ...l, botId: id })),
      };
    })(),
    comandos: {
      async gravar(catalogo) {
        b.comandos.set(`${escopo.tenantId}:${escopo.pessoaId}`, { catalogo, em: agora() });
      },
      async buscar() {
        return b.comandos.get(`${escopo.tenantId}:${escopo.pessoaId}`) ?? null;
      },
    },
    usoDoPlano: {
      async gravar(uso, machineId, contaId = null) {
        const gravar = (chave: string, u: UsoDoPlano) => {
          const atual = b.usoDoPlano.get(chave);
          if (!atual || atual.medidoEm < u.medidoEm) b.usoDoPlano.set(chave, u);
        };
        if (contaId) gravar(`${escopo.tenantId}:${escopo.pessoaId}:conta:${contaId}`, { ...uso, contaId, maquinaId: machineId && /^[0-9a-f-]{36}$/i.test(machineId) ? machineId : null });
        gravar(`${escopo.tenantId}:${escopo.pessoaId}:${uso.harness}`, uso);
      },
      async listar() {
        const prefixo = `${escopo.tenantId}:${escopo.pessoaId}:`;
        return [...b.usoDoPlano].filter(([k]) => k.startsWith(prefixo) && !k.startsWith(`${prefixo}conta:`)).map(([, v]) => v).sort((x, y) => x.harness.localeCompare(y.harness));
      },
      async listarPorConta() {
        const prefixo = `${escopo.tenantId}:${escopo.pessoaId}:conta:`;
        return [...b.usoDoPlano].filter(([k]) => k.startsWith(prefixo)).map(([, v]) => v).sort((x, y) => x.harness.localeCompare(y.harness) || (x.contaId ?? "").localeCompare(y.contaId ?? ""));
      },
    },
    leituras: (() => {
      const chave = (conversaId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${conversaId}`;
      // NOD-449: o mesmo nova() do Postgres (leituras.repo.ts): fala de bot ou rotina que falhou; a fala entre bots (pedido
      // de colega, o turno peer, a triagem, a frente do trabalho de um colega e as retomadas deles) não, salvo o aviso.
      const deColega = (t: Turno) => t.origem === "peer" || (t.origem === "delegacao" && (doTenant(b.mensagens).some((p) => p.turnoId === t.id && p.payload?.kind === "peer_pedido") || doTenant(b.trabalhos).some((w) => w.id === t.trabalhoId && w.pedidoPorAgenteId)));
      const raiz = (id: string) => {
        let t = doTenant(b.turnos).find((x) => x.id === id);
        for (let n = 0; t?.origem === "retomada" && t.retomaTurnoId && n < 10; n++) t = doTenant(b.turnos).find((x) => x.id === t!.retomaTurnoId);
        return t;
      };
      const entreBots = (m: Mensagem) => m.payload?.kind === "peer_pedido" || (m.turnoId !== null && (() => { const t = raiz(m.turnoId!); return t !== undefined && t.origem !== "retomada" && deColega(t); })());
      const avisa = (m: Mensagem) => m.payload?.kind === "aviso_pessoa" || (m.kind === "rotina_execucao" && (m.payload as { desfecho?: string } | null)?.desfecho !== undefined && ["falhou", "nao_rodou"].includes((m.payload as { desfecho: string }).desfecho));
      const nova = (m: Mensagem) => (((m.kind === "texto" || m.kind === "artefato") && !(m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === escopo.pessoaId)) || avisa(m)) && (avisa(m) || !entreBots(m));
      const naoLidas = (conversaId: string) => {
        const ate = b.leituras.get(chave(conversaId)) ?? -Infinity;
        return doTenant(b.mensagens).filter((m) => m.conversaId === conversaId && m.criadoEm > ate && nova(m)).sort((x, y) => x.criadoEm - y.criadoEm);
      };
      return {
        async resumo() {
          return doTenant(b.conversas)
            .filter((c) => c.tipo === "sala" || c.ownerId === escopo.pessoaId)
            .flatMap((c) => {
              const ms = naoLidas(c.id);
              return ms.length ? [{ conversaId: c.id, tipo: c.tipo, agenteId: c.agenteId, salaId: c.salaId, total: ms.length, desde: ms[0]!.criadoEm, ultimaEm: ms[ms.length - 1]!.criadoEm }] : [];
            })
            .sort((x, y) => y.ultimaEm - x.ultimaEm);
        },
        async mensagens(conversaIds: readonly string[], por = 3) {
          const saida = new Map<string, { primeira: Mensagem; ultimas: Mensagem[]; avisos: Mensagem[]; daRotina: boolean }>();
          for (const id of conversaIds) {
            const ms = naoLidas(id);
            if (!ms.length) continue;
            const turnos = new Set(ms.map((m) => m.turnoId));
            saida.set(id, { primeira: ms[0]!, ultimas: ms.slice(-por), avisos: [], daRotina: doTenant(b.turnos).some((t) => turnos.has(t.id) && t.origem === "rotina") });
          }
          return saida;
        },
        async marcarLida(conversaId: string) {
          const ultima = Math.max(...doTenant(b.mensagens).filter((m) => m.conversaId === conversaId).map((m) => m.criadoEm), -Infinity);
          const ate = Number.isFinite(ultima) ? ultima : agora();
          const antes = b.leituras.get(chave(conversaId));
          const depois = Math.max(antes ?? -Infinity, ate);
          b.leituras.set(chave(conversaId), depois);
          // NOD-449: o texto exato do banco (µs, UTC) a partir do ms da memória.
          const texto = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : `${new Date(v).toISOString().slice(0, 23)}000`);
          return { conversaId, antes: texto(antes), depois: texto(depois) };
        },
        async restaurarLeituras(ls: readonly import("../../src/contracts/nao-lidos.ts").LeituraMarcada[]) {
          let n = 0;
          for (const l of ls) {
            const atual = b.leituras.get(chave(l.conversaId));
            if (l.depois === null || atual === undefined || Date.parse(`${l.depois.slice(0, 23)}Z`) !== Math.floor(atual)) continue;
            b.leituras.set(chave(l.conversaId), l.antes === null ? -Infinity : Date.parse(`${l.antes.slice(0, 23)}Z`));
            n++;
          }
          return n;
        },
        async marcarNaoLida(conversaId: string) {
          const ultima = Math.max(...doTenant(b.mensagens).filter((m) => m.conversaId === conversaId && nova(m)).map((m) => m.criadoEm), -Infinity);
          const lido = b.leituras.get(chave(conversaId));
          // Como o Postgres: só reabre o que está lido de fato (sem leitura, ou com fala depois, já está em Não lidos).
          if (!Number.isFinite(ultima) || lido === undefined || lido < ultima) return false;
          b.leituras.set(chave(conversaId), ultima - 0.001);
          return true;
        },
      };
    })(),
    // definido em 2026-10-04 (ADR-075): ligações em memória, só o necessário para os testes de unidade.
    ligacoes: (() => {
      type L = import("../../src/contracts/ligacao.ts").Ligacao & { ownerId: string; tenantId: string };
      const lista: L[] = [];
      const falas: (import("../../src/contracts/ligacao.ts").FalaLigacao & { ligacaoId: string })[] = [];
      let consentimento: { versao: number | null; em: number | null } = { versao: null, em: null };
      const minhas = () => lista.filter((l) => l.tenantId === escopo.tenantId && l.ownerId === escopo.pessoaId);
      const sem = (l: L | undefined) => (l ? (({ ownerId: _o, tenantId: _t, ...r }) => r)(l) : null);
      return {
        async criar(n: import("../../src/repositories/ligacoes.repo.ts").NovaLigacao) {
          if (minhas().some((l) => l.estado === "chamando" || l.estado === "em_curso")) return null;
          const l: L = { ...n, id: randomUUID(), estado: "chamando", mensagemId: null, iniciadaEm: agora(), atendidaEm: null, encerradaEm: null, motivoFim: null, duracaoMs: null, religacoes: 0, trocas: 0, interrupcoes: 0, sttSegundos: 0, ttsCaracteres: 0, custoEstimadoUsd: null, latenciaP50Ms: null, latenciaP95Ms: null, avaliacao: null, transcricaoApagadaEm: null, resumida: false, ownerId: escopo.pessoaId, tenantId: escopo.tenantId };
          lista.push(l);
          return sem(l);
        },
        async buscar(id: string) { return sem(minhas().find((l) => l.id === id)); },
        async viva() { return sem(minhas().find((l) => l.estado === "chamando" || l.estado === "em_curso")); },
        async vivas() { return minhas().filter((l) => l.estado === "chamando" || l.estado === "em_curso").map((l) => sem(l)!); },
        async vincularMensagem(id: string, mensagemId: string) { const l = minhas().find((x) => x.id === id); if (l) l.mensagemId = mensagemId; },
        async atender(id: string, em: number) { const l = minhas().find((x) => x.id === id && (x.estado === "chamando" || x.estado === "em_curso")); if (!l) return null; l.estado = "em_curso"; l.atendidaEm ??= em; return sem(l); },
        async religou(id: string) { const l = minhas().find((x) => x.id === id); if (l) l.religacoes += 1; },
        async encerrar(id: string, p: { motivo: import("../../src/contracts/voz.ts").MotivoFimLigacao; agora: number }) {
          const l = minhas().find((x) => x.id === id && (x.estado === "chamando" || x.estado === "em_curso"));
          if (!l) return null;
          l.estado = l.atendidaEm === null ? "nao_atendida" : "encerrada";
          l.encerradaEm = p.agora;
          l.motivoFim = l.atendidaEm === null && ["pessoa_desligou", "cerebro_caiu", "midia_caiu"].includes(p.motivo) ? "nao_atendida" : p.motivo;
          l.duracaoMs = l.atendidaEm === null ? 0 : Math.max(0, p.agora - l.atendidaEm);
          return sem(l);
        },
        async marcarResumida(id: string) { const l = minhas().find((x) => x.id === id); if (l) l.resumida = true; },
        async duracaoDesde(desde: number) { return minhas().filter((l) => l.iniciadaEm >= desde && l.iniciadaPor === "pessoa").reduce((s, l) => s + (l.duracaoMs ?? 0), 0); },
        async gravarFala(f: import("../../src/repositories/ligacoes.repo.ts").NovaFala) { if (falas.some((x) => x.ligacaoId === f.ligacaoId && x.seq === f.seq)) return false; falas.push({ ligacaoId: f.ligacaoId, seq: f.seq, autor: f.autor, tipo: f.tipo, texto: f.texto, inicioMs: f.inicioMs, fimMs: f.fimMs, interrompida: f.interrompida }); return true; },
        async falas(ligacaoId: string) { return falas.filter((f) => f.ligacaoId === ligacaoId).sort((a, b) => a.seq - b.seq).map(({ ligacaoId: _l, ...r }) => r); },
        async ultimasFalas(ligacaoId: string, n: number) { return falas.filter((f) => f.ligacaoId === ligacaoId).sort((a, b) => a.seq - b.seq).slice(-n).map(({ ligacaoId: _l, ...r }) => r); },
        async apagarFalas(ligacaoId: string, em: number) { const antes = falas.length; for (let i = falas.length - 1; i >= 0; i--) if (falas[i]!.ligacaoId === ligacaoId) falas.splice(i, 1); const l = minhas().find((x) => x.id === ligacaoId); if (l) l.transcricaoApagadaEm = em; return antes - falas.length; },
        async avaliar(id: string, nota: "boa" | "ruim") { const l = minhas().find((x) => x.id === id); if (!l || (l.estado !== "encerrada" && l.estado !== "nao_atendida")) return false; l.avaliacao = nota; return true; },
        async consentimento() { return consentimento; },
        async consentir(versao: number, em: number) { consentimento = { versao, em }; },
        async atualizarLinha() { /* a linha vive em mensagens; o teste de unidade não a confere */ },
      };
    })(),
    liberacoesDispensadas: (() => {
      const prefixo = (agenteId: string) => `${escopo.tenantId}:${escopo.pessoaId}:${agenteId}:`;
      return {
        async doAgente(agenteId: string) {
          return Object.fromEntries([...b.liberacoesDispensadas].filter(([k]) => k.startsWith(prefixo(agenteId))).map(([k, em]) => [k.slice(prefixo(agenteId).length), em]));
        },
        async dispensar(agenteId: string, conectorIds: readonly string[], em: number) {
          const ids = [...new Set(conectorIds)];
          for (const id of ids) b.liberacoesDispensadas.set(prefixo(agenteId) + id, Math.max(b.liberacoesDispensadas.get(prefixo(agenteId) + id) ?? -Infinity, em));
          return ids.length;
        },
      };
    })(),
    frentes: (() => {
      const meus = () => b.lotes.filter((l) => l.tenantId === escopo.tenantId && l.ownerId === escopo.pessoaId);
      // NOD-282 (G7): trabalhos.resumo_anterior, guardado ao lado do banco em memória (o Trabalho não carrega a coluna).
      const resumosAnteriores = RESUMOS_ANTERIORES.get(b) ?? new Map<string, ResumoFrente | Record<string, never>>();
      RESUMOS_ANTERIORES.set(b, resumosAnteriores);
      const semDonoLote = ({ tenantId: _t, ownerId: _d, ...l }: LoteDeFrentes & { tenantId: string; ownerId: string }): LoteDeFrentes => ({ ...l });
      return {
        async criarLote(n: NovoLote) {
          const linha = { tenantId: escopo.tenantId, ownerId: escopo.pessoaId, id: randomUUID(), agenteId: n.agenteId, abertoPorTurnoId: n.abertoPorTurnoId, trabalhoId: n.trabalhoId ?? null, avisarACadaUma: n.avisarACadaUma === true, titulo: n.titulo ?? null, retornoTurnoId: null, criadoEm: agora(), devolvidoEm: null, retornoConcluidoEm: null as number | null };
          b.lotes.push(linha);
          return semDonoLote(linha);
        },
        async buscarLote(id: string) { const l = doTenant(b.lotes).find((x) => x.id === id); return l ? semDonoLote(l) : null; },
        async buscarLoteTravado(id: string) { const l = meus().find((x) => x.id === id); return l ? semDonoLote(l) : null; },
        async ligarAoLote(loteId: string, ids: readonly string[]) {
          const lote = doTenant(b.lotes).find((x) => x.id === loteId && x.devolvidoEm === null);
          if (!lote) return 0;
          const alvos = doTenant(b.trabalhos).filter((t) => ids.includes(t.id) && t.ownerId === escopo.pessoaId && t.agenteId === lote.agenteId && t.forma === "frente" && !t.loteId);
          for (const t of alvos) t.loteId = loteId;
          return alvos.length;
        },
        async gravarResumo(trabalhoId: string, resumo: ResumoFrente) {
          const t = doTenant(b.trabalhos).find((x) => x.id === trabalhoId && x.ownerId === escopo.pessoaId && x.forma === "frente");
          if (!t) return false;
          t.resumo = resumo;
          return true;
        },
        async arquivarResumo(trabalhoId: string, opcoes: { manterAtual?: true } = {}) {
          const t = doTenant(b.trabalhos).find((x) => x.id === trabalhoId && x.ownerId === escopo.pessoaId && x.forma === "frente");
          if (!t || (opcoes.manterAtual && resumosAnteriores.has(t.id))) return false;
          resumosAnteriores.set(t.id, t.resumo ?? {});
          if (!opcoes.manterAtual) t.resumo = null;
          return true;
        },
        async consumirResumoAnterior(trabalhoId: string) {
          const t = doTenant(b.trabalhos).find((x) => x.id === trabalhoId && x.ownerId === escopo.pessoaId);
          const anterior = t ? resumosAnteriores.get(t.id) : undefined;
          if (!t || anterior === undefined) return null;
          resumosAnteriores.delete(t.id);
          return { anterior, atual: t.resumo ?? null };
        },
        async frentesDoLote(loteId: string) {
          return doTenant(b.trabalhos).filter((t) => t.loteId === loteId).sort((x, y) => x.criadoEm - y.criadoEm)
            .map((t) => ({ id: t.id, titulo: t.titulo, estado: t.estado, resumo: t.resumo ?? null, terminadoEm: t.terminadoEm, deFora: t.origem === "colega", motivoInterrupcao: null, motivoFalha: null, vencidaTipo: null, quedas: 0 }));
        },
        // ADR-099 (I9): a consulta das frentes caídas se prova no Postgres (tests/integration/frentes-caidas.test.ts).
        async frentesCaidas() {
          return [];
        },
        async lotesAbertosPor(ids: readonly string[]) {
          return doTenant(b.lotes).filter((l) => ids.includes(l.abertoPorTurnoId)).sort((x, y) => x.criadoEm - y.criadoEm).map(semDonoLote);
        },
        async marcarDevolvido(loteId: string, retornoTurnoId: string | null, em: number) {
          const l = meus().find((x) => x.id === loteId && x.devolvidoEm === null);
          if (!l) return null;
          l.devolvidoEm = em;
          l.retornoTurnoId = retornoTurnoId;
          return semDonoLote(l);
        },
        async loteDoRetorno(retornoTurnoId: string) {
          const l = meus().find((x) => x.retornoTurnoId === retornoTurnoId);
          return l ? semDonoLote(l) : null;
        },
        async ehRetornoDeLote(turnoId: string) {
          return meus().some((x) => x.retornoTurnoId === turnoId);
        },
        async trocarRetorno(loteId: string, retornoTurnoId: string) {
          const l = meus().find((x) => x.id === loteId && x.devolvidoEm !== null);
          if (!l) return false;
          l.retornoTurnoId = retornoTurnoId;
          return true;
        },
        // NOD-309: como o repo real — o retorno concluído marca o lote entregue, uma vez só.
        async marcarRetornoConcluido(retornoTurnoId: string, em: number) {
          const l = meus().find((x) => x.retornoTurnoId === retornoTurnoId && x.devolvidoEm !== null && x.retornoConcluidoEm === null);
          if (!l) return false;
          l.retornoConcluidoEm = em;
          return true;
        },
      };
    })(),
    // ADR-099 (I10): o estado do dono se prova no Postgres (tests/integration/estado-do-dono.test.ts); aqui, as frentes
    // vivas e as decisões abertas, o bastante para o estado principal.
    donos: {
      async fatos(agenteIds: readonly string[]) {
        const vivos = doTenant(b.turnos).filter((t) => agenteIds.includes(t.agenteId) && t.estado === "despachando");
        const decisoes = new Map<string, { quantas: number; desde: number }>();
        for (const d of doTenant(b.decisoes).filter((x) => agenteIds.includes(x.agenteId) && (x.estado === "pendente" || x.estado === "reaberta"))) {
          const atual = decisoes.get(d.agenteId);
          const em = Date.parse(d.criadoEm);
          decisoes.set(d.agenteId, { quantas: (atual?.quantas ?? 0) + 1, desde: Math.min(atual?.desde ?? em, em) });
        }
        return {
          vivos: new Map(vivos.filter((t) => !t.trabalhoId).map((t) => [t.agenteId, t.criadoEm])),
          vivosPropria: new Map(vivos.filter((t) => !t.trabalhoId && doTenant(b.conversas).some((c) => c.id === t.conversaId && c.tipo === "propria")).map((t) => [t.agenteId, t.criadoEm])),
          frentesVivas: new Map(vivos.flatMap((t) => (t.trabalhoId ? [[t.trabalhoId, t.machineId ?? null] as const] : []))),
          decisoes,
          comandos: [],
          voltas: [],
          colegas: [],
          fila: [],
        };
      },
    },
    // ADR-099 (I7 revista): os pedidos entre bots na triagem do dono. A trava e as quedas se provam no Postgres
    // (tests/integration/fila-triagem.test.ts, tests/concurrency/pedidos-cruzados.test.ts); aqui, o mínimo para a regra.
    // Sem o ramo do piso da NOD-279: aqui `abertos` sempre se comporta como `semPiso` (o piso se prova no Postgres).
    pedidosDeColega: {
      async travar() {},
      async travarTarefa() {},
      async travarTrabalhosDaCadeia() {},
      async pendentesDaCadeia() {
        return [];
      },
      async abertos(desde: number, filtro: { de?: string; semPiso?: boolean } = {}): Promise<PedidoAberto[]> {
        const ms = doTenant(b.mensagens);
        const fechado = (id: unknown) => typeof id === "string" && doTenant(b.trabalhos).some((t) => t.id === id && ["terminado", "parado", "falhou"].includes(t.estado));
        const handoffs = ms.flatMap((m) => (m.payload?.kind === "handoff" && m.payload.tarefaId && m.criadoEm >= desde && !fechado(m.payload.trabalhoId)
          && !ms.some((r) => r.conversaId === m.conversaId && r.payload?.kind === "peer_ask" && r.payload.tarefaId === (m.payload?.kind === "handoff" ? m.payload.tarefaId : null))
          ? [{ de: m.payload.de, para: m.payload.para, tarefaId: m.payload.tarefaId, criadoEm: m.criadoEm, texto: m.payload.motivo }] : []));
        const frentes = doTenant(b.trabalhos)
          .filter((t) => t.pedidoPorAgenteId && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado))
          .map((t) => ({ de: t.pedidoPorAgenteId as string, para: t.agenteId, tarefaId: null, criadoEm: t.criadoEm, texto: null }));
        return [...handoffs, ...frentes].filter((p) => filtro.de === undefined || p.de === filtro.de);
      },
      async livres(ids: readonly string[], em: number) {
        return ids.filter((id) => !doTenant(b.turnos).some((t) => t.agenteId === id && (t.estado === "despachando" || (t.estado === "pendente" && (t.acordarEm == null || t.acordarEm <= em)))));
      },
      async frentesAbertasDosTurnos(turnoIds: readonly string[]) {
        const lotes = doTenant(b.lotes).filter((l) => turnoIds.includes(l.abertoPorTurnoId) && l.devolvidoEm === null).map((l) => l.id);
        return doTenant(b.trabalhos).filter((t) => t.loteId && lotes.includes(t.loteId) && ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"].includes(t.estado)).length;
      },
      async esperasRodandoDosTurnos(turnoIds: readonly string[]) {
        return doTenant(b.esperas).filter((e) => turnoIds.includes(e.turnoId) && e.estado === "rodando").length;
      },
      async triagensParadas() {
        return [];
      },
      // NOD-377: a regra das esperas de colega roda contra o Postgres (tests/integration/esperas-de-colega.test.ts).
      async esperasDeColega() {
        return [];
      },
    },
    // Chat limpo (PR 1): a Atividade é consulta de faixa e de índice no Postgres (tests/integration/atividade.test.ts).
    atividade: {
      faixaDoDia: soNoPostgres,
      mensagens: soNoPostgres,
      contarMensagens: soNoPostgres,
      negacoesDeConector: soNoPostgres,
      contarNegacoesDeConector: soNoPostgres,
      recuperacoesDeConector: soNoPostgres,
      contarRecuperacoesDeConector: soNoPostgres,
      trabalhos: soNoPostgres,
      contarTrabalhos: soNoPostgres,
    },
    // NOD-54 (0120): os checkpoints são do Postgres (tests/integration/checkpoints.test.ts); aqui, nenhum.
    checkpoints: {
      criar: async () => null,
      doTurno: async () => null,
      desfazendoDoAgente: async () => null,
      pedirDesfazer: async () => ({ ok: false as const, recusa: "nao_encontrado" as const }),
      paraAMaquina: async () => [],
      progresso: async () => null,
      finalizar: async () => null,
    },
    // NOD-445 (0145): os apps do bot são do Postgres (tests/integration/apps-do-bot.test.ts); aqui, nenhum app.
    appsDoBot: {
      travar: async () => {},
      doAgente: async () => [],
      buscar: async () => null,
      criar: soNoPostgres,
      salvar: soNoPostgres,
      remover: soNoPostgres,
      restaurar: soNoPostgres,
      nomeTomado: async () => false,
      removidos: async () => [],
      todosParaOrdem: async () => [],
      removidoPorNome: async () => null,
      apagarRemovidosAntigos: soNoPostgres,
      ordem: async () => null,
      gravarOrdem: soNoPostgres,
    },
    // ADA-241 (0156): padrão por app e lotes são do Postgres (tests/integration/acessos-lote.test.ts); aqui, sem padrão.
    acessos: {
      padrao: async () => "nenhum",
      padroes: async () => [],
      definirPadrao: soNoPostgres,
      marca: async () => null,
      marcas: async () => new Map(),
      marcar: async () => undefined,
      desmarcar: async () => undefined,
      criarLote: soNoPostgres,
      loteDaChave: async () => null,
      loteTravado: async () => null,
      marcarDesfeito: soNoPostgres,
    },
    // ADA-13 (0151): o Canvas é do Postgres (tests/integration/canvas*.test.ts); aqui, desinstalado e sem canvas.
    canvas: {
      instalado: async () => false,
      instalar: soNoPostgres,
      desinstalar: soNoPostgres,
      acessos: async () => [],
      nivelDe: async () => null,
      definirNivel: soNoPostgres,
      doAgente: async () => [],
      buscar: async () => null,
      porIssue: async () => null,
      criar: soNoPostgres,
      subirVersao: soNoPostgres,
      gravarVersao: soNoPostgres,
      versao: async () => null,
      gravarBlobs: soNoPostgres,
      blobs: async () => ({}),
      tamanhoDosBlobs: async () => 0,
      comentarios: async () => [],
      comentario: async () => null,
      comentar: soNoPostgres,
      resolver: soNoPostgres,
      arquivar: soNoPostgres,
      desarquivar: soNoPostgres,
    },
    // NOD-442 (0133): o quadro-agente é do Postgres (tests/integration/quadro*.test.ts); aqui, nenhum quadro.
    projetos: {
      listar: async () => [],
      buscar: async () => null,
      contarAtivos: async () => 0,
      criar: soNoPostgres,
      editar: async () => null,
      arquivar: async () => null,
      travar: async () => {},
    },
    quadros: {
      buscar: async () => null,
      buscarTravado: async () => null,
      doAgente: async () => null,
      vinculadosAo: async () => [],
      doBot: async () => null,
      daTela: async () => null,
      vinculos: async () => [],
      vinculosDoBotTravados: async () => [],
      travarBot: async () => {},
      vincular: soNoPostgres,
      desvincular: async () => null,
      definirPadrao: async () => false,
      transferirDono: soNoPostgres,
      doDonoTravados: async () => [],
      renomear: async () => null,
      contar: async () => 0,
      doTurno: async () => null,
      tarefaDoTurno: async () => null,
      membrosDoTurno: async () => null,
      listar: async () => [],
      criar: soNoPostgres,
      salvar: soNoPostgres,
      apagar: soNoPostgres,
      tarefas: async () => [],
      tarefasSemNumero: async () => [],
      tarefa: async () => null,
      inserirTarefa: soNoPostgres,
      salvarTarefa: soNoPostgres,
      apagarTarefa: soNoPostgres,
      restaurarTarefa: soNoPostgres,
      estadosDosTurnos: async () => new Map(),
      desdeDosTurnos: async () => new Map(),
      cadeiaDoTurno: async () => [],
      inserirLote: soNoPostgres,
      lotesDaTarefa: async () => [],
      primeiroLoteDaTarefa: async () => null,
      lote: async () => null,
      ultimoLote: async () => null,
      mudouDeQuadroDepois: async () => false,
      marcarDesfeito: soNoPostgres,
      // NOD-419 (0140): o histórico de movimentos é do Postgres (tests/integration/freios-quadro.test.ts); aqui some.
      movimentos: async () => [],
      acionamentosNaHora: async () => new Map(),
      ultimosDesfaziveis: async () => [],
      entradasNaEspera: async () => [],
      ultimosMovimentos: async () => [],
      inserirMovimentos: async () => {},
      marcarMovimentosDesfeitos: async () => {},
      desfazerMovimentosDoLote: async () => {},
      paradasVivasDoLote: async () => [],
      // NOD-420: as marcas do aviso são do gatilho da 0141 (tests/integration/quadro.test.ts e tests/concurrency/quadro-avisos-corrida.test.ts).
      marcasDeAviso: async () => new Map(),
      marcarAviso: soNoPostgres,
      travarPrefixos: soNoPostgres,
      prefixosUsados: async () => new Set<string>(),
      definirPrefixo: soNoPostgres,
      prefixoDeOutroQuadro: soNoPostgres,
      numerosReservados: soNoPostgres,
      reservarNumeros: soNoPostgres,
      numerarTarefa: soNoPostgres,
      guardarCodigos: soNoPostgres,
      apagarCodigos: soNoPostgres,
      tarefaDoCodigo: async () => null,
      tarefasDoLinear: async () => [],
      linearIdsQueSairam: async () => new Set<string>(),
      numeroAntigo: async () => null,
      moverTarefa: soNoPostgres,
      registrarHistorico: soNoPostgres,
      // ADA-15 (revisão do PR #696): o histórico é do Postgres (tests/integration/quadro-aprovacao-pela-fala.test.ts).
      falasUsadas: async () => [],
      historico: async () => [],
      buscarVarios: async () => [],
      apagarCodigosEHistorico: soNoPostgres,
      // NOD-443: as pessoas do quadro também são do Postgres (tests/integration/quadro-pessoas.test.ts).
      lotes: async () => [],
      mudarModo: soNoPostgres,
      membros: async () => [],
      ehMembro: async () => false,
      adicionarMembro: soNoPostgres,
      tirarMembro: soNoPostgres,
      participacoes: async () => [],
      comentar: soNoPostgres,
      contarComentarios: async () => 0,
      comentarios: async () => [],
      apagarHistorico: soNoPostgres,
      prsDoQuadro: async () => [],
      prPorUrl: async () => null,
      prMudouDesde: async () => false,
      salvarPr: soNoPostgres,
      definirMergePendente: soNoPostgres,
      definirPrUrlSeVazio: soNoPostgres,
      inserirLinha: soNoPostgres,
      linhasDoQuadro: async () => [],
      avisoGithub: async () => null,
      definirAvisoGithub: soNoPostgres,
    },
    // NOD-417 (0138): os comentários das tarefas são do Postgres (tests/integration/quadro-comentarios.test.ts).
    quadroComentarios: {
      inserir: soNoPostgres, // a recusa (nao_e_comigo) grava o motivo aqui: só no Postgres
      registrarTurnos: async () => {},
      daTarefa: async () => [],
      temDeOutroNoQuadro: async () => false,
      pedidoAbertoNaTarefa: async () => false,
      turnoNaFila: async () => null,
    },
    // NOD-422 (0148): a importação do Linear é do Postgres (tests/integration/importar-linear.test.ts).
    quadroImportacoes: {
      criar: soNoPostgres,
      vencerParadas: async () => 0,
      escritasPelaImportacao: async () => new Map<string, number>(),
      importadas: async () => new Set<string>(),
      maisNovaQue: async () => false,
      comPrDepois: async () => new Set<string>(),
      buscar: async () => null,
      trazendo: async () => null,
      ultima: async () => null,
      doLote: async () => null,
      progresso: soNoPostgres,
      falhar: soNoPostgres,
      aplicar: soNoPostgres,
      desfazer: soNoPostgres,
      assumido: async () => false,
      assumidoEm: async () => null,
      marcarAssumido: async () => false,
      trocarPrefixo: soNoPostgres,
      subirProximo: soNoPostgres,
      proximo: async () => 1,
      inserirComentarios: soNoPostgres,
      apagarComentariosDoLote: soNoPostgres,
      registrarLinhas: soNoPostgres,
      ultimasLinhas: async () => new Map<string, string | null>(),
      apagarLinhasDoLote: soNoPostgres,
      comentadasDepois: soNoPostgres,
    },
    // NOD-418 (0139): os trabalhos e recados das tarefas são do Postgres (tests/integration/quadro-execucoes.test.ts).
    quadroExecucoes: {
      // O quadro em memória registra o gatilho sem guardar: os trabalhos só existem no Postgres.
      inserir: async () => null,
      daTarefa: async () => [],
      atuaisDasTarefas: async () => [],
      tarefasAbertas: async () => [],
      doTurnoRaiz: async () => null,
      tratar: soNoPostgres,
      gravarSaida: soNoPostgres,
      contarReacionamento: soNoPostgres,
      voltasDasCadeias: async () => new Map(),
      reabrir: soNoPostgres,
      agendarNovaTentativa: soNoPostgres,
      desagendarNovaTentativa: async () => 0,
      cancelar: soNoPostgres,
      desfechos: async () => new Map(),
      decisoesAbertasDasCadeias: async () => [],
      pedidosAbertosDasCadeias: async () => [],
      cancelarEsperasDasCadeias: async () => 0,
      inserirRecado: soNoPostgres,
      temRecadoPendente: async () => false,
      recadosPendentes: async () => [],
      recadosDaTela: async () => [],
      entregarRecados: async () => 0,
      levarRecados: soNoPostgres,
      tomarPendentes: async () => [],
      devolverTomados: async () => {},
      cancelarRecados: async () => 0,
    },
    // NOD-437: os times são do Postgres (tests/integration/times.test.ts); aqui não há nenhum.
    times: {
      async listar() {
        return [...timesEmMemoria].sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome)).map(({ chave: _c, ...t }) => ({ ...t }));
      },
      travar: async () => {},
      async criar(p) {
        if (timesEmMemoria.some((t) => t.chave === p.chave)) return null;
        const t = { id: crypto.randomUUID(), nome: p.nome, chave: p.chave, posicao: p.posicao, recolhido: p.recolhido ?? false };
        timesEmMemoria.push(t);
        return { id: t.id, nome: t.nome, posicao: t.posicao, recolhido: t.recolhido };
      },
      async renomear(id, p) {
        const t = timesEmMemoria.find((x) => x.id === id && x.nome !== "");
        if (!t) return null;
        Object.assign(t, { nome: p.nome, chave: p.chave });
        return { id: t.id, nome: t.nome, posicao: t.posicao, recolhido: t.recolhido };
      },
      async recolher(id, recolhido) {
        const t = timesEmMemoria.find((x) => x.id === id);
        if (!t) return null;
        t.recolhido = recolhido;
        return { id: t.id, nome: t.nome, posicao: t.posicao, recolhido: t.recolhido };
      },
      async ordenar(ids) {
        ids.forEach((id, i) => { const t = timesEmMemoria.find((x) => x.id === id); if (t) t.posicao = i; });
      },
      async excluir(id) {
        const i = timesEmMemoria.findIndex((x) => x.id === id && x.nome !== "");
        if (i < 0) return false;
        timesEmMemoria.splice(i, 1);
        return true;
      },
    },
    // NOD-346: o "Sobre mim" é do Postgres (tests/integration/minha-conta.test.ts); aqui fica vazio.
    perfil: {
      buscar: async () => ({ apelido: null, sobreMim: null, temFoto: false }),
      sobreMim: async () => null,
      atualizar: soNoPostgres,
      foto: async () => null,
      definirFoto: soNoPostgres,
    },
  } satisfies Repos;

  return repos;
}

/** NOD-374: o estado do disjuntor de um conector em memória (campos opcionais no contrato viram os padrões). */
function estadoDoConector(c: ConectorGuardado): EstadoDisjuntor {
  return { ultimaFalha: c.ultimaFalha, falhasSeguidas: c.falhasSeguidas ?? 0, timeoutsSeguidos: c.timeoutsSeguidos ?? 0, ultimoTimeoutEm: c.ultimoTimeoutEm ?? null, proximaSondaEm: c.proximaSondaEm ?? null, foraDoArDesde: c.foraDoArDesde ?? null };
}
