import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { MembroSala, Sala } from "../../../contracts/sala.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { convidarBotParaSala } from "../../../use-cases/convidar-bot-para-sala.ts";
import { criarSala } from "../../../use-cases/criar-sala.ts";
import { pararSala } from "../../../use-cases/parar-sala.ts";
import { postarNaSala } from "../../../use-cases/postar-na-sala.ts";
import type { CasoDeUso } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, executar, texto, uuid, type DepsRotasL7 } from "./rotinas.ts";

export type SalaDto = { sala: Sala; membros: MembroSala[] };

/** GET salas: as da pessoa e as onde ela tem grant (a policy decide); membros = só os grants que ela enxerga. */
const listarSalas: CasoDeUso<Record<string, never>, { salas: SalaDto[] }> = async (deps) => {
  const salas: SalaDto[] = [];
  for (const sala of await deps.repos.salas.listar()) salas.push({ sala, membros: await deps.repos.salas.membros(sala.id) });
  return { data: { salas } };
};

/** Rotas de salas (tabela ROTAS, lane L7): 2–6 bots (400 sala_tamanho), grant na mesma tx (ADR-027). */
export function criarRotasSalas(deps: DepsRotasL7): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/salas$/,
      async handler(ctx) {
        ctx.json(200, await executar(deps, ctx.escopo, listarSalas, {}));
      },
    },
    {
      metodo: "POST", acao: "salas.criar",
      padrao: /^\/salas$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        if (!Array.isArray(corpo.agenteIds)) throw new ErroDeDominio("entrada_invalida", { cause: "agenteIds" });
        const agenteIds = corpo.agenteIds.map((x: unknown) => uuid(x, "agenteIds"));
        const r = await executar(deps, ctx.escopo, criarSala, { nome: typeof corpo.nome === "string" ? corpo.nome : "sala", agenteIds });
        const resposta: RespostaMutacao = { ok: true, ids: { salaId: r.sala.id, conversaId: r.conversa.id } };
        ctx.json(201, resposta);
      },
    },
    {
      metodo: "POST", acao: "salas.adicionar_membro",
      padrao: /^\/salas\/(?<id>[^/]+)\/membros$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(deps, ctx.escopo, convidarBotParaSala, { salaId: uuid(ctx.params.id, "id"), agenteId: uuid(corpo.agenteId, "agenteId") });
        const resposta: RespostaMutacao = { ok: true, ids: { salaId: r.membro.salaId, agenteId: r.membro.agenteId } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST", acao: "salas.enviar",
      padrao: /^\/salas\/(?<id>[^/]+)\/mensagens$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(deps, ctx.escopo, postarNaSala, { salaId: uuid(ctx.params.id, "id"), texto: texto(corpo, "texto") });
        const ids: Record<string, string> = { mensagemId: r.mensagem.id };
        r.turnos.forEach((t, i) => {
          ids[`turnoId${i}`] = t.id;
        });
        if (r.decisaoTeto) ids.decisaoId = r.decisaoTeto;
        const resposta: RespostaMutacao = { ok: true, ids };
        ctx.json(201, resposta);
      },
    },
    {
      metodo: "POST", acao: "salas.parar",
      padrao: /^\/salas\/(?<id>[^/]+)\/parar$/,
      async handler(ctx) {
        ctx.json(200, await executar(deps, ctx.escopo, pararSala, { salaId: uuid(ctx.params.id, "id") }));
      },
    },
  ];
}
