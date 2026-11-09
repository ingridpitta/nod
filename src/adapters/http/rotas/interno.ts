import type { Computadores } from "../../fundo/computadores.ts";
import type { Workspaces } from "../../fundo/workspaces.ts";
import type { ClasseNegacao } from "../../../contracts/negacao.ts";
import { MOTIVOS_NEGACAO, type MotivoNegacao } from "../../../contracts/motivos.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { esperaEmLaco, motivoDaEsperaNegada } from "../../../domain/espera-em-laco.ts";
import { REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, REGRA_REVISOR, VERSAO_MODO_AUTOMATICO, VERSAO_MODO_AUTOMATICO_COM_REVISOR, VERSAO_MODO_TOTAL, VERSAO_REGRA_REVISOR } from "../../../domain/modo-aprovacao.ts";
import { NATIVA_MCP_DA_PESSOA, NATIVAS_QUE_CONTAMINAM } from "../../../domain/nativas.ts";
import { createHash, randomUUID } from "node:crypto";
import { contextoAtual, executarComContexto } from "../../../obs/contexto.ts";
import { log } from "../../../obs/log.ts";
import type { TokenTurno } from "../../../services/token-turno.ts";
import { LONGPOLL_APROVACAO_MS } from "../../../shared/constantes.ts";
import type { Relogio } from "../../../shared/types.ts";
import type { NivelPressao } from "../../../contracts/trabalho.ts";
import { soltarPorMemoria } from "../../../domain/trabalho.ts";
import { fecharPorMemoria } from "../../../use-cases/trabalhos.ts";
import { autorizarComando } from "../../../use-cases/autorizar-comando.ts";
import { ehUuid } from "../../../use-cases/apoio-l7.ts";
import type { PedidoNaFila } from "../../../use-cases/revisar-acao.ts";
import { chamarFerramentaFase1, concluirChamada, entradaDaLimpeza, executarEfeito, precisaLimparAposSucesso, REGRA_CHAMADA, registrarExecucaoLocal, respostaSemFase2, VERSAO_REGRA_CHAMADA, type SaidaFase1Chamada } from "../../../use-cases/chamar-ferramenta.ts";
import { classificarFalhaDaChamada, limparFalhaAposSucesso } from "../../../use-cases/disjuntor-conector.ts";
import { nomeParaTrilha, REGRA_PARADA_ALCADA, registrarNegacao, VERSAO_REGRA_PARADA_ALCADA } from "../../../use-cases/registrar-negacao.ts";
import { REGRA_CLIQUE, REGRA_LIBERADO_NA_TAREFA, VERSAO_LIBERADO_NA_TAREFA, VERSAO_REGRA_CLIQUE } from "../../../domain/decisoes.ts";
import { assentarComNovaTentativa, TENTATIVAS_FASE2 } from "../../../use-cases/liberar-no-app.ts";
import type { Rota } from "../roteador.ts";
import { TAMANHO_MAX_MIDIA, TETO_CABECALHO_MIDIA, type CabecalhoMidia } from "../../../contracts/anexo.ts";
import { receberMidiaDoBot, registrarRecusasDeMidia } from "../../../use-cases/midia-do-bot.ts";
import { bytes, lerBruto } from "../util.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasInternas = {
  workspaces?: Workspaces;
  computadores?: Computadores;
  dentro: DentroDeTx;
  /**
   * revisto em 2026-10-12 (NOD-214): o plano sai de `planoOuRecompor` — o do turno adotado depois de um reinício do
   * servidor é recomposto na primeira chamada, com o token que a máquina já tem.
   */
  tokens: Pick<TokenTurno, "planoOuRecompor">;
  agora: Relogio;
  /** definido em 2026-09-16: teto do long-poll (LONGPOLL_APROVACAO_MS); a consulta é curta e a conexão do banco é liberada entre as fatias. */
  longpollMs?: number;
  /** Intervalo entre consultas (1 s + jitter até 250 ms, definido em 2026-09-16); injetável no teste. */
  intervaloMs?: number;
  dormir?: (ms: number) => Promise<void>;
  /** ADR-083 (#194): a pressão de memória dos Macs da pessoa; amarela ou pior solta a espera longa de uma task. */
  pressao?: (pessoaId: string) => NivelPressao | null;
  /** ADR-115: onde o pedido de revisão entra DEPOIS do commit da fase 1 (o executor do revisor, adapters/revisor). */
  revisor?: { enfileirar(p: PedidoNaFila): void };
  /** NOD-323: ociosidade do corpo do upload de mídia (teste encurta). */
  ociosoMidiaMs?: number;
  /** NOD-323 (revisão 3): quanto o upload espera a vaga antes do 503, e o prazo total do corpo (teste encurta). */
  esperaVagaMidiaMs?: number;
  prazoCorpoMidiaMs?: (bytes: number) => number;
  /**
   * definido em 2026-10-26 (NOD-374): a sonda de confirmação depois de uma chamada que falhou por timeout ou queda
   * (adapters/fundo/disjuntor-conectores.ts). Roda depois da resposta, fora de tx; ausente = sem confirmação (o laço re-sonda).
   */
  disjuntor?: { confirmar(escopo: { tenantId: string; pessoaId: string }, conectorId: string): void; mudou?(escopo: { tenantId: string; pessoaId: string }): void };
};

