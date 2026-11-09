import { conviteValido } from "../../shared/convite.ts";
import { papelDoScript } from "./motor-instalacao.ts";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Escopo } from "../../shared/types.ts";
import { log } from "../../obs/log.ts";
import { criarEstatico } from "./estatico.ts";
import { criarRoteador, type DepsRoteador, type Rota } from "./roteador.ts";
import { responderMetricas } from "./rotas/metricas.ts";
import { criarRotaSaude, criarRotaSaudeLb, type EstadoSaude, type VerificacaoSaude } from "./rotas/saude.ts";
import { criarSessao, exigirConfiguracaoSegura, segredoEfetivo, type ContasNaSessao, type OpcoesSessao } from "./sessao.ts";

/**
 * Servidor: roteador + saúde + sessão (google ou stub de desenvolvimento, ADR-030) + estático + as rotas compostas (compor.ts). Sem
 * framework: node:http puro. O ponto de entrada (main) é server.ts, que chama boot.ts — este módulo
 * não importa boot.ts para o ciclo boot → listen não travar o top-level await (medido em 2026-09-16:
 * "Detected unsettled top-level await" e o processo saía sem escutar).
 *
 * `GET /metrics` na RAIZ — definido em 2026-09-16 (EMENDA-L9 §3, opção a): o Prometheus raspa
 * `/metrics` por convenção e o roteador só casa públicas sob `/api`; a resposta é montada aqui,
 * antes do roteador, e a Rota da L8 continua servindo `/api/metrics`. A tabela ROTAS fica com "/metrics".
 */
/** ADA-226: o nod-windows-x64.exe mais novo (gs://nodbot-downloads, como os .dmg do site). */
export const URL_DO_EXE_WINDOWS = "https://storage.googleapis.com/nodbot-downloads/nod-windows-x64.exe";

export interface OpcoesServidor {
  rotas?: Rota[];
  segredoSessao?: string;
  staticDir?: string;
  autorizarMaquina?: DepsRoteador["autorizarMaquina"];
  autorizarTokenTurno?: DepsRoteador["autorizarTokenTurno"];
  /** Modo de login (ADR-030). Default `stub`, que só escuta em loopback; o boot SEMPRE passa o do NOD_LOGIN. */
  sessao?: OpcoesSessao;
  /** NOD-345 (ADR-124): com NOD_CONTAS, a sessão revogável, as rotas de conta e o que o modo anuncia. */
  contas?: ContasNaSessao;
  /**
   * definido em 2026-10-04 (ADR-071): quem trata o upgrade de WebSocket (os canais da ligação por voz), com a mesma
   * resolução de sessão do roteador. Sem isto, nenhum upgrade é aceito.
   */
  upgrade?: (server: Server, resolverEscopo: (req: IncomingMessage) => Escopo | null | Promise<Escopo | null>) => void;
  /**
   * definido em 2026-10-05 (NOD-175), revisto em 2026-10-15 (NOD-267): a verificação do `/api/saude` (o `select 1` com
   * prazo e, no compartilhado, o batimento dos laços), a mesma que o watchdog usa — o boot passa a de
   * `criarVerificacaoSaude`. Sem isto, a saúde responde 200 sem olhar o banco.
   */
  verificarSaude?: VerificacaoSaude;
  /**
   * definido em 2026-10-22 (NOD-218): pronto/ativa/drenando/cor deste processo. Com isto, `/api/saude` dá 503 no boot e na
   * drenagem e `/api/saude/lb` (o health check do Caddy) só dá 200 na cor ativa. Sem isto, `/api/saude/lb` responde
   * como se o processo fosse a única cor, pronta.
   */
  estadoSaude?: EstadoSaude;
}

