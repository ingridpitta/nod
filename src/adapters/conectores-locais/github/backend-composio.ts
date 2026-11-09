import type { NomeCapacidadeGithub } from "../../../contracts/github.ts";
import type { ArgsGithub } from "../../../domain/github.ts";
import { chamadasComposioGithub, GITHUB_PELO_COMPOSIO } from "../../integracoes/composio.ts";
import { criarClienteMcp, type ClienteMcp } from "../../mcp-proxy/cliente-mcp.ts";
import { TODAS, type BackendGithub } from "./capacidades.ts";
import { ErroGithub, type CodigoErroGithub } from "./erros.ts";

export type OpcoesBackendComposio = {
  /** URL MCP da sessão do Composio da pessoa (tool router), guardada cifrada no env do conector. */
  url: string;
  chave: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** O Composio devolve o erro do GitHub em texto; só o status vira código — o resto do texto não sai. */
function codigoDoTexto(texto: string): CodigoErroGithub {
  if (/\b401\b|bad credentials|unauthorized/i.test(texto)) return "sem_login";
  if (/rate limit/i.test(texto)) return "limite";
  if (/\b403\b|forbidden|not accessible|permission/i.test(texto)) return "sem_permissao";
  if (/\b404\b|not found/i.test(texto)) return "nao_encontrado";
  return "falha";
}

/**
 * Jeito 2 (ADR-048): o login OAuth do Composio, que já existia, por trás dos nomes estáveis. Cada
 * capacidade vira as ferramentas GITHUB_* da tabela em integracoes/composio.ts; capacidade sem par
 * fica fora de tools/list (indisponível neste jeito) em vez de adivinhada.
 */
export function criarBackendComposio(o: OpcoesBackendComposio): BackendGithub {
  let cliente: ClienteMcp | null = null;
  // definido em 2026-09-24: 6 s por ferramenta — pr_comentarios faz duas (o cliente MCP serializa) e
  // as duas cabem nos 12 s da capacidade, abaixo dos 15 s de CHAMADA_CONECTOR_MS do servidor.
  // Sem nova tentativa (NOD-157, orcamentoMs: null): o orçamento de 30 s não cabe nesses 12 s, e uma
  // escrita repetida depois que o servidor desistiu duplicaria o efeito (ADR-009).
  const mcp = () => (cliente ??= criarClienteMcp({ nome: "github-composio", transporte: "http", url: o.url, env: { "x-api-key": o.chave }, timeoutMs: o.timeoutMs ?? 6_000, orcamentoMs: null, fetchImpl: o.fetchImpl }));
  return {
    disponiveis: TODAS.filter((c: NomeCapacidadeGithub) => GITHUB_PELO_COMPOSIO[c] !== null),
    async executar(args: ArgsGithub) {
      const chamadas = chamadasComposioGithub(args);
      if (!chamadas) throw new ErroGithub("falha", "composio");
      const partes: string[] = [];
      for (const c of chamadas) {
        let r: { conteudo: string; isError: boolean };
        try {
          r = await mcp().chamar(c.slug, c.argumentos);
        } catch {
          cliente = null;
          throw new ErroGithub("falha", "composio");
        }
        if (r.isError || /"successful"\s*:\s*false/.test(r.conteudo)) throw new ErroGithub(codigoDoTexto(r.conteudo), "composio");
        partes.push(r.conteudo);
      }
      return partes.join("\n");
    },
  };
}
