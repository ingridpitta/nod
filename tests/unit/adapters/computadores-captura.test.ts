import { randomBytes } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { AcaoComputador, Computador, DriverComputador, ResultadoComputador } from "../../../src/contracts/computador.ts";
import { criarComputadores } from "../../../src/adapters/fundo/computadores.ts";
import { FalhaComputador } from "../../../src/domain/computador.ts";
import type { ResultadoChamada } from "../../../src/use-cases/chamar-ferramenta.ts";
import { MARLON } from "../use-cases/deps-l5.ts";
import { criarCapturas } from "../../../src/services/capturas.ts";

// NOD-200 (guardador da captura do turno), sobre a mesma máquina falsa do teste da NOD-161. Os casos de uso de aprovação e de pedir à pessoa não são o assunto aqui — só o "aguardar".
vi.mock("../../../src/use-cases/pedir-aprovacao.ts", () => ({ pedirAprovacaoComputador: async () => ({ data: { estado: "pendente", decisao_id: "decisao-1" } }) }));
vi.mock("../../../src/use-cases/pedir-a-pessoa.ts", () => ({ pedirAjudaDoComputador: async () => ({ data: { decisao_id: "decisao-2", estado: "pendente" } }) }));

const AGENTE = "agente-1";
let computador: Computador;
let tela: { imagem: string; texto: string };
let quadroValido: string | null;
const enviadas: AcaoComputador[] = [];
/** Resposta pronta para a próxima ação (sem tela, com erro…); null = a tela de sempre. */
let proxima: ResultadoComputador | null;
/** Revisão do PR #599: quando a pessoa assumiu (null = nunca) e quando o turno nasceu. */
let assumiuEm: number | null = null;
let turnoCriadoEm = 0;
/** 4ª revisão: o último freio pode ser o Parar. */
let freioTipo: "assumir" | "parar" = "assumir";
let daPessoa: boolean | undefined = true;
let turnoOrigem = "conversa";
/** 3ª revisão: a mensagem que originou o turno (quem escreveu e quando) decide a retomada, não o turno. */
let msgOrigemId: string | null = "msg-1";
let msgCriadoEm = 2_000;
let msgAutor: { autor_tipo: "pessoa" | "agente"; autor_id: string } = { autor_tipo: "pessoa", autor_id: MARLON.pessoaId };
/** 2ª revisão: o que a retomada grava (controle, registro) e as sessões ao vivo que ela fecha. */
const registrosTipo: string[] = [];
const vivoFechado: string[] = [];

/** A máquina falsa reproduz o runtime: quadro novo a cada tela e clique só com o quadro da última. */
const driver: DriverComputador = {
  ambiente: async () => ({ disponivel: true, motivo: null }),
  estado: async () => ({ disponivel: true, ativo: true, motivo: null }),
  iniciar: async () => {}, parar: async () => {}, ligados: async () => new Set<string>(),
  executar: async (_id, acao): Promise<ResultadoComputador> => {
    enviadas.push(acao);
    if ("quadro" in acao && acao.quadro !== quadroValido) throw new FalhaComputador("tela_alterada");
    if (proxima) { const r = proxima; proxima = null; return r; }
    quadroValido = randomBytes(32).toString("hex");
    return { tela: { quadro: quadroValido, imagem: tela.imagem, largura: 1280, altura: 800, url: "https://example.com", titulo: "Exemplo", texto: tela.texto, abas: [{ titulo: "Exemplo", url: "https://example.com", ativa: true }] } };
  },
};