/** NOD-323: no máximo 2 uploads de mídia ao mesmo tempo no processo (50 MiB cada na memória); o terceiro é 503 e o proxy tenta de novo. */
export const UPLOADS_DE_MIDIA_SIMULTANEOS = 2;
/** NOD-323 (revisão 2, M2): o corpo parado por mais que isso solta a vaga (o socket é derrubado). */
export const OCIOSO_UPLOAD_MIDIA_MS = 30_000;
/**
 * NOD-323 (revisão 3 do #507, M3): a segunda mídia do mesmo turno (o proxy despacha as chamadas em paralelo) ou a que
 * chega com as vagas cheias espera a vez em vez de cair no 503 na hora; e o corpo tem prazo total — 1 byte a cada 29 s
 * passa da ociosidade, não da taxa mínima (60 s + 128 KiB/s: 50 MiB em até ~7 min).
 */
export const ESPERA_VAGA_MIDIA_MS = 20_000;
export const prazoCorpoMidiaPadrao = (bytes: number): number => 60_000 + Math.ceil(bytes / (128 * 1024)) * 1_000;

const STATUS_DA_RECUSA = { turno_encerrado: 409, tipo_nao_suportado: 415, limite_por_turno: 429, vazio: 400, entrada_invalida: 400 } as const;

/** O cabeçalho `x-nod-midia` (JSON url-encoded). Tudo que não for do formato é null (400). */
export function lerCabecalhoMidia(v: unknown): CabecalhoMidia | null {
  if (typeof v !== "string") return null;
  let c: unknown;
  try {
    c = JSON.parse(decodeURIComponent(v));
  } catch {
    return null;
  }
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const num = (k: string) => o[k] === undefined || (typeof o[k] === "number" && Number.isSafeInteger(o[k]));
  if (typeof o.nome !== "string" || o.nome.length === 0 || o.nome.length > 255) return null;
  if (typeof o.caminhoRelativo !== "string" || typeof o.sha256 !== "string" || typeof o.mime !== "string") return null;
  if (!num("largura") || !num("altura") || !num("duracaoMs") || !num("tamanhoReal")) return null;
  return {
    nome: o.nome,
    caminhoRelativo: o.caminhoRelativo,
    sha256: o.sha256.toLowerCase(),
    mime: o.mime,
    ...(o.largura !== undefined ? { largura: o.largura as number } : {}),
    ...(o.altura !== undefined ? { altura: o.altura as number } : {}),
    ...(o.duracaoMs !== undefined ? { duracaoMs: o.duracaoMs as number } : {}),
    ...(o.tamanhoReal !== undefined ? { tamanhoReal: o.tamanhoReal as number } : {}),
  };
}

const CLASSES: readonly ClasseNegacao[] = ["ferramenta_negada", "conector_indisponivel", "plano_ausente"];

const dormirPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** NOD-263: movidas para use-cases/liberar-no-app.ts (PR 5 dos modos de aprovação); reexportadas para quem já importa daqui. */
export { assentarComNovaTentativa, TENTATIVAS_FASE2 };

