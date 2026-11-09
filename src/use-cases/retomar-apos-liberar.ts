import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O que a pessoa acabou de liberar para o bot, já com o nome que ela lê na tela. */
export type AppLiberado = { nome: string; nivel: "leitura" | "escrita" };

/**
 * definido em 2026-10-05: a mesma janela do cartão (web/telas/card-liberar.ts, JANELA_LIBERAR_MS). O bot só é chamado
 * de volta se a pessoa falou com ele nas últimas 24 h; liberar um app para um bot parado há dias não o acorda para
 * uma conversa que ninguém lembra.
 */
export const JANELA_RETOMADA_APOS_LIBERAR_MS = 86_400_000;

const ROTULO_NIVEL: Record<AppLiberado["nivel"], string> = { leitura: "ler", escrita: "ler e alterar" };

/** A nota do produto que abre o turno: o que foi liberado, por quem, e que nada foi executado. */
export function notaDaLiberacao(apps: readonly AppLiberado[]): string {
  return [
    `Nota do Nod: a pessoa acabou de liberar para você, nesta conversa, ${apps.length === 1 ? "o app" : "os apps"}: ${apps.map((a) => `${a.nome} (${ROTULO_NIVEL[a.nivel]})`).join(", ")}.`,
    "Antes disso o app estava conectado na conta dela, mas você não tinha permissão para usá-lo.",
    "Se você esperava por esse acesso, continue o que estava fazendo. Se não, diga em uma frase o que agora consegue fazer e pergunte por onde começar.",
    "A liberação não executou nenhuma ação. Confira o que já foi feito, não repita envios e preserve as regras de aprovação.",
  ].join("\n");
}

/**
 * definido em 2026-10-05: depois que a pessoa libera apps pelo cartão da conversa, o bot recebe um turno com a nota do
 * produto e segue sozinho — medido no mesmo dia em produção: a pessoa conectou o Gmail e o Slack, escreveu "já liberei"
 * e o bot respondeu que continuava sem acesso. O mecanismo é o de sempre depois de uma decisão (enfileirarRetomada,
 * como retomarAposAcesso): turno NOVO de origem 'retomada' apontando para o último turno que a PESSOA abriu na conversa
 * própria do bot. Sem esse turno, com ele fora da janela, parado pela pessoa ou de um bot excluído, nada é enfileirado:
 * os recibos ficam na conversa e a pessoa escreve quando quiser. Nada é concedido aqui (ADR-044).
 */
export const retomarAposLiberar: CasoDeUso<{ agenteId: string; apps: readonly AppLiberado[] }, { turnoId: string | null }> = async (deps, input) => {
  if (input.apps.length === 0) return { data: { turnoId: null } };
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(input.agenteId);
  if (!conversa) return { data: { turnoId: null } };
  const agora = deps.agora();
  const original = (await deps.repos.turnos.listarDaConversa(conversa.id)).filter((t) => t.agenteId === input.agenteId && t.origem === "conversa").at(-1);
  if (!original || agora - original.criadoEm > JANELA_RETOMADA_APOS_LIBERAR_MS) return { data: { turnoId: null } };
  // Só o Parar freia: liberar um app não desfaz a parada que a pessoa pediu (a do turno, a da conversa ou a geral).
  // `ativa` devolve null quando a consulta falha: fecha, como em despachar-turno.ts.
  if (original.motivoInterrupcao === "parado_pela_pessoa") return { data: { turnoId: null } };
  if ((await deps.repos.paradas.ativa(deps.escopo.pessoaId, null)) !== false || (await deps.repos.paradas.ativa(deps.escopo.pessoaId, conversa.id)) !== false) return { data: { turnoId: null } };
  if (await deps.repos.agentes.execucaoBloqueada(original.id)) return { data: { turnoId: null } };
  const { turno, nova } = await enfileirarRetomada(deps, { original, prazoEm: agora + PRAZO_DECISAO_PADRAO_MS, entradaTexto: notaDaLiberacao(input.apps), reenvios: original.reenvios + 1 });
  return {
    data: { turnoId: turno?.id ?? null },
    events: nova && turno ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo), agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, apps_liberados: input.apps.length } })] : [],
  };
};
