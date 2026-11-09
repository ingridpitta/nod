import { ErroArquivoDoMac, type PedidoSubida } from "../adapters/integracoes/arquivo-composio.ts";
import { criarClienteMcp, ErroTransporteMcp, type ClienteMcp, type ResultadoChamadaMcp } from "../adapters/mcp-proxy/cliente-mcp.ts";
import { arquivosDoMac, trocarArquivos, type ArquivoDoMac, type ArquivoSubido } from "../domain/arquivo-do-mac.ts";
import { sondarConector, type ConfigSonda } from "../adapters/mcp-proxy/probe.ts";
import type { Conector } from "../contracts/conector.ts";
import { COMANDO_GITHUB_NATIVO } from "../contracts/github.ts";
import type { ResultadoSonda, ServicesNod } from "../contracts/servicos.ts";
import { montarAmbiente } from "../domain/ambiente-executor.ts";
import { log } from "../obs/log.ts";
import { CHAMADA_CONECTOR_MS } from "../shared/constantes.ts";
import type { Relogio } from "../shared/types.ts";

/**
 * Cache de clientes MCP dos conectores no PROCESSO DO SERVIDOR (core-features §credencial: o env
 * decifrado nunca sai daqui; o proxy na máquina da pessoa só fala com o servidor). SEM BANCO
 * (EMENDA 3): quem carrega o conector e decifra o env é o callback `carregar`, injetado pela
 * composição (L9) com repos + src/db/cifra.ts. Uma chamada por vez por conector (o cliente
 * serializa); cliente que cai é descartado e a próxima chamada respawna.
 */
export type ContextoChamada = {
  rotina: boolean;
  /** NOD-157: o readOnlyHint da ferramenta decide se uma falha transitória pode ser repetida. Ausente = escrita. */
  somenteLeitura?: boolean;
};

export type ConfigConectorVivo = ConfigSonda & {
  /**
   * definido em 2026-09-24 (ADR-048): credencial com validade (token de instalação do GitHub App, 1 h).
   * Depois deste instante o cliente vivo é descartado e a próxima chamada recarrega com um novo.
   */
  expiraEm?: number;
};

export type OpcoesConectoresVivos = {
  /**
   * Devolve a configuração com env DECIFRADO, ou null se o conector não existe/não é visível.
   * `contexto.rotina` (ADR-048): o conector nativo do GitHub só pode usar o App da organização em
   * turno de rotina — por isso o cliente vivo é guardado por (conector, rotina).
   */
  carregar(conectorId: string, contexto: ContextoChamada): Promise<ConfigConectorVivo | null>;
  /**
   * definido em 2026-09-24 (ADR-048): a sonda de conector NATIVO, sem processo — o catálogo é o
   * contrato e o jeito já foi conferido na entrada. null = não é nativo, segue a sonda de sempre.
   */
  sondarNativo?(conector: Conector): Promise<ResultadoSonda | null>;
  agora: Relogio;
  /** definido em 2026-09-16: 15 s — teto da chamada a conector; acima disso é conector_indisponivel para o modelo (o teto do tools/call do CLI é medido pela L4). */
  timeoutChamadaMs?: number;
  ambiente?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  /**
   * ADR-068: sobe um arquivo do Mac para o Composio e devolve a chave. Ausente = este servidor não alcança os
   * arquivos do Mac (o compartilhado): a chamada com caminho volta como erro legível, sem tocar no app.
   */
  subirArquivo?: (p: PedidoSubida) => Promise<ArquivoSubido>;
  /** ADR-068: teto da chamada que leva arquivo — o app baixa o arquivo do Composio e o envia (injetável no teste). */
  timeoutComArquivoMs?: number;
  /**
   * NOD-263 (emenda ao ADR-001): a guarda chamada antes de cada `chamar` — a composição injeta `exigirForaDaTx` (src/db/tx.ts),
   * que loga `conector_dentro_da_tx` com tx escopada aberta (e lança em teste). Callback porque src/services é sem banco.
   */
  antesDeChamar?: (campos: { conector_id: string; ferramenta: string }) => void;
};

