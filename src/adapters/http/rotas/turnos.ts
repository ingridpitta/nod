import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { Turno } from "../../../contracts/turno.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { cancelarTurno } from "../../../use-cases/cancelar-turno.ts";
import { retomarTurno } from "../../../use-cases/retomar-turno.ts";
import type { CasoDeUso } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

const lerTurno: CasoDeUso<{ turnoId: string }, { turno: Turno }> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno) throw new ErroDeDominio("nao_encontrado");
  return { data: { turno } };
};

/**
 * Turnos (lane L6). A tabela ROTAS não tem rota própria de turno: a retomada pela decisão é
 * `POST decisoes/:id/retomar` (L9, compõe retomarTurno). Estas duas são de APOIO — definido em
 * 2026-09-16: `GET turnos/:id` (estado com motivo, para a web e o e2e) e `POST turnos/:id/retomar
 * {texto}` (retomada direta por turno, sem decisão) — e ficam registradas como acréscimo à tabela.
 */
export function criarRotasTurnos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: new RegExp(`^/turnos/${ID}$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerTurno, { turnoId: ctx.params.id ?? "" }));
      },
    },
    {
      // definido em 2026-09-24: cancelar UMA mensagem da fila (o Cancelar embaixo dela); o Parar continua parando tudo.
      metodo: "POST", acao: "turnos.cancelar",
      padrao: new RegExp(`^/turnos/${ID}/cancelar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, cancelarTurno, { turnoId: ctx.params.id ?? "" });
        const resposta: RespostaMutacao = { ok: true, ids: { turno: r.turno.id } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST", acao: "turnos.retomar",
      padrao: new RegExp(`^/turnos/${ID}/retomar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, retomarTurno, { turnoId: ctx.params.id ?? "", texto: texto(corpo.texto), prazoMs: d.prazoDecisaoMs, executor: d.executor });
        const resposta: RespostaMutacao = { ok: true, ids: { turno: r.turno.id, retomaTurno: r.original.id, mensagem: r.mensagem.id } };
        ctx.json(201, resposta);
      },
    },
  ];
}
