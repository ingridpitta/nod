import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { criarLineSplitter } from "../../src/adapters/mcp-proxy/line-splitter.ts";
import { interpretar, notificacao, requisicao, type ErroJsonRpc } from "../../src/adapters/mcp-proxy/jsonrpc.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { ResultadoSonda } from "../../src/contracts/servicos.ts";
import { criarTokenTurno, type TokenTurno } from "../../src/services/token-turno.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { lerArtefato, publicarArtefato } from "../../src/use-cases/artefatos.ts";
import { desligar, iniciarTarefa } from "../../src/use-cases/ferramentas-ligacao.ts";
import { anotarEntrevista, concluirEntrevista, proporBot } from "../../src/use-cases/onboarding.ts";
import { abrirFrentes, abrirTask, devolverResumo, mandarParaFrente, mandarParaTask } from "../../src/use-cases/frentes.ts";
import { meChameAs } from "../../src/use-cases/me-chame-as.ts";
import { esperarComando } from "../../src/use-cases/esperar-comando.ts";
import { criarBots } from "../../src/use-cases/criar-bots.ts";
import { responderPedido } from "../../src/use-cases/responder-pedido.ts";
import { pedirCredencial } from "../../src/use-cases/pedir-credencial.ts";
import { abrirConta } from "../../src/use-cases/abrir-conta.ts";
import { gerirBots } from "../../src/use-cases/gerir-bots.ts";
import { registrarRelatoDoNod, verAppsConectados } from "../../src/use-cases/nod.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import type { Deps, Services, UseCasesNod } from "../../src/use-cases/tipos.ts";
import { criarBancoMemoria, type BancoMemoria } from "./repos-memoria.ts";
import { avisarPessoa } from "../../src/use-cases/avisar-pessoa.ts";
import { ajustarBarraLateral } from "../../src/use-cases/ajustar-barra-lateral.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { gerirApps } from "../../src/use-cases/gerir-apps.ts";
import { gerirTimes } from "../../src/use-cases/gerir-times.ts";
import { gerirMaquinas } from "../../src/use-cases/gerir-maquinas.ts";
import { gerirCanvas } from "../../src/use-cases/gerir-canvas.ts";
import { removerComputadorPeloChat } from "../../src/use-cases/remover-computador.ts";
import { gerirAcessos } from "../../src/use-cases/gerir-acessos.ts";
import { naoLidosNoChat } from "../../src/use-cases/nao-lidos-no-chat.ts";
import { buscarConversas, lerConversa } from "../../src/use-cases/buscar-conversas.ts";

/**
 * Helpers da L5 (proxy MCP, plano, conectores, aprovação): plano de teste, services/useCases
 * falsos, `dentro` em memória para as rotas e um proxy REAL spawnado (node src/adapters/mcp-proxy/proxy.ts)
 * falado por JSON-RPC pelo stdio, como o CLI faz (mapa-cli).
 */
export const CAMINHO_PROXY = fileURLToPath(new URL("../../src/adapters/mcp-proxy/proxy.ts", import.meta.url));
export const CAMINHO_MCP_SOMAR = fileURLToPath(new URL("../fixtures/mcp-somar.mjs", import.meta.url));
export const CAMINHO_MCP_EXEMPLO = fileURLToPath(new URL("../../scripts/mcp-exemplo.mjs", import.meta.url));