/**
 * definido em 2026-10-01 (ADR-068): 10 min para a chamada que leva arquivo. O teto normal (15 s) é de uma consulta; um
 * vídeo de QA de dezenas de MB passa por download do armazenamento do Composio e upload no app antes da resposta.
 */
export const CHAMADA_COM_ARQUIVO_MS = 600_000;

export { CHAMADA_CONECTOR_MS };

export type ConectoresVivos = ServicesNod<unknown>["conectores"] & {
  fechar(): Promise<void>;
  /** Quantos clientes vivos (métrica/testes). */
  vivos(): number;
};

export function criarConectoresVivos(opcoes: OpcoesConectoresVivos): ConectoresVivos {
  const clientes = new Map<string, ClienteMcp>();
  const validade = new Map<string, number>();
  const timeout = opcoes.timeoutChamadaMs ?? CHAMADA_CONECTOR_MS;

  const chave = (conectorId: string, contexto: ContextoChamada) => `${conectorId}|${contexto.rotina ? "rotina" : "interativo"}`;

  async function clienteDe(conectorId: string, contexto: ContextoChamada): Promise<ClienteMcp> {
    const k = chave(conectorId, contexto);
    const existente = clientes.get(k);
    const vence = validade.get(k);
    if (existente && (vence === undefined || vence > opcoes.agora())) return existente;
    if (existente) await descartarChave(k);
    const cfg = await opcoes.carregar(conectorId, contexto);
    if (!cfg) throw new ErroTransporteMcp("conector_indisponivel", "conector não carregado");
    const env = cfg.transporte === "http" ? { ...(cfg.env ?? {}) } : { ...montarAmbiente("servidor", opcoes.ambiente ?? process.env, process.platform), ...(cfg.env ?? {}) };
    const c = criarClienteMcp({ nome: cfg.nome, transporte: cfg.transporte, comando: cfg.comando ?? null, args: cfg.args ?? [], url: cfg.url ?? null, env, timeoutMs: timeout, fetchImpl: opcoes.fetchImpl });
    clientes.set(k, c);
    if (cfg.expiraEm !== undefined) validade.set(k, cfg.expiraEm);
    return c;
  }

  async function descartarChave(k: string): Promise<void> {
    const c = clientes.get(k);
    clientes.delete(k);
    validade.delete(k);
    if (c) await c.fechar().catch(() => undefined);
  }

  async function descartar(conectorId: string): Promise<void> {
    for (const k of [...clientes.keys()]) if (k.startsWith(`${conectorId}|`)) await descartarChave(k);
  }

  /**
   * ADR-068: a chamada cita arquivos do Mac no `s3key`. Roda DEPOIS da decisão do modo (chamar-ferramenta e decidir
   * chegam aqui só com a chamada liberada), então nada sai do Mac sem a aprovação que a escrita pede. Cada arquivo
   * sobe uma vez; a chamada vai com as chaves, num cliente próprio com prazo de envio de arquivo. Problema com o
   * arquivo volta como erro legível ao modelo — o conector não é marcado como falho por isso.
   */
  async function chamarComArquivos(conectorId: string, tool: string, args: Record<string, unknown>, contexto: ContextoChamada, arquivos: ArquivoDoMac[]): Promise<ResultadoChamadaMcp> {
    const erro = (texto: string): ResultadoChamadaMcp => ({ conteudo: `arquivo do Mac: ${texto}`, isError: true });
    if (!opcoes.subirArquivo) return erro("este nod roda num servidor que não alcança os arquivos do seu Mac; o envio de arquivo só funciona com o nod local");
    const cfg = await opcoes.carregar(conectorId, contexto);
    if (!cfg) throw new ErroTransporteMcp("conector_indisponivel", "conector não carregado");
    const chaveApi = cfg.transporte === "http" ? cfg.env?.["x-api-key"] : undefined;
    if (!chaveApi) return erro(`o app ${cfg.nome} não recebe arquivo do Mac pelo nod (só os apps do marketplace)`);
    const subidos = new Map<string, ArquivoSubido>();
    try {
      for (const a of arquivos) if (!subidos.has(a.caminho)) subidos.set(a.caminho, await opcoes.subirArquivo({ chave: chaveApi, toolkit: cfg.nome, ferramenta: tool, arquivo: a }));
    } catch (e) {
      if (e instanceof ErroArquivoDoMac) return erro(e.message);
      throw e;
    }
    const c = criarClienteMcp({ nome: cfg.nome, transporte: cfg.transporte, comando: null, args: [], url: cfg.url ?? null, env: { ...(cfg.env ?? {}) }, timeoutMs: opcoes.timeoutComArquivoMs ?? CHAMADA_COM_ARQUIVO_MS, orcamentoMs: null, fetchImpl: opcoes.fetchImpl });
    try {
      return await c.chamar(tool, trocarArquivos(args, subidos));
    } catch (e) {
      log("aviso", "conector_chamada_falhou", { conector_id: conectorId, ferramenta: tool, motivo: e instanceof ErroTransporteMcp ? e.motivo : "falha_tecnica", com_arquivo: true });
      throw e;
    } finally {
      await c.fechar().catch(() => undefined);
    }
  }

  return {
    async chamar(conectorId, tool, args, contexto = { rotina: false }) {
      opcoes.antesDeChamar?.({ conector_id: conectorId, ferramenta: tool });
      const arquivos = arquivosDoMac(args);
      if (arquivos.length) return chamarComArquivos(conectorId, tool, args, contexto, arquivos);
      const c = await clienteDe(conectorId, contexto);
      try {
        return await c.chamar(tool, args, { somenteLeitura: contexto.somenteLeitura === true });
      } catch (e) {
        // Só chega aqui depois de esgotar as tentativas (o cliente repete por dentro): descartar e marcar falha é o fim.
        log("aviso", "conector_chamada_falhou", { conector_id: conectorId, ferramenta: tool, motivo: e instanceof ErroTransporteMcp ? e.motivo : "falha_tecnica", status: e instanceof ErroTransporteMcp ? e.status : undefined });
        await descartarChave(chave(conectorId, contexto));
        throw e;
      }
    },

    async sondar(conector: Conector, o?: { orcamentoMs?: number; manterVivos?: boolean; env?: Record<string, string> }): Promise<ResultadoSonda> {
      // A sonda usa o env DECIFRADO via carregar; o `conector` recebido só traz placeholders (ConectorGuardado).
      // definido em 2026-10-26 (NOD-374): a sonda de fundo (manterVivos) não descarta o cliente de uma chamada em curso.
      if (!o?.manterVivos) await descartar(conector.id);
      if (conector.comando === COMANDO_GITHUB_NATIVO) return (await opcoes.sondarNativo?.(conector)) ?? { ok: false, motivo: "conector_indisponivel" };
      const guardada = (await opcoes.carregar(conector.id, { rotina: false })) ?? { nome: conector.slug, transporte: conector.transporte, comando: conector.comando, args: conector.args, url: conector.url, env: {} };
      // NOD-50: o cartão de credencial sonda a chave CANDIDATA antes de gravá-la (só o env muda; comando, args e url são os guardados).
      const cfg = o?.env ? { ...guardada, env: o.env } : guardada;
      return sondarConector(cfg, { ambiente: opcoes.ambiente, fetchImpl: opcoes.fetchImpl, ...(o?.orcamentoMs !== undefined ? { orcamentoMs: o.orcamentoMs } : {}) });
    },

    descartar,

    async fechar() {
      for (const k of [...clientes.keys()]) await descartarChave(k);
    },

    vivos() {
      return clientes.size;
    },
  };
}
