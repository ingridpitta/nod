import type { IncomingMessage } from "node:http";
import { lerPedidoDeCaptura } from "../../../domain/acoes/tela.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import type { Capturador } from "../../tela/capturador-cdp.ts";
import type { Rota } from "../roteador.ts";
import { COOKIE_SESSAO } from "../sessao-cookie.ts";
import { lerCookies } from "../util.ts";

/**
 * `tela.capturar` (NOD-398): o PNG de uma tela do Nod, como a pessoa a veria. Só com NOD_CAPTURA_TELA=1 (dev, CI e
 * efêmero); desligada — produção — responde 503 `indisponivel` sem subir Chrome nenhum.
 *
 * Segurança: o Chrome só abre o próprio servidor pelo loopback (a porta em que ESTE pedido chegou, nunca o Host do
 * pedido) num caminho da lista fechada TELAS_CAPTURAVEIS; leva só o cookie de sessão deste pedido, então vê exatamente o
 * que a pessoa vê.
 */

/**
 * O app logado e desenhado (web/main.ts): o `.app` sem `sem-sessao` (a tela de entrada), a lista de bots já pintada e
 * a conversa carregada (sem o "carregando conversa…"). Sem isso o print podia sair da tela de entrada (sessão
 * inválida), em branco ou no meio do carregamento, e o QA passar.
 */
export const APP_LOGADO = "(() => { const a = document.querySelector('.app'); const s = document.getElementById('sidebar'); return !!a && !a.classList.contains('sem-sessao') && !!s && s.childElementCount > 0 && !document.querySelector('.carregando-conversa') && !document.querySelector('.erro[role=alert]'); })()";

/**
 * O valor do cookie de sessão no cabeçalho Cookie (só ele vai ao Chrome). Lê como a autenticação lê (`lerCookies`: com
 * `nod_sessao` repetido, vale o último), para o Chrome levar a MESMA sessão que autenticou este pedido.
 */
export function cookieDeSessao(cabecalho: string | undefined): string | null {
  return lerCookies({ headers: { cookie: cabecalho } } as IncomingMessage)[COOKIE_SESSAO] || null;
}

export function rotasTela(o: { capturador: Capturador | null }): Rota[] {
  return [
    { metodo: "POST", acao: "tela.capturar", padrao: /^\/tela\/captura$/, async handler(ctx) {
      if (!o.capturador) {
        ctx.json(503, { codigo: "indisponivel", mensagem: "A captura de tela não está ligada neste servidor." });
        return;
      }
      const pedido = lerPedidoDeCaptura(await ctx.corpo());
      if (!pedido) throw new ErroDeDominio("entrada_invalida", { cause: "tela ou largura" });
      const porta = ctx.req.socket.localPort;
      const cookie = cookieDeSessao(ctx.req.headers.cookie);
      // Sem cookie (pedido por token, p.ex.) a tela sairia como a do login: melhor dizer que não dá.
      if (!porta || !cookie) throw new ErroDeDominio("estado_invalido", { cause: "captura sem sessão de cookie" });
      const inicio = Date.now();
      // Quem pediu desistiu (fechou a conexão): a captura para em vez de segurar o Chrome.
      const desistiu = new AbortController();
      const aoFechar = () => { if (!ctx.res.writableEnded) desistiu.abort(); };
      ctx.res.once("close", aoFechar);
      let png: Buffer;
      try {
        png = await o.capturador.capturar({ url: `http://127.0.0.1:${porta}${pedido.caminho}`, largura: pedido.largura, cookies: [{ nome: COOKIE_SESSAO, valor: cookie }], pronto: APP_LOGADO }, desistiu.signal);
      } catch (e) {
        ctx.res.off("close", aoFechar);
        log("aviso", "tela_captura_falhou", { tela: pedido.tela, largura: pedido.largura, motivo: (e as Error).message.slice(0, 200) });
        ctx.json(503, { codigo: "indisponivel", mensagem: "Não deu para capturar a tela agora." });
        return;
      }
      ctx.res.off("close", aoFechar);
      log("info", "tela_capturada", { tela: pedido.tela, largura: pedido.largura, bytes: png.length, ms: Date.now() - inicio });
      ctx.res.writeHead(200, { "content-type": "image/png", "content-length": png.length, "cache-control": "no-store" });
      ctx.res.end(png);
    } },
  ];
}
