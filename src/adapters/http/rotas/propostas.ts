import type { RespostaMutacao } from "../../../contracts/api.ts";
import { erroPerfilMudou } from "../../../use-cases/confirmar-perfil.ts";
import { confirmarProposta } from "../../../use-cases/confirmar-proposta.ts";
import { recusarPropostaPelaConversa } from "../../../use-cases/decidir-acesso.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** Propostas (E1.1): confirmar aplica (perfil/rotina/acesso); recusar deixa de lado. Nada antes daqui. */
export function criarRotasPropostas(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "POST", acao: "cartoes.confirmar_proposta",
      padrao: new RegExp(`^/propostas/${ID}/confirmar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, confirmarProposta, { propostaId: ctx.params.id ?? "", prazoMs: d.prazoDecisaoMs });
        // NOD-190: o perfil mudou depois do card — o caso recusou e avisou sem lançar, e a tx já commitou; o erro sai agora.
        if (r.obsoleta) throw erroPerfilMudou();
        const ids: Record<string, string> = { proposta: r.proposta.id };
        if (r.agente) ids.agente = r.agente.id;
        if (r.rotina) ids.rotina = r.rotina.id;
        if (r.decisao) ids.decisao = r.decisao.id;
        const resposta: RespostaMutacao = { ok: true, ids };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST", acao: "cartoes.recusar_proposta",
      padrao: new RegExp(`^/propostas/${ID}/recusar$`),
      async handler(ctx) {
        // NOD-202: o card de acesso com a decisão aberta em "Sua vez" recusa pelo caminho da decisão (decidirAcesso),
        // que fecha a decisão, as gêmeas e solta a task; os outros cards seguem o recusarProposta de sempre.
        const r = await executar(ctx.escopo, recusarPropostaPelaConversa, { propostaId: ctx.params.id ?? "", executor: d.executor ?? "catcher" });
        const ids: Record<string, string> = { proposta: r.proposta.id };
        if (r.decisao) ids.decisao = r.decisao.id;
        const resposta: RespostaMutacao = { ok: true, ids };
        ctx.json(200, resposta);
      },
    },
  ];
}
