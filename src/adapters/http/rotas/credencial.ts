import { ErroDeDominio } from "../../../domain/erro.ts";
import { SLUG_GITHUB } from "../../../contracts/github.ts";
import type { ResultadoSonda } from "../../../contracts/servicos.ts";
import { log } from "../../../obs/log.ts";
import { aoConectarApp } from "../../../use-cases/ao-conectar-app.ts";
import { guardarTokenGithub } from "../../../use-cases/conectar-github.ts";
import { chaveCandidataDoConector, fecharPedidoDeCredencial, gravarChaveCandidata, pedidoDeCredencialAberto, sondarChaveCandidata, valorDeCredencial } from "../../../use-cases/guardar-credencial.ts";
import { conectorPublico } from "../../../use-cases/registrar-conector.ts";
import type { Rota } from "../roteador.ts";
import { executar } from "./dentro-de-tx.ts";
import type { OpcoesRotasMarketplace } from "./marketplace.ts";
import { conferirChaveComposio, conferirTokenGithub } from "./segredos-de-app.ts";

/**
 * POST /propostas/:id/credencial {valor} (definido em 2026-10-28, NOD-50): o campo do cartão de credencial manda o valor
 * DIRETO ao cofre, pelos caminhos atuais de cada alvo:
 *   - conector: sonda (fora de tx) o env com só a chave pedida trocada e, se passar, grava (compare-and-set), habilita
 *     (aoConectarApp) e fecha o cartão numa tx; se a sonda reprovar, nada foi gravado, o cartão continua aberto e a resposta diz a
 *     causa: integracao_autenticacao (chave recusada) ou conector_indisponivel (serviço fora);
 *   - github_token: o GitHub confere o token antes (GET /user); grava, sonda fora de tx e habilita + fecha numa segunda tx
 *     (a sonda que falha fecha como guardada com `nao_habilitado`);
 *   - composio: o Composio valida a chave antes; grava só se o time ainda não tem chave e fecha na mesma tx.
 * O corpo não é logado (roteador), o valor não entra em erro nem em evento, e a resposta não o devolve.
 */
export function rotasCredencial(op: OpcoesRotasMarketplace): Rota[] {
  return [
    { metodo: "POST", acao: "cartoes.guardar_credencial", padrao: /^\/propostas\/(?<id>[0-9a-f-]{36})\/credencial$/, async handler(ctx) {
      const propostaId = ctx.params.id ?? "";
      const body = await ctx.corpo() as { valor?: unknown } | null;
      const valor = valorDeCredencial(body?.valor);
      const { payload } = await op.dentro(ctx.escopo, (d) => executar(d, pedidoDeCredencialAberto, { propostaId }));

      if (payload.alvo === "github_token") {
        const token = await conferirTokenGithub(valor, op);
        // Revisão 9: o mesmo formato do alvo conector — grava (tx1), sonda FORA de tx (não segura a proposta travada nem o
        // pool) e habilita + fecha na tx2, sem engolir erro no meio (ao-conectar-app.ts). A retomada nasce com o conector já
        // habilitado, ou ouve que não foi (nao_habilitado): o GitHub já aceitou o token, então a sonda que falha não segura o
        // cartão (ADR-029: a tela de apps mostra a falha). Se a tx2 cair, o token fica gravado com o cartão aberto e guardar de
        // novo só o regrava.
        const { servicos, conector } = await op.dentro(ctx.escopo, async (d) => {
          await executar(d, pedidoDeCredencialAberto, { propostaId });
          const g = await guardarTokenGithub(d, { token, cifrar: op.cifrar, decifrar: op.decifrar });
          const c = await d.repos.conectores.buscar(g.id);
          if (!c) throw new ErroDeDominio("nao_encontrado", { cause: "conector do GitHub" });
          return { servicos: d.services, conector: conectorPublico(c) };
        });
        const sonda: ResultadoSonda = await servicos.conectores.sondar(conector).catch((e: unknown) => {
          log("aviso", "credencial_github_sonda_falhou", { erro: e instanceof ErroDeDominio ? e.codigo : "inesperado" });
          return { ok: false, motivo: "falha_tecnica" } as const;
        });
        await op.dentro(ctx.escopo, async (d) => {
          await executar(d, pedidoDeCredencialAberto, { propostaId });
          const agora = d.agora();
          await d.repos.conectores.registrarSonda(conector.id, sonda.ok ? { ok: true, catalogo: sonda.ferramentas, agora } : { ok: false, motivo: sonda.motivo, agora, ...(sonda.causa ? { causa: sonda.causa } : {}) });
          if (sonda.ok) await executar(d, aoConectarApp, { slug: SLUG_GITHUB });
          await executar(d, fecharPedidoDeCredencial, { propostaId, resultado: "guardada", ...(sonda.ok ? {} : { detalhe: "nao_habilitado" as const }) });
        });
        ctx.json(200, { estado: "guardada" });
        return;
      }

      if (payload.alvo === "composio") {
        const chave = await conferirChaveComposio(valor, op.fetchImpl);
        await op.dentro(ctx.escopo, async (d) => {
          await executar(d, pedidoDeCredencialAberto, { propostaId });
          // Se alguém configurou no meio, este não a troca; o time tem chave, então o cartão fecha como guardada (revisão 4).
          const gravou = await d.repos.composio.salvarChaveSeAusente(op.cifrar(chave));
          await executar(d, fecharPedidoDeCredencial, { propostaId, resultado: "guardada", ...(gravou ? {} : { detalhe: "ja_havia" as const }) });
        });
        ctx.json(200, { estado: "guardada" });
        return;
      }

      // Alvo 'conector': a candidata numa tx curta, a sonda FORA de tx (não segura a proposta travada nem o pool), e a
      // gravação (compare-and-set), a habilitação e o fechamento numa segunda tx que confere de novo o cartão aberto.
      const { servicos, candidata } = await op.dentro(ctx.escopo, async (d) => {
        await executar(d, pedidoDeCredencialAberto, { propostaId });
        return { servicos: d.services, candidata: await executar(d, chaveCandidataDoConector, { conectorId: payload.conectorId ?? "", chave: payload.chave ?? "", valor, decifrar: op.decifrar }) };
      });
      const sonda = await sondarChaveCandidata(servicos.conectores, candidata);
      if (!sonda.ok) {
        throw sonda.causa === "acesso_recusado"
          ? new ErroDeDominio("integracao_autenticacao", { cause: "a sonda recusou a chave nova" })
          : new ErroDeDominio("conector_indisponivel", { cause: "a sonda não alcançou o conector" });
      }
      await op.dentro(ctx.escopo, async (d) => {
        await executar(d, pedidoDeCredencialAberto, { propostaId });
        const { slug } = await executar(d, gravarChaveCandidata, { candidata, ferramentas: sonda.ferramentas, cifrar: op.cifrar });
        await executar(d, aoConectarApp, { slug });
        await executar(d, fecharPedidoDeCredencial, { propostaId, resultado: "guardada", detalhe: candidata.conector.transporte === "http" ? "aceita" : "nao_testada" });
      });
      // Commitada a chave nova: um cliente que outro turno subiu durante a sonda ainda tem a velha (revisão 3 do PR #553).
      try {
        await servicos.conectores.descartar?.(candidata.conector.id);
      } catch (e) {
        log("aviso", "credencial_descartar_falhou", { erro: e instanceof ErroDeDominio ? e.codigo : "inesperado" });
      }
      ctx.json(200, { estado: "guardada" });
    } },
  ];
}
