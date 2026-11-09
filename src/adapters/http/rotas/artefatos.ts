import { ErroDeDominio } from "../../../domain/erro.ts";
import { lerArtefatoDaPessoa, salvarEstadoArtefato } from "../../../use-cases/artefatos.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** Número de versão do path: inteiro positivo; fora disso a versão não existe (404, nunca 22P02/500). */
function versaoDoPath(v: string | undefined): number {
  if (!v || !/^[1-9][0-9]{0,8}$/.test(v)) throw new ErroDeDominio("nao_encontrado", { cause: "versão fora do formato" });
  return Number(v);
}

/**
 * Artefato do nod (ADR-051, lane L6): o card da conversa busca HTML e estado quando aparece (a mensagem
 * só carrega ids) e grava o que a pessoa marcou. Tudo sob a sessão: outra pessoa não vê (RLS, 404).
 * O HTML sai como JSON, nunca como página desta origem — quem o renderiza é o iframe sandbox da web.
 */
export function criarRotasArtefatos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: new RegExp(`^/artefatos/${ID}$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerArtefatoDaPessoa, { artefatoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/artefatos/${ID}/versoes/(?<versao>[^/]+)$`),
      async handler(ctx) {
        const versao = versaoDoPath(ctx.params.versao);
        ctx.json(200, await executar(ctx.escopo, lerArtefatoDaPessoa, { artefatoId: ctx.params.id ?? "", versao }));
      },
    },
    {
      metodo: "PUT", acao: "artefatos.salvar_estado",
      padrao: new RegExp(`^/artefatos/${ID}/estado$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, salvarEstadoArtefato, { artefatoId: ctx.params.id ?? "", dados: corpo.dados }));
      },
    },
  ];
}