const deps = {
  escopo: MARLON,
  agora: () => 1_700_000_000_000,
  repos: {
    computadores: {
      obter: async () => computador, travar: async () => computador,
      registrar: async (r: { tipo: string }) => { registrosTipo.push(r.tipo); return { id: "registro-1" }; }, concluir: async () => {},
      ocupar: async (_id: string, operacao: string, ate: number) => { computador = { ...computador, operacaoId: operacao, ocupadoAte: ate }; },
      liberar: async () => { computador = { ...computador, operacaoId: null, ocupadoAte: null }; },
      registrarSucesso: async () => false,
      configurar: async (_id: string, ajuste: { controle?: Computador["controle"] }) => { if (ajuste.controle) computador = { ...computador, controle: ajuste.controle }; },
      buscarAcao: async (id: string) => ({ id, computadorId: computador.id, turnoId: "turno-1", estado: "pendente", argumentosCifrados: JSON.stringify({ tipo: "navegar", url: "https://example.com" }) }),
      gravarResultado: async () => {},
      ultimoFreio: async () => (assumiuEm === null ? null : { tipo: freioTipo, em: assumiuEm }),
    },
    turnos: { buscar: async (id: string) => ({ id, estado: "executando", agenteId: AGENTE, ownerId: MARLON.pessoaId, pararSolicitadoEm: null, motivoInterrupcao: null, criadoEm: turnoCriadoEm, origem: turnoOrigem, mensagemOrigemId: msgOrigemId }) },
    mensagens: { buscar: async (id: string) => (id === msgOrigemId ? { id, autoria: msgAutor, criadoEm: msgCriadoEm } : null) },
    agentes: { buscar: async () => ({ id: AGENTE, modoAprovacao: "manual" }), execucaoBloqueada: async () => false },
    paradas: { ativa: async () => false },
    events: { gravarComOutbox: async () => {} },
  },
};

let agora = 1_700_000_000_000;
const opcoes = { executor: () => "catcher" as const, dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => fn(deps as never), driver, cifrar: (s: string) => s, decifrar: (s: string) => s, mudou: () => {}, agora: () => agora };
const computadores = criarComputadores({ ...opcoes, guardarTelas: true, vivo: { fecharDaTela: (_e: unknown, agenteId: string) => { vivoFechado.push(agenteId); } } });
const semChave = criarComputadores(opcoes);

const plano = (turnoId = "turno-1") => ({
  tenantId: MARLON.tenantId, turnoId, agenteId: AGENTE, conversaId: "conversa-1", expiraEm: Number.MAX_SAFE_INTEGER, confiancaEntrada: "nao_confiavel",
  autoria: { conta_de_execucao: MARLON.pessoaId }, ...(daPessoa === undefined ? {} : { daPessoa }),
  catalogo: { ferramentas: ["computador_observar", "computador_navegar", "computador_interagir", "computador_pedir_ajuda"].map((nome) => ({ nome, origem: "computador" })) },
}) as never;

type Ok = Extract<ResultadoChamada, { ok: true }>;
async function chamar(nome: string, args: Record<string, unknown> = {}, turnoId?: string, c = computadores): Promise<Ok & { json: Record<string, unknown> & { tela: Record<string, unknown> } }> {
  const r = await c.chamar(MARLON, plano(turnoId), nome, args);
  if (!("ok" in r) || !r.ok) throw new Error(`resultado inesperado: ${JSON.stringify(r)}`);
  return { ...r, json: JSON.parse(r.conteudo) };
}

beforeEach(() => {
  computador = { id: "computador-1", agenteId: AGENTE, habilitado: true, controle: "bot", politica: "autonomo", ajuda: null, ajudaDecisaoId: null, ocupadoAte: null, operacaoId: null, criadoEm: 0, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null };
  tela = { imagem: "iVBORw0KGgo=", texto: "Página de exemplo" };
  quadroValido = null;
  enviadas.length = 0;
  proxima = null;
  assumiuEm = null; freioTipo = "assumir"; turnoCriadoEm = 0; daPessoa = true; turnoOrigem = "conversa"; msgOrigemId = "msg-1"; msgCriadoEm = 2_000; msgAutor = { autor_tipo: "pessoa", autor_id: MARLON.pessoaId };
  registrosTipo.length = 0; vivoFechado.length = 0;
  agora += 3_600_000; // turnos de um teste não vazam para o outro
});

const png = (n: number) => Buffer.from(`tela-${n}`).toString("base64");