export function criarServidor(opcoes: OpcoesServidor = {}) {
  const opcoesSessao = opcoes.sessao ?? { modo: "stub" };
  const sessao = criarSessao(segredoEfetivo(opcoesSessao.modo, opcoes.segredoSessao ?? process.env.NOD_SESSAO_SEGREDO), opcoesSessao, opcoes.contas);
  const estadoLb: EstadoSaude = opcoes.estadoSaude ?? { pronto: () => true, ativa: () => true, drenando: () => false, cor: null };
  const rotas: Rota[] = [criarRotaSaude(opcoes.verificarSaude, opcoes.estadoSaude), criarRotaSaudeLb(opcoes.verificarSaude, estadoLb), ...sessao.rotas, ...(opcoes.rotas ?? [])];
  const roteador = criarRoteador(rotas, {
    resolverEscopo: sessao.resolverEscopo,
    autorizarTokenTurno: opcoes.autorizarTokenTurno,
    autorizarMaquina: opcoes.autorizarMaquina,
    fallback: criarEstatico(opcoes.staticDir ?? process.env.NOD_STATIC_DIR),
  });
  const server = createServer((req, res) => {
    // ADR-090: `curl -fsSL https://<nod>/motor | sh` — o endereço curto do script de instalação do motor (o -L segue).
    // ADR-102: `/motor?convite=…` leva o convite junto (só o formato dele; qualquer outra coisa some).
    const caminhoMotor = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && (caminhoMotor === "/motor" || caminhoMotor === "/motor/")) {
      // NOD-94: `/motor?papel=computador` (a máquina só computador) passa adiante; qualquer outro papel some.
      const busca = new URL(req.url ?? "/", "http://x").searchParams;
      const convite = busca.get("convite");
      const params = new URLSearchParams();
      if (conviteValido(convite)) params.set("convite", convite);
      if (papelDoScript(busca.get("papel"))) params.set("papel", "computador");
      const query = params.toString();
      res.writeHead(302, { location: `/api/motor/instalar${query ? `?${query}` : ""}`, "cache-control": "no-store" });
      res.end();
      return;
    }
    // ADR-151 (ADA-32): `irm https://<nod>/windows | iex` — o endereço curto do PowerShell (o irm segue o 302). Só o convite passa.
    if (req.method === "GET" && (caminhoMotor === "/windows" || caminhoMotor === "/windows/")) {
      const convite = new URL(req.url ?? "/", "http://x").searchParams.get("convite");
      const query = conviteValido(convite) ? `?${new URLSearchParams({ convite }).toString()}` : "";
      res.writeHead(302, { location: `/api/motor/instalar-windows${query}`, "cache-control": "no-store" });
      res.end();
      return;
    }
    // ADA-226: o link fixo do instalador do Windows (o .exe público fica no mesmo bucket dos .dmg; a release é privada).
    if ((req.method === "GET" || req.method === "HEAD") && (caminhoMotor === "/download/windows" || caminhoMotor === "/download/windows/")) {
      res.writeHead(302, { location: URL_DO_EXE_WINDOWS, "cache-control": "no-store" });
      res.end();
      return;
    }
    if (req.method === "GET" && (req.url === "/metrics"|| req.url?.startsWith("/metrics?"))) {
      responderMetricas(res);
      return;
    }
    roteador(req, res);
  });
  opcoes.upgrade?.(server, sessao.resolverEscopo);
  return server;
}

/**
 * definido em 2026-10-05: ao fechar, as conexões ociosas caem na hora e as ativas ganham este tempo para terminar o
 * pedido em curso. A drenagem (boot.ts) já esperou o que importa (ligações e turnos com token vivo); o que sobra são
 * long-polls e SSE, que o cliente refaz.
 */
export const ESPERA_CONEXOES_ATIVAS_MS = 5_000;

export function listen(
  port = Number(process.env.NOD_API_PORT ?? 8888),
  host = process.env.NOD_HOST ?? "127.0.0.1",
  opcoes: OpcoesServidor = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  // ADR-030 (E1.5/E1.6): o login de desenvolvimento só escuta em loopback; o login real exige segredo forte.
  exigirConfiguracaoSegura({ modo: opcoes.sessao?.modo ?? "stub", host, segredo: opcoes.segredoSessao ?? process.env.NOD_SESSAO_SEGREDO });
  const server = criarServidor(opcoes);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      log("info", "http_escutando", { host, porta: p });
      resolve({
        port: p,
        close: () =>
          new Promise((r, j) => {
            server.close((e) => (e ? j(e) : r()));
            // medido em produção em 2026-10-05: `close` só para de escutar. As conexões keep-alive do Caddy ficavam
            // abertas, o processo não saía (nenhum `nod_encerrado` no log) e o compose o matava no SIGKILL 5 min depois
            // da drenagem, enquanto pedidos antigos ainda entravam por essas conexões e os novos eram recusados.
            server.closeIdleConnections();
            setTimeout(() => server.closeAllConnections(), ESPERA_CONEXOES_ATIVAS_MS).unref();
          }),
      });
    });
  });
}

