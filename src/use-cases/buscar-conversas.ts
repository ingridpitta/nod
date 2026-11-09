import type { OndeDaFala } from "../contracts/ferramentas-conversas.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { LinhaDoBot } from "../repositories/mensagens.repo.ts";
import { codificarCursor } from "../domain/biblioteca.ts";
import { termoDaBusca, trechoEmVolta } from "../domain/busca-mensagens.ts";
import { cursorDoAntesDe, falaCortada, JANELA_LER_CONVERSA, LIMITE_BUSCAR_CONVERSAS, TETO_FALA_LER_CONVERSA, TRECHO_BUSCAR_CONVERSAS, vizinhasDaJanela } from "../domain/conversas-passadas.ts";
import type { Deps } from "./tipos.ts";

/**
 * NOD-61: buscar_conversas e ler_conversa. Só leitura, só nas conversas do bot do turno (o recorte é do repo,
 * daConversaDoBot); o proxy recebe o resultado como NÃO confiável (chamar-ferramenta.ts, ADR-026).
 */

/** "você" quando a fala é do próprio bot; senão o nome do autor, ou o tipo quando a RLS não mostra o nome. */
function autor(l: LinhaDoBot, agenteId: string): string {
  if (l.autor_tipo === "agente" && l.autor_id === agenteId) return "você";
  return l.autor_nome ?? (l.autor_tipo === "agente" ? "outro bot" : "pessoa");
}

function onde(tipo: "propria" | "sala" | undefined, salaNome: string | null | undefined): OndeDaFala {
  return tipo === "sala" ? { tipo: "sala", nome: salaNome ?? "sala" } : { tipo: "conversa" };
}

/**
 * Revisão do PR #594 (M1, ADR-026/062/066): reler uma fala não confiável (resposta de colega, conteúdo de fora) marca o turno
 * como ler o app de fora marcaria — a página lida não se lava por ter passado pelo histórico.
 */
async function marcarSeDeFora(deps: Deps, turnoId: string, linhas: readonly LinhaDoBot[]): Promise<void> {
  if (linhas.some((l) => l.confianca !== "confiavel")) await deps.repos.turnos.contaminar(turnoId, deps.agora());
}

/** O turno do pedido (uuid): sua entrada e suas falas não voltam como resultado da busca (QA, bug 4). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** O a_partir_de que o banco aceita: até o maior inteiro do Postgres (a fala tem no máximo 1 MB). */
const l0 = (n: number) => Math.min(n, 2_000_000_000);

export const buscarConversas: CasoNod<Deps, "buscar_conversas"> = async (deps, input) => {
  const termo = termoDaBusca(input.termo);
  if (termo === null) return { data: { erro: "termo_invalido" } };
  const antes = input.antes_de === undefined ? null : cursorDoAntesDe(input.antes_de);
  if (input.antes_de !== undefined && antes === null) return { data: { erro: "antes_de_invalido" } };
  const limite = Math.min(Math.max(1, Math.trunc(input.limite ?? LIMITE_BUSCAR_CONVERSAS)), LIMITE_BUSCAR_CONVERSAS);
  const r = await deps.repos.mensagens.buscarDoAgente({ agenteId: input.agenteId, conversaDoTurno: input.conversaId, ...(UUID.test(input.turnoId) ? { turnoId: input.turnoId } : {}), termo, antes, limite });
  if (r === "demorou") return { data: { erro: "busca_demorou" } };
  await marcarSeDeFora(deps, input.turnoId, r.linhas);
  const resultados = r.linhas.map((l) => ({
    mensagem_id: l.id,
    quando: l.criado_em_txt,
    autor: autor(l, input.agenteId),
    onde: onde(l.conversa_tipo, l.sala_nome),
    // trechoEmVolta soma até dois "…" ao tamanho: o teto de 300 é do trecho inteiro.
    trecho: trechoEmVolta(l.texto, termo, TRECHO_BUSCAR_CONVERSAS - 2, { inicio: l.cortado_inicio ?? false, fim: l.cortado_fim ?? false }),
  }));
  const u = r.linhas.at(-1);
  return { data: { resultados, mais_antigos: r.temMais && u ? codificarCursor({ criadoEm: u.criado_em_txt, id: u.id }) : null } };
};

export const lerConversa: CasoNod<Deps, "ler_conversa"> = async (deps, input) => {
  // Revisão do PR #594 (A2): com a_partir_de, só a fala pedida, do caractere indicado em diante (o resto de uma fala longa).
  const aPartirDe = Math.max(0, Math.trunc(input.a_partir_de ?? 0));
  const { antes, depois } = aPartirDe > 0 ? { antes: 0, depois: 0 } : vizinhasDaJanela(input.antes, input.depois);
  const pedida = input.mensagem_id.trim().toLowerCase();
  const j = await deps.repos.mensagens.janelaDoAgente({ agenteId: input.agenteId, conversaDoTurno: input.conversaId, mensagemId: pedida, antes, depois, tetoTexto: TETO_FALA_LER_CONVERSA, aPartirDe: l0(aPartirDe) });
  if (!j) return { data: { erro: "nao_encontrado" } };
  // QA (bug 3): o banco traz até `antes` antes e `depois` depois; a janela é de 20 e `antes` tem preferência — o que faltou
  // antes completa depois (as linhas vêm em ordem: antes, a pedida, depois).
  const linhas = j.linhas.slice(0, JANELA_LER_CONVERSA);
  await marcarSeDeFora(deps, input.turnoId, linhas);
  const mensagens = linhas.map((l) => {
    // O banco manda até TETO + 1 caracteres a partir de a_partir_de: passou do teto, falaCortada corta, marca e diz onde continuar.
    const f = falaCortada(l.texto);
    const inicio = l.id === pedida ? aPartirDe : 0;
    return {
      mensagem_id: l.id,
      quando: l.criado_em_txt,
      autor: autor(l, input.agenteId),
      texto: f.texto,
      ...(l.id === pedida ? { pedida: true as const } : {}),
      ...(f.cortada ? { cortada: true as const, continua_de: inicio + TETO_FALA_LER_CONVERSA - 1 } : {}),
    };
  });
  return { data: { onde: onde(j.conversaTipo, j.salaNome), mensagens } };
};