/** As nativas em que o hook manda o arquivo de credencial ao servidor (PR 6 dos modos de aprovação, `decidirNativa`). */
const NATIVAS_COM_CREDENCIAL: readonly string[] = ["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "apply_patch", "view_image", NATIVA_MCP_DA_PESSOA];

/**
 * Rotas INTERNAS (/api/interno/…), autenticadas pelo token de turno no roteador da L1: a
 * identidade (turnoId, agenteId, tenant, pessoa) chega em ctx.params/ctx.escopo, nunca do corpo
 * (ADR-024). GET plano devolve o plano guardado junto do token; POST ferramentas/:nome é o
 * tools/call despachado; GET decisoes/:id/aguardar é long-poll de consultas CURTAS (nunca segura
 * conexão do banco); POST negacoes registra uma negação decidida localmente pelo proxy.
 */
export function rotasInternas(deps: DepsRotasInternas): Rota[] {
  let uploadsEmCurso = 0;
  // Um upload por turno de cada vez: um turno sozinho não segura as duas vagas do processo.
  const turnosSubindo = new Set<string>();
  const ociosoMidiaMs = deps.ociosoMidiaMs ?? OCIOSO_UPLOAD_MIDIA_MS;
  const esperaVagaMidiaMs = deps.esperaVagaMidiaMs ?? ESPERA_VAGA_MIDIA_MS;
  const prazoCorpoMidia = deps.prazoCorpoMidiaMs ?? prazoCorpoMidiaPadrao;
  const vagaLivre = (turnoId: string) => uploadsEmCurso < UPLOADS_DE_MIDIA_SIMULTANEOS && !turnosSubindo.has(turnoId);
  const dormir = deps.dormir ?? dormirPadrao;
  const teto = deps.longpollMs ?? LONGPOLL_APROVACAO_MS;
  const intervalo = deps.intervaloMs ?? 1_000;
  return [
    {
      metodo: "GET",
      padrao: /^\/plano$/,
      interno: true,
      async handler(ctx) {
        const plano = await deps.tokens.planoOuRecompor(ctx.params.turnoId ?? "");
        if (!plano) {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "plano de turno ausente" });
          return;
        }
        ctx.json(200, plano);
      },
    },
    {
      // ADR-046: o driver baixa os bytes de um anexo DESTE turno. O plano em memória do token diz quais
      // ids o turno pode ler; qualquer outro é 404, mesmo sendo da mesma pessoa.
      metodo: "GET",
      padrao: /^\/anexos\/(?<aid>[^/]+)$/,
      interno: true,
      async handler(ctx) {
        const plano = await deps.tokens.planoOuRecompor(ctx.params.turnoId ?? "");
        const aid = ctx.params.aid ?? "";
        if (!plano?.entrada.anexos?.some((a) => a.id === aid)) {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "anexo fora do turno" });
          return;
        }
        const r = await deps.dentro(ctx.escopo, (d) => d.repos.anexos.conteudo(aid));
        if (!r) {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "anexo ausente" });
          return;
        }
        bytes(ctx.res, r.meta.mime, r.meta.nome, r.bytes);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/ferramentas\/(?<nome>[^/]+)$/,
      interno: true,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { argumentos?: unknown };
        const turnoId = ctx.params.turnoId ?? "";
        const plano = await deps.tokens.planoOuRecompor(turnoId);
        // definido em 2026-09-24 (revisão da ADR-047): computador e pasta também deixam a chamada na trilha —
        // o que eles devolvem é conteúdo de fora, e a trilha é o registro do que o turno tocou (E8.4).
        if (plano && ((ctx.params.nome?.startsWith("workspace_") && deps.workspaces) || (ctx.params.nome?.startsWith("computador_") && deps.computadores))) {
          await deps.dentro(ctx.escopo, (d) => d.repos.trilha.registrar({ agenteId: plano.agenteId, turnoId, ferramenta: nomeParaTrilha(ctx.params.nome ?? ""), kind: "tool_call", regra: REGRA_CHAMADA, regraVersao: VERSAO_REGRA_CHAMADA }));
        }
        if (ctx.params.nome?.startsWith("workspace_") && plano && deps.workspaces) {
          ctx.json(200, await deps.workspaces.chamar(ctx.escopo, plano, ctx.params.nome, corpo?.argumentos ?? {}));
          return;
        }
        if (ctx.params.nome?.startsWith("computador_") && plano && deps.computadores) {
          ctx.json(200, await deps.computadores.chamar(ctx.escopo, plano, ctx.params.nome, corpo?.argumentos ?? {}));
          return;
        }
        // NOD-263 (emenda ao ADR-001): três tempos. FASE 1 numa tx curta (portões, trilha, decisão do lote); o EFEITO fora de
        // tx, sob o contexto de log da fase 1; a FASE 2 numa tx nova, só quando há o que gravar (o app falhou, ou o lote).
        const contexto: { correlationId?: string; services?: Parameters<typeof executarEfeito>[0] } = {};
        const fase1: SaidaFase1Chamada = await deps.dentro(ctx.escopo, (d) => {
          contexto.correlationId = contextoAtual()?.correlationId;
          contexto.services = d.services;
          return executar(d, chamarFerramentaFase1, {
            turnoId,
            agenteId: ctx.params.agenteId ?? "",
            nome: ctx.params.nome ?? "",
            argumentos: typeof corpo === "object" && corpo !== null ? (corpo.argumentos ?? {}) : {},
            plano,
          });
        });
        // ADR-115 (PR 5): a ação foi ao revisor. O pedido entra no executor só agora, depois do commit da fase 1 — o
        // revisor não pode responder por uma decisão que o banco ainda não tem; o proxy recebe o `aguardar` de sempre.
        if ("emRevisao" in fase1) {
          if (fase1.emRevisao.fila) deps.revisor?.enfileirar(fase1.emRevisao.fila);
          ctx.json(200, { aguardar: fase1.emRevisao.aguardar });
          return;
        }
        if (!("efeito" in fase1)) {
          ctx.json(200, fase1);
          return;
        }
        const { efeito } = fase1;
        const servicos = contexto.services;
        if (!servicos) throw new Error("fase 1 sem services");
        const correlationId = contexto.correlationId ?? randomUUID();
        // Sem o contexto, o `carregar` do conector não sabe de quem é a chamada e procura entre todas as pessoas (compor.ts).
        const contextoDoLog = { tenantId: ctx.escopo.tenantId, pessoaId: ctx.escopo.pessoaId, correlationId };
        const desfecho = await executarComContexto(contextoDoLog, () => executarEfeito(servicos, efeito));
        const direto = respostaSemFase2(efeito, desfecho);
        if (direto) {
          ctx.json(200, direto);
          // NOD-374: o app que tinha falha respondeu — limpa numa tx curta depois da resposta. Se falhar, a próxima chamada
          // que der certo tenta de novo (a fase 1 ainda vê a falha); a chamada já foi respondida e não depende disso.
          if (precisaLimparAposSucesso(efeito, desfecho)) {
            await executarComContexto(contextoDoLog, () => deps.dentro(ctx.escopo, (d) => executar(d, limparFalhaAposSucesso, entradaDaLimpeza(efeito))))
              .then((r) => {
                if (r.limpou) deps.disjuntor?.mudou?.(ctx.escopo);
              })
              .catch((e: unknown) => {
                log("aviso", "conector_limpeza_falhou", { conector_id: efeito.conectorId, erro: e instanceof Error ? e.name : "desconhecido" });
              });
          }
          return;
        }
        const resultado = await executarComContexto(contextoDoLog, () => assentarComNovaTentativa(
          () => deps.dentro(ctx.escopo, (d) => executar(d, concluirChamada, { efeito, desfecho })),
          { correlationId, efeito, dormir: deps.dormir ?? dormirPadrao },
        ));
        ctx.json(200, resultado);
        // NOD-374: timeout ou queda → a sonda de confirmação decide se a falha abre (401/403 já apareceu na fase 2).
        if (efeito.tipo === "conector" && desfecho.tipo === "conector" && !desfecho.ok && classificarFalhaDaChamada(desfecho.erro).tipo !== "acesso_recusado") {
          deps.disjuntor?.confirmar(ctx.escopo, efeito.conectorId);
        }
      },
    },
    {
      metodo: "GET",
      padrao: /^\/decisoes\/(?<id>[^/]+)\/aguardar$/,
      interno: true,
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const turnoId = ctx.params.turnoId ?? "";
        const inicio = deps.agora();
        for (;;) {
          const olhada = await deps.dentro(ctx.escopo, async (d) => {
            const decisao = await d.repos.decisoes.buscar(decisaoId);
            if (!decisao || decisao.turnoId !== turnoId) return { estado: "inexistente" as const };
            if (decisao.estado === "decidida" || decisao.estado === "vencida") {
              const itens = await d.repos.itensAprovacao.listar(decisaoId);
              // ADR-048: item aprovado que roda no Mac ainda sem desfecho = a execução não acabou.
              // definido em 2026-09-28: vale para TODO item aprovado — a fase 1 fecha a decisão antes de
              // executar, e o computador voltava "decidida" com desfecho nulo enquanto ainda rodava.
              if (decisao.estado === "decidida" && itens.some((i) => i.selecionado && i.desfecho === null)) return { estado: "pendente" as const };
              // 0032: este turno é quem continua a decisão. Se uma retomada já ficou com ela, o turno encerra
              // (a retomada continua) — nunca os dois.
              if (decisao.estado === "decidida" && (await d.repos.decisoes.reivindicarContinuacao(decisaoId, "turno", deps.agora())) === "retomada") return { estado: "da_retomada" as const };
              return { estado: "decidida" as const, itens: itens.map((i) => ({ idx: i.idx, desfecho: i.desfecho, acaoId: i.destino.conector === "computador" && typeof i.destino.argumentos?.acaoId === "string" ? i.destino.argumentos.acaoId : null })) };
            }
            return { estado: "pendente" as const, desde: Date.parse(decisao.criadoEm) };
          });
          // ADR-083 (#194): sob pressão, a task que espera a pessoa há mais de 5 min solta a espera — o turno encerra, o
          // processo fecha e a decisão vira retomada (--resume) quando ela responder.
          if (olhada.estado === "pendente" && deps.pressao && soltarPorMemoria({ nivel: deps.pressao(ctx.escopo.pessoaId), esperandoDesde: olhada.desde ?? deps.agora(), agora: deps.agora() })) {
            const fechou = await deps.dentro(ctx.escopo, async (d) => {
              const r = await fecharPorMemoria(d, turnoId);
              if (r.events.length) await d.repos.events.gravarComOutbox(r.events);
              return r.fechou;
            });
            if (fechou) {
              ctx.json(200, { estado: "pendente", soltar: true });
              return;
            }
          }
          // revisto em 2026-10-09 (ADR-089, revisão do #223): antes a rota devolvia "pendente" e o hook seguia vivo até
          // 420 s junto com a retomada — duas cópias na mesma task. Agora solta na hora: o turno encerra.
          if (olhada.estado === "da_retomada") {
            ctx.json(200, { estado: "pendente", soltar: true });
            return;
          }
          if (olhada.estado === "inexistente") {
            ctx.json(404, { codigo: "nao_encontrado", mensagem: "decisão não pertence a este turno" });
            return;
          }
          if (olhada.estado === "decidida") {
            // 0032: o resultado da ação aprovada no computador volta junto (cifrado até aqui, entregue uma vez).
            const itens = await Promise.all(olhada.itens.map(async ({ acaoId, ...i }) => {
              const resultado = acaoId && deps.computadores ? await deps.computadores.resultadoDaAcao(ctx.escopo, acaoId) : null;
              return resultado ? { ...i, resultado } : i;
            }));
            ctx.json(200, { estado: "decidida", itens });
            return;
          }
          if (deps.agora() - inicio + intervalo > teto) {
            ctx.json(200, { estado: "pendente" });
            return;
          }
          await dormir(intervalo + Math.floor(Math.random() * 250));
        }
      },
    },
    {
      // ADR-052: o hook do nod confirma cada chamada NATIVA antes de ela rodar. A nativa tem de estar no plano do
      // turno; a trilha registra sempre (é o registro do que entrou de fora); a web marca
      // o turno (0033). Quem decide se contamina é o SERVIDOR, pela ferramenta — nunca o que o hook manda.
      metodo: "POST",
      padrao: /^\/nativas$/,
      interno: true,
      // revisto em 2026-09-28 (ADR-055): o Bash vem com o comando, e quem decide é autorizarComando — o que só lê
      // roda; o resto abre um card e a resposta diz ao hook qual decisão esperar. Trilha só do que roda.
      async handler(ctx) {
        const c = (await ctx.corpo()) as { ferramenta?: unknown; comando?: unknown; arquivo?: unknown; mcp?: unknown; credencial?: unknown } | null;
        const ferramenta = typeof c?.ferramenta === "string" ? c.ferramenta : "";
        const turnoId = ctx.params.turnoId ?? "";
        const plano = await deps.tokens.planoOuRecompor(turnoId);
        if (!plano || !(plano.nativas ?? []).includes(ferramenta)) {
          ctx.json(403, { codigo: "nao_permitido", mensagem: "ferramenta nativa fora do plano deste turno" });
          return;
        }
        // ADR-067: o Monitor roda um comando como o Bash, e passa pela mesma decisão.
        const rodaComando = ferramenta === "Bash" || ferramenta === "Monitor";
        if (rodaComando && typeof c?.comando !== "string") throw new ErroDeDominio("entrada_invalida", { cause: `${ferramenta} sem comando` });
        // ADR-103: a chamada a um app (MCP) da pessoa vem com o texto do pedido (servidor, ferramenta e argumentos).
        const mcp = ferramenta === NATIVA_MCP_DA_PESSOA ? (typeof c?.mcp === "string" ? c.mcp : null) : null;
        if (ferramenta === NATIVA_MCP_DA_PESSOA && mcp === null) throw new ErroDeDominio("entrada_invalida", { cause: `${ferramenta} sem pedido` });
        const chaveBruta = ctx.req.headers["x-nod-idempotency-key"];
        const chave = Array.isArray(chaveBruta) ? chaveBruta[0] : chaveBruta;
        if (chave !== undefined && !ehUuid(chave)) throw new ErroDeDominio("entrada_invalida", { cause: "chave de idempotência da nativa" });
        // ADR-089 (#217): o laço de espera com sleep (e o sleep longo) segura o processo do bot no Mac sem trabalho. Nega
        // antes de qualquer card ou trilha, em qualquer modo — nem o modo total aprova esperar assim. A saída é a volta
        // marcada (me_chame_as, ADR-086) quando ela está no catálogo deste turno; senão, encerrar dizendo o que falta.
        const espera = rodaComando ? esperaEmLaco(String(c?.comando)) : null;
        if (espera) {
          const comMeChameAs = plano.catalogo.ferramentas.some((f) => f.nome === "me_chame_as" && f.origem === "nod");
          const comEsperarComando = plano.catalogo.ferramentas.some((f) => f.nome === "esperar_comando" && f.origem === "nod");
          log("aviso", "espera_em_laco_negada", { turno_id: turnoId, ferramenta, tipo: espera.tipo, segundos: Number.isFinite(espera.segundos) ? espera.segundos : null, me_chame_as: comMeChameAs, esperar_comando: comEsperarComando });
          ctx.json(403, { codigo: "nao_permitido", mensagem: motivoDaEsperaNegada(espera, comMeChameAs, comEsperarComando) });
          return;
        }
        // PR 6 dos modos de aprovação: o hook novo manda o arquivo de credencial (ou o pedido do MCP que cita uma) em vez
        // de negar sozinho. O servidor decide pelo modo atual e, quando libera, diz isso EXPLICITAMENTE
        // (`credencial: "permitida"`): o hook não aceita um `{ ok: true }` cru, que é o que o servidor antigo responde.
        // Só nas nativas em que o hook a manda; noutra (o Bash), o campo é ignorado e o comando segue a decisão de sempre.
        const credencial = typeof c?.credencial === "string" && NATIVAS_COM_CREDENCIAL.includes(ferramenta) ? c.credencial : null;
        // ADR-115: o pedido ao revisor só entra no executor depois do commit — o revisor não pode responder por uma decisão
        // que o banco ainda não tem.
        const paraOExecutor: { revisao?: PedidoNaFila; negar?: string } = {};
        const resultado = await deps.dentro(ctx.escopo, async (d) => {
          if (chave) {
            const anterior = await d.repos.nativasIdempotencia.travar(turnoId, chave);
            if (anterior) return anterior;
          }
          // ADR-059: o comando que o MODO aprovou leva a regra do modo na trilha. Sem isso ele fica igual a uma
          // leitura, e o gatilho da ADR-055 ("nativa__Bash sem decisão correspondente") dispararia à toa.
          let regra: { regra: `regra:${string}`; regraVersao: number } = { regra: REGRA_CHAMADA, regraVersao: VERSAO_REGRA_CHAMADA };
          // ADR-066: a gravação fora de ~/nod/<bot> (o hook manda `arquivo`) passa pela mesma decisão do comando.
          // ADR-103: o apply_patch do Codex grava como o Write do Claude.
          const arquivo = ["Write", "Edit", "NotebookEdit", "apply_patch"].includes(ferramenta) && typeof c?.arquivo === "string" ? c.arquivo : null;
          if (credencial !== null || rodaComando || arquivo !== null || mcp !== null) {
            const r = await executar(d, autorizarComando, credencial !== null ? { plano, credencial, ferramenta } : arquivo !== null ? { plano, arquivo } : mcp !== null ? { plano, mcp } : { plano, comando: String(c?.comando) });
            if ("negar" in r) {
              // Sem chave guardada: o reenvio (NOD-293) só decide de novo. NOD-70: a negação vira linha `negacao` na
              // trilha (o reenvio grava outra — a tela agrupa as repetidas).
              await d.repos.trilha.registrar({ agenteId: plano.agenteId, turnoId, ferramenta: nomeParaTrilha(`nativa__${ferramenta}`), kind: "negacao", motivo: "credencial_no_manual", regra: REGRA_PARADA_ALCADA, regraVersao: VERSAO_REGRA_PARADA_ALCADA });
              paraOExecutor.negar = r.negar;
              return null;
            }
            if ("aguardar" in r) {
              if (r.revisao) paraOExecutor.revisao = r.revisao;
              const resposta = { aguardar: r.aguardar };
              if (chave) await d.repos.nativasIdempotencia.registrar(turnoId, chave, resposta);
              return resposta;
            }
            const comRevisor = d.services.revisor?.config.ligado === true;
            if (r.porque === "modo_automatico") regra = { regra: REGRA_MODO_AUTOMATICO, regraVersao: comRevisor ? VERSAO_MODO_AUTOMATICO_COM_REVISOR : VERSAO_MODO_AUTOMATICO };
            if (r.porque === "modo_total") regra = { regra: REGRA_MODO_TOTAL, regraVersao: VERSAO_MODO_TOTAL };
            // Revisão de engenharia 21: o comando liberado pelo revisor leva a regra dele, não a da chamada.
            if (r.porque === "revisor") regra = { regra: REGRA_REVISOR, regraVersao: VERSAO_REGRA_REVISOR };
            // NOD-70: o clique da pessoa e o "liberar na tarefa" também levam a regra real (a leitura segue a da chamada).
            if (r.porque === "aprovado") regra = { regra: REGRA_CLIQUE, regraVersao: VERSAO_REGRA_CLIQUE };
            if (r.porque === "liberado_na_tarefa") regra = { regra: REGRA_LIBERADO_NA_TAREFA, regraVersao: VERSAO_LIBERADO_NA_TAREFA };
          }
          await d.repos.trilha.registrar({ agenteId: plano.agenteId, turnoId, ferramenta: nomeParaTrilha(`nativa__${ferramenta}`), kind: "tool_call", ...regra });
          if (NATIVAS_QUE_CONTAMINAM.includes(ferramenta)) await d.repos.turnos.contaminar(turnoId, deps.agora());
          // PR 6: a credencial liberada vai guardada com a confirmação explícita — o reenvio (NOD-293) devolve a mesma.
          const resposta = credencial !== null ? ({ ok: true, credencial: "permitida" } as const) : ({ ok: true } as const);
          if (chave) await d.repos.nativasIdempotencia.registrar(turnoId, chave, resposta);
          return resposta;
        });
        if (paraOExecutor.negar !== undefined) {
          ctx.json(403, { codigo: "nao_permitido", mensagem: paraOExecutor.negar });
          return;
        }
        if (paraOExecutor.revisao) deps.revisor?.enfileirar(paraOExecutor.revisao);
        ctx.json(200, resultado);
      },
    },
    {
      // NOD-323 (ADR-126): a mídia que o bot gerou na pasta dele. Corpo BINÁRIO (os bytes; vazio = só o cartão, o arquivo
      // passou do limite da família) e os metadados em `x-nod-midia`. O servidor refareja o tipo e confere o sha256: o
      // proxy é da máquina da pessoa, não é confiável. 201 {id, familia, exibicao, semBytes}; recusa = código fechado.
      metodo: "POST",
      padrao: /^\/midias$/,
      interno: true,
      async handler(ctx) {
        const bruto = ctx.req.headers["x-nod-midia"];
        if (typeof bruto === "string" && bruto.length > TETO_CABECALHO_MIDIA) {
          ctx.json(431, { codigo: "entrada_invalida", mensagem: "cabeçalho x-nod-midia grande demais" });
          return;
        }
        const cabecalho = lerCabecalhoMidia(bruto);
        if (!cabecalho) {
          ctx.json(400, { codigo: "entrada_invalida", mensagem: "x-nod-midia inválido" });
          return;
        }
        const declarado = Number(ctx.req.headers["content-length"] ?? "0");
        if (!Number.isFinite(declarado) || declarado > TAMANHO_MAX_MIDIA) {
          ctx.json(413, { codigo: "entrada_invalida", mensagem: "arquivo grande demais" });
          return;
        }
        // O plano antes do corpo: turno sem plano não ocupa vaga nem memória com 50 MiB que vão para o lixo.
        const turnoId = ctx.params.turnoId ?? "";
        const plano = await deps.tokens.planoOuRecompor(turnoId);
        if (!plano) {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "plano de turno ausente" });
          return;
        }
        // Espera a vez (sem ler o corpo: o TCP segura o resto); quem desistiu no meio não pega vaga.
        const desde = Date.now();
        while (!vagaLivre(turnoId) && Date.now() - desde < esperaVagaMidiaMs && !ctx.req.destroyed) await dormirPadrao(50);
        if (ctx.req.destroyed) return;
        if (!vagaLivre(turnoId)) {
          ctx.res.setHeader("retry-after", "2");
          ctx.json(503, { codigo: "ocupado", mensagem: "outro envio em curso; tente de novo" });
          return;
        }
        uploadsEmCurso++;
        turnosSubindo.add(turnoId);
        try {
          let conteudo: Buffer;
          // Ociosidade (não prazo total): um corpo que para no meio derruba o socket e solta a vaga.
          ctx.req.setTimeout(ociosoMidiaMs, () => ctx.req.destroy(new Error("upload de mídia ocioso")));
          const prazo = setTimeout(() => ctx.req.destroy(new Error("upload de mídia lento demais")), prazoCorpoMidia(declarado));
          try {
            conteudo = await lerBruto(ctx.req, TAMANHO_MAX_MIDIA);
          } catch (e) {
            if (e instanceof RangeError) {
              ctx.json(413, { codigo: "entrada_invalida", mensagem: "arquivo grande demais" });
              return;
            }
            if (ctx.req.destroyed) return;
            throw e;
          } finally {
            ctx.req.setTimeout(0);
            clearTimeout(prazo);
          }
          const sha256Recebido = conteudo.byteLength > 0 ? createHash("sha256").update(conteudo).digest("hex") : null;
          const r = await deps.dentro(ctx.escopo, (d) => executar(d, receberMidiaDoBot, { plano, cabecalho, conteudo, sha256Recebido }));
          if (!r.ok) {
            ctx.json(STATUS_DA_RECUSA[r.motivo], { codigo: r.motivo });
            return;
          }
          ctx.json(r.novo ? 201 : 200, { id: r.id, familia: r.familia, exibicao: r.exibicao, semBytes: r.semBytes });
        } finally {
          uploadsEmCurso--;
          turnosSubindo.delete(turnoId);
        }
      },
    },
    {
      // NOD-323: o que o proxy não anexou (código e contagem; nunca o caminho), para a linha discreta abaixo da fala.
      metodo: "POST",
      padrao: /^\/midias\/recusas$/,
      interno: true,
      async handler(ctx) {
        const c = (await ctx.corpo()) as { recusas?: unknown } | null;
        const turnoId = ctx.params.turnoId ?? "";
        ctx.json(200, await deps.dentro(ctx.escopo, (d) => executar(d, registrarRecusasDeMidia, { turnoId, recusas: c?.recusas })));
      },
    },
    {
      // ADR-048: o proxy relata o desfecho de uma ferramenta que rodou no gh do Mac (código fechado).
      metodo: "POST",
      padrao: /^\/execucoes-locais$/,
      interno: true,
      async handler(ctx) {
        const c = (await ctx.corpo()) as { nome?: unknown; codigo?: unknown } | null;
        if (typeof c?.nome !== "string" || typeof c.codigo !== "string") throw new ErroDeDominio("entrada_invalida");
        const turnoId = ctx.params.turnoId ?? "";
        const plano = await deps.tokens.planoOuRecompor(turnoId);
        const ok = await deps.dentro(ctx.escopo, (d) => registrarExecucaoLocal(d, { turnoId, agenteId: ctx.params.agenteId ?? "", plano, nome: c.nome as string, codigo: c.codigo as string }));
        if (!ok) throw new ErroDeDominio("nao_permitido");
        ctx.json(200, { ok: true });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/negacoes$/,
      interno: true,
      async handler(ctx) {
        const c = (await ctx.corpo()) as { nome?: unknown; motivo?: unknown; classe?: unknown; conectorId?: unknown };
        const motivo = MOTIVOS_NEGACAO.find((m) => m === c.motivo);
        const classe = CLASSES.find((k) => k === c.classe);
        if (!motivo || !classe || typeof c.nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "negação malformada" });
        const turnoId = ctx.params.turnoId ?? "";
        const plano = await deps.tokens.planoOuRecompor(turnoId);
        const negacao = await deps.dentro(ctx.escopo, (d) =>
          executar(d, registrarNegacao, {
            turnoId,
            agenteId: ctx.params.agenteId ?? "",
            conversaId: plano?.conversaId ?? null,
            nome: c.nome as string,
            motivo: motivo as MotivoNegacao,
            classe,
            conectorId: typeof c.conectorId === "string" ? c.conectorId : null,
            autoria: plano?.autoria,
          }),
        );
        ctx.json(200, { ok: true, negacao });
      },
    },
  ];
}
