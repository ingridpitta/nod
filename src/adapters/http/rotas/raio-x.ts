import { exibirDoQuadro, fecharAviso, gravarPreferencias, lerPreferencias, raioXDaConversa, raioXDoTurno } from "../../../use-cases/raio-x.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";
const UM_DIA_MS = 86_400_000;

/**
 * Modo dev (definido em 2026-09-28, 0036): a preferência da pessoa e o Raio-X dos turnos. Tudo escopado e privado:
 * a linha de turno_raio_x é da pessoa dona do turno, e o RLS esconde o resto.
 */
export function criarRotasRaioX(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  const agora = d.agora ?? (() => Date.now());
  return [
    {
      metodo: "GET",
      padrao: /^\/preferencias$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerPreferencias, {}));
      },
    },
    {
      metodo: "PUT", acao: "preferencias.salvar",
      padrao: /^\/preferencias$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const gravado = await executar(ctx.escopo, gravarPreferencias, { modoDev: corpo.modoDev, usoDoMac: corpo.usoDoMac, ordemIas: corpo.ordemIas, experimentos: corpo.experimentos });
        // ADR-085: já gravado (a tx fechou) — o puxar relê o "uso do Mac" agora, sem esperar os 30 s do cache.
        if (corpo.usoDoMac !== undefined) d.services.trabalhosVivos?.trocouUsoDoMac?.(ctx.escopo.pessoaId);
        ctx.json(200, gravado);
      },
    },
    {
      // definido em 2026-10-06 (0059): o aviso fechado fica com a pessoa, não no navegador (o app do Mac limpa o dele).
      metodo: "POST", acao: "preferencias.fechar_aviso",
      padrao: /^\/preferencias\/avisos-fechados$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, fecharAviso, { chave: corpo.chave }));
      },
    },
    {
      // NOD-460 (0149): o Exibir do quadro em tela cheia, da pessoa e por quadro (o id na URL).
      metodo: "PUT", acao: "preferencias.exibir_quadro",
      padrao: new RegExp(`^/preferencias/quadros/${ID}/exibir$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, exibirDoQuadro, { quadroId: ctx.params.id ?? "", recolhidas: corpo.recolhidas, compacto: corpo.compacto, visao: corpo.visao }));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/turnos/${ID}/raio-x$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, raioXDoTurno, { turnoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/conversas/${ID}/raio-x$`),
      async handler(ctx) {
        const bruto = Number(new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("desde"));
        // Sem `desde` (ou inválido): as últimas 24 h.
        const desde = Number.isSafeInteger(bruto) && bruto > 0 ? bruto : agora() - UM_DIA_MS;
        ctx.json(200, await executar(ctx.escopo, raioXDaConversa, { conversaId: ctx.params.id ?? "", desde }));
      },
    },
  ];
}
