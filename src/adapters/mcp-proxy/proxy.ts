import { appendFileSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { ehPontoDeEntrada } from "../../shared/entrada.ts";
import type { Negacao } from "../../contracts/negacao.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS, LONGPOLL_APROVACAO_MS, ORCAMENTO_RESULTADO_CHARS } from "../../shared/constantes.ts";
import type { Relogio } from "../../shared/types.ts";
import { ferramentaDoPlano, ferramentasMcp, validadeDoPlano } from "./catalogo.ts";
import { FERRAMENTA_ANEXAR_MIDIA } from "../../contracts/ferramentas-proxy.ts";
import { anexarMidias, respostaAnexar } from "../executor/midia-local.ts";
import { criarClienteNod, ehFalhaTransporte, type ClienteNod } from "../executor/cliente-nod.ts";
import { PROTOCOLO_MCP } from "./cliente-mcp.ts";
import { executarGithubNaMaquina } from "../conectores-locais/github/maquina.ts";
import { continuarResposta, cortarResposta, type Resto } from "./corte.ts";
import { CODIGO, erro, interpretar, resposta, type IdJsonRpc } from "./jsonrpc.ts";
import { criarLineSplitter } from "./line-splitter.ts";
import { envolverNaoConfiavel, neutralizarDelimitadores } from "./moldura.ts";
import { conteudoNegado, negacaoConectorIndisponivel, negacaoFerramenta, negacaoPlanoAusente, type ConteudoMcp } from "./negacao.ts";

/**
 * Proxy MCP do nod (ADR-013, ADR-024): o ÚNICO servidor MCP que o CLI enxerga. JSON-RPC 2.0 sobre
 * stdio, sem SDK. Consome SÓ o plano de turno (GET /api/interno/plano com o Bearer do token):
 * sem token, sem plano, plano expirado ou catálogo vazio → tools/list [] e tools/call negado com
 * classe plano_ausente (fail-closed renderizado, ADR-029). tools/list nunca vem de cache: busca o
 * plano de novo a cada lista. tools/call é serializado (responder N antes de N+1) e despacha ao
 * servidor, que decide (parada, catálogo, concessão, trilha); aqui só o que é LOCAL por desenho:
 * nome fora do plano (terminal, avisa o servidor), servidor fora (conector_indisponivel com
 * `desde`), corte ao orçamento e moldura do conteúdo não confiável (ADR-026).
 *
 * NUNCA escreve em stdout fora do JSON-RPC (o CLI lê o stdout) nem usa src/obs/log.ts (console);
 * diagnóstico opcional vai para o arquivo NOD_PROXY_LOG (o CLI engole stderr, mapa-cli).
 */
export type OpcoesProxy = {
  cliente: ClienteNod;
  agora: Relogio;
  /** definido em 2026-09-16: uma fatia de LONGPOLL_APROVACAO_MS; sem decisão o modelo é mandado encerrar o turno. */
  longpollMs?: number;
  versao?: string;
  diagnostico?: (evento: string, campos?: Record<string, string | number | boolean | null>) => void;
  /** ADR-048: ambiente desta máquina para o gh (default process.env) e quem executa (injetável no teste). */
  ambiente?: Readonly<Record<string, string | undefined>>;
  executarNaMaquina?: typeof executarGithubNaMaquina;
  /** Fatias de espera por uma aprovação no mesmo turno (default ESPERA_APROVACAO_NO_TURNO_MS / LONGPOLL_APROVACAO_MS). */
  fatiasAprovacao?: number;
  /** NOD-323: o HOME onde fica `~/nod` (default o do processo). Injetável no teste. */
  home?: string;
};

export type Proxy = {
  /** Trata UMA linha JSON-RPC e devolve a resposta serializada (null para notificação). Exposto para teste. */
  tratarLinha(linha: string): Promise<string | null>;
  /** Liga stdin → tratarLinha → stdout, serializado. */
  ligar(entrada: Readable, saida: Writable): Promise<void>;
  estado(): { plano: PlanoTurno | null; semPlanoDesde: number | null; servidorForaDesde: number | null };
};

const INSTRUCAO_PENDENTE = "encerre o turno; a decisão retoma depois" as const;
/** Restos guardados por turno para `ler_mais`; o mais antigo sai quando passa disto. */
const MAX_RESTOS = 20;

function texto(t: string): ConteudoMcp {
  return { content: [{ type: "text", text: t }] };
}

export function criarProxy(opcoes: OpcoesProxy): Proxy {
  const { cliente, agora } = opcoes;
  const longpoll = opcoes.longpollMs ?? LONGPOLL_APROVACAO_MS;
  const diag = opcoes.diagnostico ?? (() => undefined);
  let plano: PlanoTurno | null = null;
  /**
   * definido em 2026-10-12 (NOD-214): o último plano recebido, guardado quando o GET /plano falha por SERVIDOR FORA (o
   * deploy reinicia o servidor no meio do turno). Não serve a lista — tools/list continua fail-closed —, só muda a
   * resposta do tools/call: em vez de plano_ausente (terminal), "indisponível, tente de novo" (transitória), e a chamada
   * seguinte busca o plano outra vez. Plano ausente de verdade (404/401) segue negando como antes.
   */
  let ultimoPlano: PlanoTurno | null = null;
  let semPlanoDesde: number | null = null;
  let servidorForaDesde: number | null = null;
  let fila: Promise<unknown> = Promise.resolve();
  // definido em 2026-09-28: o resto das respostas cortadas neste turno, por ref, para `ler_mais` — o
  // equivalente do arquivo em que o terminal salva resposta grande. Vive com o processo (um por turno).
  const restos = new Map<string, { resto: Resto; origem: string; naoConfiavel: boolean; computador: boolean }>();
  let proximoRef = 1;

  /** Corta ao orçamento e, se sobrou, guarda o resto com a origem e a confiança do conteúdo. */
  function cortarGuardando(conteudo: string, orcamento: number, guardar: { origem: string; naoConfiavel: boolean; computador: boolean }): string {
    const ref = `r${proximoRef}`;
    const corte = cortarResposta(conteudo, orcamento, ref);
    if (corte.resto) {
      proximoRef += 1;
      restos.set(ref, { resto: corte.resto, ...guardar });
      // Teto de memória por turno: o resto mais antigo sai primeiro.
      if (restos.size > MAX_RESTOS) restos.delete(restos.keys().next().value ?? "");
    }
    return corte.texto;
  }

  async function buscarPlano(): Promise<void> {
    const r = await cliente.plano();
    if (r.ok) {
      plano = r.plano;
      semPlanoDesde = null;
      servidorForaDesde = null;
      diag("plano_recebido", { turno: r.plano.turnoId, ferramentas: r.plano.catalogo.ferramentas.length });
      return;
    }
    if (r.motivo === "servidor_fora") {
      ultimoPlano = plano ?? ultimoPlano;
      servidorForaDesde ??= agora();
    } else ultimoPlano = null;
    plano = null;
    semPlanoDesde ??= agora();
    diag("plano_ausente", { motivo: r.motivo, status: r.status });
  }

  function negarPlano(id: IdJsonRpc, motivo: "plano_ausente" | "plano_expirado" | "catalogo_vazio"): string {
    const n: Negacao = negacaoPlanoAusente(motivo, semPlanoDesde ?? agora());
    return erro(id, CODIGO.negacaoNod, `nenhum trabalho começa: ${motivo}`, n);
  }

  /**
   * `ler_mais` (2026-09-28): atendida AQUI, sem ida ao servidor — o resto é do que este proxy já cortou e
   * já passou pela decisão do servidor na chamada original. Mesma moldura, mesmo corte.
   */
  function lerMais(argumentos: Record<string, unknown>, orcamento: number): ConteudoMcp {
    const ref = typeof argumentos.ref === "string" ? argumentos.ref : "";
    const guardado = restos.get(ref);
    if (!guardado) {
      diag("ler_mais_sem_resto", { ref });
      return { ...texto(`Não há resto guardado com ref="${ref}". O resto só existe no turno em que a resposta foi cortada; refaça a chamada original.`), isError: true };
    }
    const parte = continuarResposta(guardado.resto, orcamento, ref);
    if (parte.resto) restos.set(ref, { ...guardado, resto: parte.resto });
    else restos.delete(ref);
    diag("ler_mais", { ref, fim: parte.resto === null });
    const conteudo = neutralizarDelimitadores(parte.texto);
    return texto(guardado.naoConfiavel ? envolverNaoConfiavel(conteudo, guardado.origem, guardado.computador) : conteudo);
  }

  /** A decisão e, por item, o que a ação aprovada no computador devolveu: cortado e moldurado como não confiável. */
  function decididaComResultados(itens: readonly { idx: number; desfecho: unknown; resultado?: string }[], orcamento: number): ConteudoMcp {
    const partes = [JSON.stringify({ estado: "decidida", itens: itens.map(({ resultado: _resultado, ...i }) => i) })];
    for (const i of itens) {
      if (!i.resultado) continue;
      const conteudo = neutralizarDelimitadores(cortarGuardando(i.resultado, orcamento, { origem: "computador", naoConfiavel: true, computador: true }));
      partes.push(envolverNaoConfiavel(`Resultado do item ${i.idx + 1}:\n${conteudo}`, "computador", true));
    }
    return texto(partes.join("\n\n"));
  }

  async function toolsCall(id: IdJsonRpc, params: unknown): Promise<string> {
    const p = (typeof params === "object" && params !== null ? params : {}) as { name?: unknown; arguments?: unknown };
    const nome = typeof p.name === "string" ? p.name : "";
    const argumentos = (typeof p.arguments === "object" && p.arguments !== null ? p.arguments : {}) as Record<string, unknown>;
    // NOD-214: o plano sumiu porque o servidor estava fora (deploy): tenta de novo antes de negar.
    if (!plano && ultimoPlano && servidorForaDesde !== null) await buscarPlano();
    const v = validadeDoPlano(plano, agora());
    if (!v.ok) {
      if (v.motivo === "plano_ausente" && ultimoPlano && servidorForaDesde !== null && validadeDoPlano(ultimoPlano, agora()).ok) {
        const n = negacaoConectorIndisponivel(nome || "(sem nome)", servidorForaDesde, "conector_indisponivel");
        diag("plano_indisponivel", { nome });
        return resposta(id, conteudoNegado(n, agora()));
      }
      if (v.motivo === "plano_expirado") semPlanoDesde ??= agora();
      return negarPlano(id, v.motivo);
    }
    const ferramenta = ferramentaDoPlano(v.plano, nome);
    if (!ferramenta) {
      // Decidido LOCALMENTE contra o plano (ADR-013): terminal; o servidor grava a trilha e pede interrupção.
      const n = negacaoFerramenta(nome || "(sem nome)", "fora_do_catalogo", agora());
      diag("negacao_local", { nome, motivo: n.motivo });
      await cliente.negacao(n).catch(() => undefined);
      return resposta(id, conteudoNegado(n, agora()));
    }
    const orcamento = v.plano.politicaExecucao.orcamentoResultadoChars || ORCAMENTO_RESULTADO_CHARS;
    if (ferramenta.origem === "proxy" && ferramenta.nome === FERRAMENTA_ANEXAR_MIDIA.nome) {
      // NOD-323 (ADR-126): o arquivo é lido AQUI, na máquina, contra a pasta do bot do plano; o servidor confere de novo.
      if (!v.plano.pastaDoBot) return resposta(id, { content: [{ type: "text", text: "anexar_midia: este turno não tem pasta" }], isError: true });
      const r = respostaAnexar(await anexarMidias(argumentos.caminhos, { cliente, pastaDoBot: v.plano.pastaDoBot, ...(opcoes.home ? { home: opcoes.home } : {}) }));
      diag("anexar_midia", { erro: r.isError });
      return resposta(id, { content: [{ type: "text", text: r.texto }], ...(r.isError ? { isError: true } : {}) });
    }
    if (ferramenta.origem === "proxy") return resposta(id, lerMais(argumentos, orcamento));
    const r = await cliente.ferramenta(nome, argumentos);
    if (ehFalhaTransporte(r)) {
      servidorForaDesde ??= agora();
      const n = negacaoConectorIndisponivel(nome, servidorForaDesde, r.transporte === "timeout" ? "timeout_transporte" : "conector_indisponivel");
      diag("servidor_fora", { nome, transporte: r.transporte, status: r.status });
      return resposta(id, conteudoNegado(n, agora()));
    }
    servidorForaDesde = null;
    if ("aguardar" in r) {
      // definido em 2026-09-28 (0032): espera no PRÓPRIO turno, em fatias, até ESPERA_APROVACAO_NO_TURNO_MS. A
      // pessoa aprova e o bot segue com o resultado na mão; antes a espera era uma fatia de 20 s e cada ação
      // no computador virava um turno novo. Passado o prazo (ou o servidor fora), o turno encerra e a
      // decisão vira UMA retomada no servidor.
      const fatias = opcoes.fatiasAprovacao ?? Math.ceil(ESPERA_APROVACAO_NO_TURNO_MS / LONGPOLL_APROVACAO_MS);
      for (let i = 0; i < fatias; i++) {
        const a = await cliente.aguardar(r.aguardar, longpoll);
        if (ehFalhaTransporte(a)) break;
        if (a.estado === "decidida") return resposta(id, decididaComResultados(a.itens, orcamento));
        // ADR-083 (#194): sob pressão de memória o servidor solta a espera; o turno encerra e a decisão retoma depois.
        if (a.soltar === true) break;
      }
      return resposta(id, texto(JSON.stringify({ estado: "pendente", decisao_id: r.aguardar, instrucao: INSTRUCAO_PENDENTE })));
    }
    if ("executarLocal" in r) {
      // ADR-048: o servidor já decidiu tudo; aqui só o EFEITO, pelo gh desta máquina. O plano puxado
      // tem de concordar (ferramenta marcada "maquina" e a mesma capacidade) — senão nada roda.
      const capacidade = r.executarLocal.capacidade;
      if (ferramenta.execucao !== "maquina" || !ferramenta.nome.endsWith(`__${capacidade}`)) {
        const n = negacaoFerramenta(nome, "fora_do_catalogo", agora());
        await cliente.negacao(n).catch(() => undefined);
        return resposta(id, conteudoNegado(n, agora()));
      }
      // O corte é daqui (com resto para ler_mais), não da máquina: ela devolve tudo.
      const local = await (opcoes.executarNaMaquina ?? executarGithubNaMaquina)({ capacidade, argumentos: r.executarLocal.argumentos, ambiente: opcoes.ambiente ?? process.env, orcamentoChars: Number.POSITIVE_INFINITY });
      diag("execucao_local", { nome, codigo: local.codigo });
      await cliente.execucaoLocal?.(nome, local.codigo).catch(() => undefined);
      const origem = v.plano.catalogo.servidores.find((s) => s.conectorId === ferramenta.conectorId)?.nome ?? nome;
      const texto = envolverNaoConfiavel(neutralizarDelimitadores(cortarGuardando(local.conteudo, orcamento, { origem, naoConfiavel: true, computador: false })), origem, false);
      return resposta(id, { content: [{ type: "text", text: texto }], ...(local.isError ? { isError: true } : {}) });
    }
    if (!r.ok) {
      diag("negacao_servidor", { nome, motivo: r.negacao.motivo, terminal: r.negacao.terminal });
      return resposta(id, conteudoNegado(r.negacao, agora()));
    }
    const naoConfiavel = r.confianca === "nao_confiavel";
    const origem = ferramenta.origem === "conector" ? (v.plano.catalogo.servidores.find((s) => s.conectorId === ferramenta.conectorId)?.nome ?? nome) : nome;
    let conteudo = neutralizarDelimitadores(cortarGuardando(r.conteudo, orcamento, { origem, naoConfiavel, computador: ferramenta.origem === "computador" }));
    if (naoConfiavel) conteudo = envolverNaoConfiavel(conteudo, origem, ferramenta.origem === "computador");
    return resposta(id, { content: [{ type: "text", text: conteudo }, ...(r.imagem ? [{ type: "image", ...r.imagem }] : []), ...(r.audio ? [{ type: "audio", ...r.audio }] : [])], ...(r.isError ? { isError: true } : {}) });
  }

  async function tratarDentro(linha: string): Promise<string | null> {
    const m = interpretar(linha);
    if (m.tipo === "invalida") {
      return m.motivo === "json_invalido" ? erro(null, CODIGO.parseError, "JSON inválido") : erro(m.id, CODIGO.invalidRequest, "requisição inválida");
    }
    if (m.tipo === "resposta") return null;
    if (m.tipo === "notificacao") return null;
    const { id, metodo, params } = m;
    switch (metodo) {
      case "initialize": {
        await buscarPlano();
        const pv = (typeof params === "object" && params !== null ? (params as { protocolVersion?: unknown }).protocolVersion : undefined);
        return resposta(id, {
          protocolVersion: typeof pv === "string" ? pv : PROTOCOLO_MCP,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "nod", version: opcoes.versao ?? "0.1.0" },
        });
      }
      case "ping":
        return resposta(id, {});
      case "tools/list": {
        await buscarPlano();
        const v = validadeDoPlano(plano, agora());
        return resposta(id, { tools: v.ok ? ferramentasMcp(v.plano) : [] });
      }
      case "tools/call":
        return toolsCall(id, params);
      default:
        return erro(id, CODIGO.methodNotFound, `método não suportado: ${metodo}`);
    }
  }

  function tratarLinha(linha: string): Promise<string | null> {
    const r = fila.then(() => tratarDentro(linha));
    fila = r.catch(() => undefined);
    return r;
  }

  return {
    tratarLinha,
    estado: () => ({ plano, semPlanoDesde, servidorForaDesde }),
    ligar(entrada, saida) {
      const splitter = criarLineSplitter();
      const escrever = (l: string | null) => {
        if (l !== null) saida.write(`${l}\n`);
      };
      const tratar = (linha: string) => tratarLinha(linha).then(escrever, (e: unknown) => escrever(erro(null, CODIGO.internalError, e instanceof Error ? e.name : "falha interna")));
      return new Promise<void>((resolve) => {
        entrada.on("data", (chunk: Buffer | string) => {
          for (const linha of splitter.alimentar(chunk)) void tratar(linha);
        });
        entrada.on("end", () => {
          for (const linha of splitter.encerrar()) void tratar(linha);
          void fila.then(() => resolve());
        });
      });
    },
  };
}

