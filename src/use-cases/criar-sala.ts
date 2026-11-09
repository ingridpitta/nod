import { randomUUID } from "node:crypto";
import type { Conversa } from "../contracts/conversa.ts";
import type { MembroSala, Sala } from "../contracts/sala.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { SALA_MAX, SALA_MIN } from "../shared/constantes.ts";
import { agenteVisivel, autoriaPessoa, evento } from "./apoio-l7.ts";
import type { CasoDeUso } from "./tipos.ts";

export type SaidaCriarSala = { sala: Sala; conversa: Conversa; membros: MembroSala[] };

/**
 * Sala de 2 a 6 bots (Grok Bot, ADR-027): visibility privada, política 'lead' (E12.1: nasce com um
 * responsável, não com todos), lead = primeiro da lista. Sala, conversa tipo 'sala' e os grants de
 * leitura ao DONO de cada bot (sala_membros.pessoa_leitora_id) nascem na MESMA transação — a FK
 * cíclica sala ↔ conversa é deferida na 0002. Um bot só entra se a pessoa o enxerga (RLS de agentes):
 * bot privado de outra pessoa é nao_encontrado, bot de empresa ('equipe') entra e o dono dele ganha
 * leitura do log inteiro. Nesta rodada todos os turnos da sala rodam na máquina de quem a abriu
 * (core-features §2), e são dela a cota e a autoria composta (ADR-025).
 */
export const criarSala: CasoDeUso<{ nome: string; agenteIds: string[] }, SaidaCriarSala> = async (deps, input) => {
  const nome = input.nome.trim();
  if (nome === "") throw new ErroDeDominio("texto_vazio", { cause: "nome da sala" });
  const ids = [...new Set(input.agenteIds)];
  if (ids.length < SALA_MIN || ids.length > SALA_MAX) throw new ErroDeDominio("sala_tamanho", { cause: `${ids.length} bots` });
  const agentes = [];
  for (const id of ids) agentes.push(await agenteVisivel(deps.repos, id));

  const salaId = randomUUID();
  const conversa = await deps.repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId });
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "conversa da sala não criada" });
  const criada = await deps.repos.salas.criarComMembros(
    { id: salaId, nome, conversaId: conversa.id, politica: "lead", leadAgenteId: agentes[0]?.id ?? null },
    agentes.map((a) => ({ agenteId: a.id, pessoaLeitoraId: a.ownerId })),
  );
  if (!criada) throw new ErroDeDominio("estado_invalido", { cause: "sala não criada" });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  const nomes = agentes.map((a) => a.nome).join(", ");
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria,
    kind: "sistema",
    assunto: "sala.evento",
    texto: `Sala "${nome}" criada com ${nomes}. Sem menção, ${agentes[0]?.nome ?? "o primeiro bot"} responde; @Nome dirige a pergunta.`,
    confianca: "confiavel",
  });
  return {
    data: { sala: criada.sala, conversa, membros: criada.membros },
    events: mensagem ? [evento(deps, "mensagem_criada", autoria, { mensagemId: mensagem.id, kind: "sistema", salaId }, { conversaId: conversa.id })] : [],
  };
};
