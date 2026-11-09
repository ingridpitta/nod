import { ehPontoDeEntrada } from "../../shared/entrada.ts";
import { log } from "../../obs/log.ts";
import { arquivoDeGruposDoServidor, encerrarGruposOrfaos, type ResultadoDaLimpeza } from "../executor/grupos-orfaos.ts";
import { encerrarFugitivosDaInstancia } from "../executor/fugitivos.ts";
import { homeDaPessoa } from "../executor/caminho.ts";
import { registrarGruposEm } from "../executor/processo.ts";
import { nodHome } from "../executor/registry.ts";
import { boot } from "./boot.ts";

/**
 * Ponto de entrada do servidor (`npm start`, Dockerfile, scripts/dev.mjs): carrega o .env e sobe o
 * app inteiro por boot.ts (partições → compor → listen → registry → laços). `criarServidor`/`listen`
 * moram em servidor.ts e são reexportados daqui para os testes que sobem só o roteador.
 */
export { criarServidor, listen, type OpcoesServidor } from "./servidor.ts";

/** definido em 2026-10-05: teto do `fechar()` depois da drenagem (o compose dá 11 min no total; a drenagem usa até 10). */
const FECHAMENTO_MAX_MS = 30_000;

/**
 * definido em 2026-10-09 (ADR-089): o mesmo sinal repetido dentro desta janela é eco de quem o repassou, não um segundo
 * pedido. O Ctrl+C no terminal chega ao mesmo tempo ao dev.mjs, ao npm e ao tsx, e cada um repassa ao servidor: sem a
 * janela, o eco virava "segundo sinal" e pulava a drenagem. 3 s: sob a carga de 09/10 (load ~430) o repasse pode
 * atrasar; quem aperta de novo para forçar uma drenagem travada já esperou mais que isso.
 */
const ECO_DE_SINAL_MS = 3_000;

/**
 * SIGINT/SIGTERM/SIGHUP: o primeiro chama `encerrar` (a drenagem); o segundo, qualquer um dos três, sai na hora com 130.
 * revisto em 2026-10-08 (revisão do épico #188, X7): antes os ouvintes saíam no primeiro sinal e o segundo caía no
 * padrão do Node, que mata o processo SEM o evento `exit` — e os grupos de processo `detached` dos turnos (processo.ts)
 * ficavam órfãos. `process.exit` roda o `exit`, que os leva. Devolve quem tira os ouvintes (os testes).
 * revisto em 2026-10-09 (ADR-089, #217): o SIGHUP (terminal fechado, sessão que caiu) entra no mesmo caminho. Antes ele
 * caía no padrão do Node e matava sem o `exit` — os religamentos de 08/10 sem `sinal_recebido` no log e os órfãos de
 * 7h30 batem com isso. O mesmo sinal repetido em menos de ECO_DE_SINAL_MS é eco e não conta.
 */
export function ouvirSinaisDeEncerramento(encerrar: (sinal: string) => void, sair: (codigo: number) => void = (codigo) => process.exit(codigo), agora: () => number = Date.now): () => void {
  let primeiro: { sinal: string; em: number } | null = null;
  const ouvinte = (sinal: string) => () => {
    if (primeiro) {
      if (sinal === primeiro.sinal && agora() - primeiro.em < ECO_DE_SINAL_MS) return;
      log("aviso", "segundo_sinal", { sinal });
      sair(130);
      return;
    }
    primeiro = { sinal, em: agora() };
    log("info", "sinal_recebido", { sinal });
    encerrar(sinal);
  };
  const sinais = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const ouvintes = sinais.map((sinal) => [sinal, ouvinte(sinal)] as const);
  for (const [sinal, fn] of ouvintes) process.on(sinal, fn);
  return () => {
    for (const [sinal, fn] of ouvintes) process.removeListener(sinal, fn);
  };
}

if (ehPontoDeEntrada(import.meta.url)) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  // ADR-089: depois do listen e antes de qualquer turno, os grupos que a vida anterior desta instância deixou (SIGKILL,
  // queda) morrem — só os provados nossos pela marca. A cópia duplicada não pega a porta e nem chega aqui.
  const servidor = await boot({
    aposEscutar: async () => {
      const arquivoDeGrupos = arquivoDeGruposDoServidor(nodHome(process.env, homeDaPessoa(process.env)), process.env);
      const limpeza: Pick<ResultadoDaLimpeza, "assumiu" | "herdados"> = await encerrarGruposOrfaos({ arquivo: arquivoDeGrupos }).catch(() => ({ assumiu: true }));
      if (!limpeza.assumiu) return;
      // ADR-097: o que saiu dos grupos com a marca desta instância (o Postgres de teste de uma task) e ficou de outra vida.
      await encerrarFugitivosDaInstancia(arquivoDeGrupos);
      registrarGruposEm(arquivoDeGrupos, limpeza.herdados);
    },
  });
  // SIGTERM e depois Ctrl+C (ou o contrário) também é "segundo sinal".
  ouvirSinaisDeEncerramento(() => {
    // definido em 2026-10-04 (ADR-071), revisto em 2026-10-05 (NOD-175): drenagem — recusa ligação nova, a ponte para de
    // entregar turno novo e espera as ligações e os turnos com token vivo até NOD_DRENAGEM_MAX_MS (padrão 10 min; o
    // compose dá stop_grace_period de 11 min). Sem nada vivo, fecha na hora como antes. Segundo sinal: sai com 130.
    servidor
      .drenar({ prazoMs: Number(process.env.NOD_DRENAGEM_MAX_MS) || 600_000 })
      .then(() => {
        // definido em 2026-10-05 (medido em produção): se o fechamento travar, o processo sai mesmo assim, antes de o
        // compose precisar do SIGKILL. A drenagem já terminou; o que falta fechar não vale um serviço meio no ar.
        setTimeout(() => { log("aviso", "fechamento_demorou", { ms: FECHAMENTO_MAX_MS }); process.exit(1); }, FECHAMENTO_MAX_MS).unref();
        return servidor.fechar();
      })
      .then(() => process.exit(0), () => process.exit(1));
  });
}