it("guarda a última tela do turno: a 3ª observação substitui as anteriores", async () => {
  for (const n of [1, 2, 3]) { tela = { ...tela, imagem: png(n) }; await chamar("computador_observar", {}, "t-subst"); }
  expect(computadores.ultimaTela("t-subst")).toBe(png(3));
  expect(computadores.ultimaTela("t-outro")).toBeNull();
});

it("tela repetida que a dedup omite ao modelo continua sendo a captura guardada", async () => {
  tela = { ...tela, imagem: png(7) };
  await chamar("computador_observar", {}, "t-dedup");
  const segunda = await chamar("computador_observar", {}, "t-dedup");
  expect(segunda.json.tela.tela_igual_a_anterior).toBe(true);
  expect(segunda.imagem).toBeUndefined();
  expect(computadores.ultimaTela("t-dedup")).toBe(png(7));
});

it("ultimaTela não esquece; esquecerTurno apaga", async () => {
  await chamar("computador_observar", {}, "t-esquecer");
  expect(computadores.ultimaTela("t-esquecer")).toBe(tela.imagem);
  expect(computadores.ultimaTela("t-esquecer")).toBe(tela.imagem);
  computadores.esquecerTurno("t-esquecer");
  expect(computadores.ultimaTela("t-esquecer")).toBeNull();
});

it("não cresce: no máximo 200 turnos (sai o mais antigo) e nada passa de 2 h", async () => {
  for (let i = 0; i < 201; i++) await chamar("computador_observar", {}, `t-teto-${i}`);
  expect(computadores.ultimaTela("t-teto-0")).toBeNull();
  expect(computadores.ultimaTela("t-teto-1")).not.toBeNull();
  expect(computadores.ultimaTela("t-teto-200")).not.toBeNull();
  agora += 2 * 60 * 60_000 + 1;
  expect(computadores.ultimaTela("t-teto-200")).toBeNull();
});

it("aguardando a pessoa ou resultado com erro não viram captura; a pessoa no controle o bot retoma (29/10)", async () => {
  computador = { ...computador, controle: "aguardando_pessoa" };
  const r = await chamar("computador_observar", {}, "t-aguardando");
  expect(r.json.estado).toBe("aguardando_pessoa");
  expect(computadores.ultimaTela("t-aguardando")).toBeNull();
  // A pessoa pediu algo ao bot depois de assumir: ele retoma o computador em vez de esperar a devolução, e a ação segue.
  computador = { ...computador, controle: "pessoa" };
  assumiuEm = 1_000; turnoCriadoEm = 2_000;
  const retomada = await chamar("computador_observar", {}, "t-pessoa");
  expect(retomada.json.estado).toBeUndefined();
  expect(computador.controle).toBe("bot");
  expect(registrosTipo).toContain("retomar");
  expect(vivoFechado).toEqual([AGENTE]);
  computador = { ...computador, controle: "bot" };
  proxima = { codigoSaida: 1, tela: { quadro: "q", imagem: png(9), largura: 1, altura: 1, url: "", titulo: "", texto: "", abas: [] } } as ResultadoComputador;
  await chamar("computador_observar", {}, "t-erro");
  expect(computadores.ultimaTela("t-erro")).toBeNull();
});

it("a ação executada depois da aprovação nunca grava a captura", async () => {
  await computadores.executarAprovado({ ...MARLON, agenteId: AGENTE, turnoId: "turno-1", acaoId: "acao-1" });
  expect(enviadas.length).toBe(1);
  expect(computadores.ultimaTela("turno-1")).toBeNull();
});

it("sem a chave, o guardador não guarda nada em memória", async () => {
  await chamar("computador_observar", {}, "t-sem-chave", semChave);
  expect(semChave.ultimaTela("t-sem-chave")).toBeNull();
});

