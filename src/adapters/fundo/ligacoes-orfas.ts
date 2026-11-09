import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Db, Relogio } from "../../shared/types.ts";
import { encerrarLigacao } from "../../use-cases/ligacoes.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/**
 * definido em 2026-10-22 (NOD-218, deploy azul/verde): fecha como `reinicio_servidor` as ligações vivas abertas por uma
 * cor que saiu (`ligacoes.instancia`). O orquestrador delas morava na memória do processo que parou; a cor que ficou não
 * as conhece e o boot dela só fecha as da própria cor. O deploy.sh roda isto depois do `docker stop` da cor velha
 * (`scripts/ligacoes-orfas.ts --instancia <cor>`). `semInstancia` (a transição do `nod` legado) inclui as de instância
 * nula, abertas pela imagem anterior ao azul/verde.
 *
 * O caso de uso só lê repos, escopo e relógio: services e useCases ficam de fora (acessar um deles é erro de programação).
 */
export async function encerrarLigacoesOrfas(
  db: Db,
  o: { instancia: string; semInstancia?: boolean; agora?: Relogio; listarPessoas?: OpcoesLaco["listarPessoas"] },
): Promise<{ encerradas: string[] }> {
  const agora = o.agora ?? (() => Date.now());
  const encerradas: string[] = [];
  const indisponivel = (nome: string) =>
    new Proxy({}, { get: (_alvo, chave) => { throw new Error(`ligacoes-orfas: ${nome}.${String(chave)} indisponível fora do servidor`); } });
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      await tx(async (trx) => {
        const repos = criarRepos(trx, escopo);
        const deps: Deps = { repos, escopo, agora, tx: (fn) => fn(trx), services: indisponivel("services") as Services, useCases: indisponivel("useCases") as UseCasesNod };
        for (const l of await repos.ligacoes.vivas({ instancia: o.instancia, semInstancia: o.semInstancia })) {
          const r = await encerrarLigacao(deps, { ligacaoId: l.id, motivo: "reinicio_servidor" });
          if (r.events?.length) await repos.events.gravarComOutbox(r.events);
          encerradas.push(l.id);
        }
      });
    },
    { listarPessoas: o.listarPessoas, aoFalhar: (_escopo, erro) => { throw erro; } },
  );
  log("info", "ligacoes_orfas_encerradas", { instancia: o.instancia, sem_instancia: Boolean(o.semInstancia), n: encerradas.length });
  return { encerradas };
}
