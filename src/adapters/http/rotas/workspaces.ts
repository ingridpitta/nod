import type { WorkspaceDto } from "../../../contracts/workspace.ts";
import type { Workspaces } from "../../fundo/workspaces.ts";
import type { Rota } from "../roteador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { retomarAposPasta } from "../../../use-cases/retomar-apos-pasta.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

export function rotasWorkspaces(w?: Workspaces, dentro?: DentroDeTx): Rota[] {
  return [
    /**
     * Permitir em um clique: concede a pasta proposta e retoma o turno que a pediu, para a pessoa
     * não precisar remandar a mensagem. Conceder continua sendo ato dela — o modelo só propôs.
     */
    { metodo: "POST", acao: "cartoes.permitir_pasta", padrao: /^\/propostas\/(?<id>[^/]+)\/permitir-pasta$/, async handler(c) {
      if (!w || !dentro) throw new ErroDeDominio("nao_permitido");
      const b = await c.corpo() as { pasta?: unknown };
      if (typeof b?.pasta !== "string") throw new ErroDeDominio("entrada_invalida");
      const pasta: string = b.pasta;
      const proposta = await dentro(c.escopo, (deps) => deps.repos.propostas.buscar(c.params.id!));
      if (!proposta || proposta.payload.kind !== "pasta") throw new ErroDeDominio("nao_encontrado");
      if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
      const candidatas = proposta.payload.candidatas.map((x) => x.caminho);
      // Só um caminho que a própria busca ofereceu: a proposta não vira porta para uma pasta qualquer.
      if (candidatas.length > 0 && !candidatas.includes(pasta)) throw new ErroDeDominio("nao_permitido");
      // definido em 2026-09-25: o registro e a retomada citam a pasta CONCEDIDA (canônica, como escolher a
      // resolveu), não o texto cru do corpo — sem candidatas, "a/../.." chegaria assim à conversa.
      const { projeto } = await w.escolher(c.escopo, proposta.conversaId, pasta);
      const r = await dentro(c.escopo, (deps) => executar(deps, retomarAposPasta, { proposta, pasta: projeto.pasta }));
      c.json(200, { ok: true, ids: { proposta: proposta.id, ...(r.turnoId ? { turnoRetomada: r.turnoId } : {}) } });
    } },
    { metodo: "GET", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace$/, async handler(c) {
      // Tipado pelo contrato que a web lê: mudar o formato aqui sem mudar lá não compila.
      const corpo: WorkspaceDto = { disponivel: Boolean(w), vinculo: w ? await w.consultar(c.escopo, c.params.id!) : null };
      c.json(200, corpo);
    } },
    { metodo: "POST", acao: "conversas.criar_pasta", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace\/pastas$/, async handler(c) {
      if (!w) throw new ErroDeDominio("nao_permitido");
      const b = await c.corpo() as { caminho?: unknown };
      if (b?.caminho !== undefined && typeof b.caminho !== "string") throw new ErroDeDominio("entrada_invalida");
      c.json(200, await w.listar(c.escopo, c.params.id!, b?.caminho));
    } },
    { metodo: "POST", acao: "conversas.definir_pasta", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace$/, async handler(c) {
      if (!w) throw new ErroDeDominio("nao_permitido");
      const b = await c.corpo() as { pasta?: unknown };
      if (typeof b?.pasta !== "string") throw new ErroDeDominio("entrada_invalida");
      c.json(200, await w.escolher(c.escopo, c.params.id!, b.pasta));
    } },
    { metodo: "DELETE", acao: "conversas.tirar_pasta", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace$/, async handler(c) { if (!w) throw new ErroDeDominio("nao_permitido"); await w.revogar(c.escopo, c.params.id!); c.json(200, { ok: true }); } },
  ];
}
