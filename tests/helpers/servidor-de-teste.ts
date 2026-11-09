import type { DepsRoteador, Rota } from "../../src/adapters/http/roteador.ts";
import { listen } from "../../src/adapters/http/server.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "./ids.ts";

export type DepsServidorDeTeste = {
  autorizarTokenTurno?: DepsRoteador["autorizarTokenTurno"];
  segredoSessao?: string;
};

export type ServidorDeTeste = {
  url: string;
  close: () => Promise<void>;
  /**
   * Sessão de teste cunhada DIRETO com o segredo do servidor (a mesma receita de servidor-completo.ts):
   * não passa por rota de login nenhuma. Definido em 2026-09-16 (E1, ADR-030): os testes de rotas,
   * métricas e SSE não testam login, então não dependem do login de desenvolvimento.
   */
  entrar(pessoa: "marlon" | "ana"): Promise<{ cookie: string; tenantId: string; pessoaId: string }>;
  /** fetch já com cookie e JSON; `base` é a URL escopada /api/t/:tenantId. */
  chamar(sessao: { cookie: string; tenantId: string }, metodo: string, caminho: string, corpo?: unknown): Promise<Response>;
};

const PESSOAS = { marlon: PESSOA_MARLON, ana: PESSOA_ANA } as const;

/**
 * Servidor real em porta 0 (EMENDA 34) sobre o roteador da L1, recebendo as ROTAS e as DEPS da
 * lane que testa (EMENDA 7: este helper não é reescrito; a L9 cria servidor-completo.ts com
 * compor.ts). Sem banco por si: quem precisa de banco injeta nas rotas.
 */
export async function servidorDeTeste(rotas: Rota[], deps: DepsServidorDeTeste = {}): Promise<ServidorDeTeste> {
  const segredo = deps.segredoSessao ?? "segredo-de-teste";
  const srv = await listen(0, "127.0.0.1", {
    rotas,
    segredoSessao: segredo,
    autorizarTokenTurno: deps.autorizarTokenTurno,
  });
  const url = `http://127.0.0.1:${srv.port}`;
  return {
    url,
    close: srv.close,
    async entrar(pessoa) {
      const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOAS[pessoa] };
      return { cookie: `nod_sessao=${cunharCookie(escopo, segredo)}`, ...escopo };
    },
    chamar(sessao, metodo, caminho, corpo) {
      return fetch(`${url}/api/t/${sessao.tenantId}/${caminho.replace(/^\//, "")}`, {
        method: metodo,
        headers: { cookie: sessao.cookie, "content-type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    },
  };
}