it("capturas: desligado é sempre null; ligado lê os bytes sem esquecer (a repetição do assentar acha a mesma) e esquecer apaga", async () => {
  await chamar("computador_observar", {}, "t-desligado");
  expect(criarCapturas({ ligado: false, fonte: computadores }).ler("t-desligado")).toBeNull();
  tela = { ...tela, imagem: png(4) };
  await chamar("computador_observar", {}, "t-ligado");
  const capturas = criarCapturas({ ligado: true, fonte: computadores });
  expect(Buffer.from(capturas.ler("t-ligado") ?? []).toString()).toBe("tela-4");
  expect(Buffer.from(capturas.ler("t-ligado") ?? []).toString()).toBe("tela-4");
  capturas.esquecer("t-ligado");
  expect(capturas.ler("t-ligado")).toBeNull();
  expect(computadores.ultimaTela("t-ligado")).toBeNull();
  expect(criarCapturas({ ligado: true }).ler("t-ligado")).toBeNull();
});

it("revisão do PR #599: com a pessoa no controle, rotina/colega, turno anterior ao assumir ou ajuda aberta seguem esperando", async () => {
  const casos: Array<[string, () => void]> = [
    ["turno que não é da pessoa (rotina, colega, frente)", () => { daPessoa = false; }],
    ["plano sem daPessoa", () => { daPessoa = undefined; }],
    ["turno que já corria quando ela assumiu", () => { turnoCriadoEm = 500; msgCriadoEm = 500; }],
    ["turno repetido depois do assumir (cota, troca de IA, adiar) de uma mensagem anterior", () => { msgCriadoEm = 500; }],
    ["turno da sala nascido da fala de um bot", () => { turnoOrigem = "sala"; msgAutor = { autor_tipo: "agente", autor_id: "outro-bot" }; }],
    ["mensagem de outra pessoa", () => { msgAutor = { autor_tipo: "pessoa", autor_id: "outra-pessoa" }; }],
    ["turno sem mensagem de origem (ligação)", () => { turnoOrigem = "ligacao"; msgOrigemId = null; }],
    ["sem registro do assumir", () => { assumiuEm = null; }],
    ["volta automática (retomada: cota, erro transitório, me-chame-às) criada depois do assumir", () => { turnoOrigem = "retomada"; }],
    ["rotina com daPessoa por engano", () => { turnoOrigem = "rotina"; }],
    ["mensagem anterior ao Parar (assumiu, pediu, o bot retomou, ela parou)", () => { freioTipo = "parar"; assumiuEm = 3_000; }],
    ["pedido de ajuda do bot aberto", () => { computador = { ...computador, ajudaDecisaoId: "decisao-1" }; }],
  ];
  for (const [nome, preparar] of casos) {
    computador = { ...computador, controle: "pessoa", ajudaDecisaoId: null };
    assumiuEm = 1_000; freioTipo = "assumir"; turnoCriadoEm = 2_000; daPessoa = true; turnoOrigem = "conversa";
    msgOrigemId = "msg-1"; msgCriadoEm = 2_000; msgAutor = { autor_tipo: "pessoa", autor_id: MARLON.pessoaId };
    preparar();
    const antes = enviadas.length;
    const r = await chamar("computador_observar", {}, `t-${nome}`);
    expect(r.json.estado, nome).toBe("aguardando_pessoa");
    expect(enviadas.length, nome).toBe(antes);
    expect(computador.controle, nome).toBe("pessoa");
    expect(vivoFechado, nome).toEqual([]);
  }
});

it("4ª revisão: a retomada desfeita por erro na mesma transação não derruba o ao vivo dela", async () => {
  computador = { ...computador, controle: "pessoa", ajudaDecisaoId: null };
  assumiuEm = 1_000;
  const ocupar = deps.repos.computadores.ocupar;
  deps.repos.computadores.ocupar = async () => { throw new Error("banco caiu"); };
  try {
    await expect(chamar("computador_observar", {}, "t-rollback")).rejects.toThrow();
  } finally { deps.repos.computadores.ocupar = ocupar; }
  expect(vivoFechado).toEqual([]);
});
