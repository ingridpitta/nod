import { POOL_MAX_PADRAO } from "../../../db/client.ts";
import { lerCursor } from "../../../domain/biblioteca.ts";
import { limiteDaBusca, termoDaBusca } from "../../../domain/busca-mensagens.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { buscarMensagens } from "../../../use-cases/buscar-mensagens.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

/**
 * NOD-380: a busca de mensagens do celular. `GET /busca/mensagens?q=<termo>&cursor=<opaco>&limite=<1..20>`, sob a
 * transação escopada da pessoa (a RLS decide o que ela lê). Termo fora de 2..100 caracteres, cursor que este servidor não
 * emitiu ou limite fora de 1..20 → 400 `entrada_invalida`.
 */
/**
 * Sem índice possível sob a RLS (ADR-008, emenda da NOD-380), cada busca varre o tenant por até 4 s segurando uma conexão do
 * pool. O cliente cancela o pedido velho a cada letra, mas a consulta já mandada segue no banco até acabar: no máximo duas em
 * voo por pessoa nesta instância; a terceira recebe 429 `limite_atingido` e a web mostra "Tentar de novo".
 */
export const MAXIMO_BUSCAS_EM_VOO = 2;
/**
 * Revisão 4 do PR #551: o teto por pessoa não protege o pool. No máximo 4 buscas em voo na instância somando todo mundo, e
 * menos com pool pequeno (um terço dele, NOD_DB_POOL_MAX): acima disso, o mesmo 429 (a web repete sozinha), e o envio e os
 * eventos ao vivo não esperam conexão por causa da busca. Revisão 5: e no máximo 3 por tenant, para um tenant grande não
 * ocupar todas as vagas e deixar a busca dos outros em 429; revisão 6: acima das 2 de uma pessoa, para ela sozinha (com
 * as consultas velhas ainda no banco) não deixar os colegas do tenant em 429.
 */
export const MAXIMO_BUSCAS_NA_INSTANCIA = 4;
export const MAXIMO_BUSCAS_POR_TENANT = 3;

export function tetoNaInstancia(poolMax: number): number {
  return Math.max(1, Math.min(MAXIMO_BUSCAS_NA_INSTANCIA, Math.floor(poolMax / 3)));
}

/** Soma e devolve uma vaga num contador por chave. */
function somar(m: Map<string, number>, chave: string, delta: number): void {
  const n = (m.get(chave) ?? 0) + delta;
  if (n <= 0) m.delete(chave);
  else m.set(chave, n);
}

export function criarRotasBusca(d: DepsRotas, o: { poolMax?: number } = {}): Rota[] {
  const executar = criarExecutor(d);
  const teto = tetoNaInstancia(o.poolMax ?? POOL_MAX_PADRAO);
  const porPessoa = new Map<string, number>();
  const porTenant = new Map<string, number>();
  let naInstancia = 0;
  return [
    {
      metodo: "GET",
      padrao: /^\/busca\/mensagens$/,
      async handler(ctx) {
        const q = new URL(ctx.req.url ?? "/", "http://x").searchParams;
        const termo = termoDaBusca(q.get("q"));
        if (termo === null) throw new ErroDeDominio("entrada_invalida", { cause: "busca: termo" });
        const textoCursor = q.get("cursor");
        const antes = textoCursor === null || textoCursor === "" ? null : lerCursor(textoCursor);
        if (textoCursor && !antes) throw new ErroDeDominio("entrada_invalida", { cause: "busca: cursor" });
        const limite = limiteDaBusca(q.get("limite"));
        if (limite === null) throw new ErroDeDominio("entrada_invalida", { cause: "busca: limite" });
        const pessoa = `${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`;
        const tenant = ctx.escopo.tenantId;
        if ((porPessoa.get(pessoa) ?? 0) >= MAXIMO_BUSCAS_EM_VOO) throw new ErroDeDominio("limite_atingido", { cause: "busca: em voo" });
        if ((porTenant.get(tenant) ?? 0) >= MAXIMO_BUSCAS_POR_TENANT) throw new ErroDeDominio("limite_atingido", { cause: "busca: tenant" });
        if (naInstancia >= teto) throw new ErroDeDominio("limite_atingido", { cause: "busca: instância" });
        somar(porPessoa, pessoa, 1);
        somar(porTenant, tenant, 1);
        naInstancia += 1;
        // Revisões 7 e 8: a web aborta o pedido velho a cada letra. O que fechou antes de a consulta sair (esperando conexão)
        // não a manda; a que já foi segue até o fim (no máximo 4 s; cancelar pelo driver dentro da transação prendia a conexão).
        const corte = new AbortController();
        const aoFechar = (): void => {
          if (!ctx.res.writableFinished) corte.abort();
        };
        ctx.res.once("close", aoFechar);
        try {
          ctx.json(200, await executar(ctx.escopo, buscarMensagens, { termo, antes, limite, sinal: corte.signal }));
        } catch (e) {
          // Revisão 8: quem abortou já foi embora (outra letra); o AbortError não é falha da rota nem banco ocupado: sem resposta (o socket fechou) e sem log de erro.
          if (corte.signal.aborted) {
            if (!ctx.res.writableEnded) ctx.res.end();
            return;
          }
          throw e;
        } finally {
          ctx.res.off("close", aoFechar);
          naInstancia -= 1;
          somar(porTenant, tenant, -1);
          somar(porPessoa, pessoa, -1);
        }
      },
    },
  ];
}