/** Diagnóstico em ARQUIVO (NOD_PROXY_LOG): nunca stdout (é o canal JSON-RPC) nem console. */
function diagnosticoEmArquivo(caminho: string | undefined): OpcoesProxy["diagnostico"] {
  if (!caminho) return () => undefined;
  return (evento, campos = {}) => {
    try {
      appendFileSync(caminho, `${JSON.stringify({ ts: new Date().toISOString(), evento, ...campos })}\n`);
    } catch {
      // diagnóstico é best-effort
    }
  };
}

export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const url = env.NOD_URL ?? "";
  const token = env.NOD_TOKEN_TURNO ?? "";
  const semToken: ClienteNod = {
    plano: async () => ({ ok: false, motivo: "plano_ausente", status: null }),
    ferramenta: async () => ({ transporte: "falha_tecnica", status: null }),
    aguardar: async () => ({ transporte: "falha_tecnica", status: null }),
    negacao: async () => undefined,
    chamarFerramenta: async () => ({ conteudo: "plano_ausente", isError: true }),
  };
  const cliente = url && token ? criarClienteNod({ url, token }) : semToken;
  const proxy = criarProxy({ cliente, agora: () => Date.now(), diagnostico: diagnosticoEmArquivo(env.NOD_PROXY_LOG) });
  await proxy.ligar(process.stdin, process.stdout);
}

if (ehPontoDeEntrada(import.meta.url)) {
  void main().then(() => process.exit(0));
}