export function planoDeTeste(sobrescrita: Partial<PlanoTurno> = {}): PlanoTurno {
  const agora = 1_000_000;
  return {
    tenantId: "t",
    turnoId: "t1",
    conversaId: "c1",
    agenteId: "a1",
    localidade: "local",
    machineId: "m1",
    executor: "catcher",
    superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas",
    autoria: { autor_tipo: "agente", autor_id: "a1", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m1", decidido_por: "regra:localidade", regra_versao: 1 },
    confiancaEntrada: "confiavel",
    profundidade: 0,
    catalogo: {
      ferramentas: [
        { nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.lembrar },
        { nome: "exemplo__somar", nomeMcp: "mcp__nod__exemplo__somar", origem: "conector", conectorId: "k1", readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
      ],
      servidores: [{ conectorId: "k1", nome: "exemplo", trust: "untrusted", transporte: "stdio" }],
    },
    promptSistema: "Você é Vera.",
    entrada: { texto: "oi", sessaoCli: null, modelo: "claude-haiku-4-5-20251001" },
    semprePermitir: [],
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8_000 },
    tokenDeTurno: "tok",
    expiraEm: agora + 60_000,
    ...sobrescrita,
  };
}

export type ChamadaConector = { conectorId: string; tool: string; args: Record<string, unknown> };

export type OpcoesServicos = {
  agora?: () => number;
  tokens?: TokenTurno;
  /** Sobrescreve services.conectores (default: falso que registra chamadas e responde "ok:<tool>"). */
  conectores?: Services["conectores"];
  chamadas?: ChamadaConector[];
  sonda?: (conectorId: string, opcoes?: { orcamentoMs?: number }) => ResultadoSonda | Promise<ResultadoSonda>;
};

export function servicosDeTeste(opcoes: OpcoesServicos = {}): Services & { tokenTurno: TokenTurno } {
  const agora = opcoes.agora ?? (() => Date.now());
  const chamadas = opcoes.chamadas ?? [];
  const tokenTurno = opcoes.tokens ?? criarTokenTurno({ agora });
  return {
    relogio: agora,
    tokenTurno,
    planos: { emitir: async () => { throw new Error("planos.emitir: compor com emitirPlanoTurno no teste que precisar"); }, buscar: (turnoId) => tokenTurno.planoDe(turnoId) },
    rotinas: { ativar: async () => { throw new Error("rotinas.ativar é da L7"); } },
    conectores: opcoes.conectores ?? {
      async chamar(conectorId, tool, args) {
        chamadas.push({ conectorId, tool, args });
        return { conteudo: `ok:${tool}`, isError: false };
      },
      async sondar(c, o) {
        return opcoes.sonda ? opcoes.sonda(c.id, o) : { ok: true, ferramentas: [] };
      },
    },
    interruptor: { registrar: () => undefined, interromper: async () => false },
    catcher: { registrar: async () => undefined },
    sala: { encaminhar: async () => ({ ok: true }), passar: async () => ({ ok: true }), pedir: async () => ({ tarefaId: "tarefa-falsa" }) },
    barramento: { publicar: (pessoaId, tipo, dados) => ({ streamId: "s", seq: 1, pessoaId, tipo, dados }) },
  };
}

export function useCasesDeTeste(sobrescrita: Partial<UseCasesNod> = {}): UseCasesNod {
  return {
    lembrar: async () => ({ data: { ok: true, id: "memoria-falsa" } }),
    atualizarPerfil: async () => ({ data: { proposta_id: "proposta-perfil-falsa", rotinas: [] } }),
    pedirAcesso,
    criarRotina: async () => ({ data: { proposta_id: "proposta-rotina-falsa", proxima_execucao: Date.now() + 1000, resumo: "rotina falsa" } }),
    listarRotinasDoAgente: async () => ({ data: { rotinas: [] } }),
    verAgendaPeloAgente: async () => ({ data: { erro: "nao_encontrado" as const } }),
    pausarRotinaPeloAgente: async () => ({ data: { rotina_id: "rotina-falsa", estado: "pausada" as const, ja_estava: false, proxima_execucao: null, retomar_em: null } }),
    reativarRotinaPeloAgente: async () => ({ data: { rotina_id: "rotina-falsa", estado: "ativa" as const, ja_estava: false, proxima_execucao: Date.now() + 1000, retomar_em: null } }),
    atualizarRotinaPeloAgente: async () => ({ data: { proposta_id: "proposta-atualizacao-falsa", resumo: "rotina falsa" } }),
    excluirRotinaPeloAgente: async () => ({ data: { proposta_id: "proposta-exclusao-falsa", resumo: "rotina falsa" } }),
    executarRotinaPeloAgente: async () => ({ data: { proposta_id: "proposta-execucao-falsa", resumo: "rotina falsa" } }),
    pedirAprovacao,
    pedirAPessoa,
    passar: async () => ({ data: { ok: true } }),
    encaminhar: async () => ({ data: { ok: true } }),
    semNovidade: async () => ({ data: { ok: true } }),
    pedirABot: async () => ({ data: { ok: true as const, tarefa_id: "tarefa-falsa", instrucao: "pedido entregue", livres: [] } }),
    verColegas: async () => ({ data: { colegas: [] } }),
    publicarArtefato,
    lerArtefato,
    iniciarTarefa,
    desligar,
    anotarEntrevista,
    concluirEntrevista,
    proporBot,
    abrirTask,
    mandarParaTask,
    meChameAs,
    abrirFrentes,
    mandarParaFrente,
    devolverResumo,
    esperarComando,
    criarBots,
    responderPedido,
    pedirCredencial,
    avisarPessoa,
    ajustarBarraLateral,
    gerirQuadro,
    gerirApps,
    naoLidosNoChat,
    gerirTimes,
    gerirMaquinas,
    gerirCanvas,
    removerComputador: removerComputadorPeloChat,
    gerirAcessos,
    buscarConversas,
    lerConversa,
    abrirConta,
    gerirBots,
    verAppsConectados,
    registrarRelatoDoNod,
    ...sobrescrita,
  };
}

/** Deps sobre repos já montados (um trx do withRollback ou os repos em memória). */
export function depsSobre(repos: Repos, escopo: Escopo, opcoes: { services?: Services; useCases?: UseCasesNod; agora?: () => number; trx?: Tx } = {}): Deps {
  const agora = opcoes.agora ?? (() => Date.now());
  const tx: Transacao = (fn) => fn(opcoes.trx ?? ({} as Tx));
  return { repos, services: opcoes.services ?? servicosDeTeste({ agora }), useCases: opcoes.useCases ?? useCasesDeTeste(), tx, escopo, agora };
}

/** `dentro` das rotas sobre um banco em MEMÓRIA (sem Postgres): cada chamada vê os repos da pessoa do escopo. */
export function dentroEmMemoria(opcoes: { services?: Services; useCases?: UseCasesNod; agora?: () => number } = {}): { dentro: DentroDeTx; banco: BancoMemoria; repos(escopo: Escopo): Repos } {
  const memoria = criarBancoMemoria();
  const services = opcoes.services ?? servicosDeTeste({ agora: opcoes.agora });
  const dentro: DentroDeTx = async (escopo, fn) => fn(depsSobre(memoria.repos(escopo), escopo, { services, useCases: opcoes.useCases, agora: opcoes.agora }));
  return { dentro, banco: memoria.banco, repos: memoria.repos };
}

// ---------------------------------------------------------------------------------------------
// Proxy REAL spawnado, falado pelo stdio.

export type ProxyReal = {
  pedir(metodo: string, params?: unknown, timeoutMs?: number): Promise<{ result?: unknown; error?: ErroJsonRpc }>;
  notificar(metodo: string, params?: unknown): void;
  stderr(): string;
  fechar(): Promise<number | null>;
  processo: ChildProcess;
};

export function spawnProxy(env: { NOD_URL?: string; NOD_TOKEN_TURNO?: string; NOD_PROXY_LOG?: string } = {}): ProxyReal {
  const ambiente: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp" };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) ambiente[k] = v;
  const p = spawn(process.execPath, [CAMINHO_PROXY], { env: ambiente, stdio: ["pipe", "pipe", "pipe"] });
  const splitter = criarLineSplitter();
  const pendentes = new Map<number, (r: { result?: unknown; error?: ErroJsonRpc }) => void>();
  let erroSaida = "";
  let proximoId = 1;
  p.stdout.on("data", (chunk: Buffer) => {
    for (const linha of splitter.alimentar(chunk)) {
      const m = interpretar(linha);
      if (m.tipo !== "resposta" || typeof m.id !== "number") continue;
      const r = pendentes.get(m.id);
      if (!r) continue;
      pendentes.delete(m.id);
      r({ result: m.result, error: m.error });
    }
  });
  p.stderr.on("data", (c: Buffer) => {
    erroSaida += c.toString("utf8");
  });
  return {
    processo: p,
    pedir(metodo, params, timeoutMs = 10_000) {
      const id = proximoId++;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          pendentes.delete(id);
          reject(new Error(`proxy não respondeu ${metodo} em ${timeoutMs}ms; stderr: ${erroSaida}`));
        }, timeoutMs);
        pendentes.set(id, (r) => {
          clearTimeout(t);
          resolve(r);
        });
        p.stdin.write(`${requisicao(id, metodo, params)}\n`);
      });
    },
    notificar(metodo, params) {
      p.stdin.write(`${notificacao(metodo, params)}\n`);
    },
    stderr: () => erroSaida,
    fechar() {
      return new Promise((resolve) => {
        if (p.exitCode !== null) {
          resolve(p.exitCode);
          return;
        }
        const t = setTimeout(() => p.kill("SIGKILL"), 3_000);
        p.once("exit", (code) => {
          clearTimeout(t);
          resolve(code);
        });
        p.stdin.end();
      });
    },
  };
}

/** Sequência que o CLI real manda (mapa-cli): initialize → notifications/initialized. */
export async function inicializarProxy(proxy: ProxyReal): Promise<unknown> {
  const r = await proxy.pedir("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "0" } });
  proxy.notificar("notifications/initialized");
  return r.result;
}
