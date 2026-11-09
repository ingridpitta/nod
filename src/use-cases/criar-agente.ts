import type { PreferenciaHarness } from "../contracts/harness.ts";
import { validarInteligencia } from "../domain/harness.ts";
import type { Agente, CorAgente, DonoAgente, FormaAgente } from "../contracts/agente.ts";
import type { Conversa } from "../contracts/conversa.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { nomeReservadoAoNod } from "../domain/nod.ts";
import { NOME_INICIAL, nomeDeBoasVindas, proximaCor, proximaForma } from "../domain/proposta-agente.ts";
import { TETO_DESCRICAO_BOT, TETO_NOME_BOT, TETO_TITULO_BOT } from "../contracts/ferramentas-criar-bots.ts";
import { proximaVoz } from "../domain/vozes.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/** EMENDA 17: nome opcional; ausente → 'Novo agente' e o modelo propõe pelo atualizar_perfil. Mora no domínio (criar_bots o recusa). */
export { NOME_INICIAL };

export type EntradaCriarAgente = {
  dono: DonoAgente;
  interativo?: boolean;
  nome?: string;
  modelo?: string;
  harness?: PreferenciaHarness;
  titulo?: string;
  descricao?: string;
  /** definido em 2026-10-04 (ADR-077): o onboarding escolhe o mascote (a guia azul, o bot do modelo); ausente = rodízio. */
  forma?: FormaAgente;
  cor?: CorAgente;
  /** ADR-077: a linha de sistema da conversa nova, no lugar da padrão (a guia do onboarding se apresenta). */
  mensagem?: string;
  /**
   * definido em 2026-10-13 (NOD-210, ADR-104): o bot que criou este (criar_bots). O evento leva `criado_por_agente_id` e
   * a autoria passa a ser desse bot, com a regra `regra:criar_bots` — foi o pedido da pessoa, sem card, que autorizou.
   */
  criadoPorAgenteId?: string;
  /** ADR-104 (revisão do PR #309): o turno de quem criou tinha lido conteúdo de fora (ADR-062); vai no evento, para a auditoria. */
  aposConteudoDeFora?: boolean;
};
export type SaidaCriarAgente = { agente: Agente; conversa: Conversa; mensagem: Mensagem };

/**
 * Criação conversacional (E1.1/E1.2/E1.3): nasce 'Novo agente' com forma/cor por round-robin,
 * visibilidade 'equipe' quando o dono é a empresa (repositório), conversa própria e a mensagem
 * de sistema 'agente-nasceu'. Sem acessos, sem rotina, sem memória — nada é concedido aqui.
 */
export const criarAgente: CasoDeUso<EntradaCriarAgente, SaidaCriarAgente> = async (deps, input) => {
  // ADR-081: "Nod" é o nome do bot fixo; outro bot com esse nome confundiria o pedido por nome (gerir_bots, pedir_a_bot).
  if (typeof input.nome === "string" && nomeReservadoAoNod(input.nome)) throw new ErroDeDominio("entrada_invalida", { cause: "nome reservado ao Nod" });
  return criarAgenteSemReserva(deps, input);
};

/** O criar-agente sem a reserva do nome: só o garantirNod (onboarding.ts) chama, para criar o próprio Nod. */
export const criarAgenteSemReserva: CasoDeUso<EntradaCriarAgente, SaidaCriarAgente> = async (deps, input) => {
  if (input.dono !== "pessoa" && input.dono !== "empresa") throw new ErroDeDominio("entrada_invalida", { cause: "dono" });
  if (input.nome !== undefined && typeof input.nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "nome" });
  validarInteligencia(input.harness ?? "auto", input.modelo ?? "auto");
  const existentes = await deps.repos.agentes.listar({ incluirOcultos: true });
  const nome = (input.nome ?? "").trim() || (input.interativo ? nomeDeBoasVindas(existentes.map((a) => a.nome)) : NOME_INICIAL);
  if (nome.length > TETO_NOME_BOT || (input.titulo !== undefined && typeof input.titulo !== "string") || (input.descricao !== undefined && typeof input.descricao !== "string")) throw new ErroDeDominio("entrada_invalida");
  const titulo = input.titulo?.trim() ?? "";
  const descricao = input.descricao?.trim() ?? "";
  if (titulo.length > TETO_TITULO_BOT || descricao.length > TETO_DESCRICAO_BOT) throw new ErroDeDominio("entrada_invalida");
  const confirmado = nome !== NOME_INICIAL && descricao !== "";
  const agora = deps.agora();

  const forma = input.forma ?? proximaForma(existentes.map((a) => a.forma));
  const cor = input.cor ?? proximaCor(existentes.map((a) => a.cor));

  const criado = await deps.repos.agentes.criar({ nome, titulo, descricao, confirmado, dono: input.dono, forma, cor, modelo: input.modelo ?? "auto", harness: input.harness ?? "auto" });
  if (!criado) throw new ErroDeDominio("estado_invalido", { cause: "agente não criado" });
  // ADR-071: cada bot nasce com a sua voz nas ligações, em rodízio como o mascote (trocável no perfil).
  const agente = (await deps.repos.agentes.definirVoz(criado.id, { voz: proximaVoz(existentes.map((a) => a.voz)) })) ?? criado;
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente.id, visibility: agente.visibility });
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "conversa não criada" });

  const autoria = input.criadoPorAgenteId ? autoriaDoAgente(deps.escopo, input.criadoPorAgenteId, { decididoPor: "regra:criar_bots" }) : autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria: input.interativo ? autoriaDoAgente(deps.escopo, agente.id, { decididoPor: "regra:boas_vindas" }) : autoria,
    kind: input.interativo ? "texto" : "sistema",
    payload: input.interativo ? { kind: "boas_vindas" } : null,
    // Chat limpo (PR 1, decisão 10): a primeira linha da conversa fica no chat; sem ela a conversa nova abre vazia.
    assunto: "agente.criado",
    texto: input.mensagem && !input.interativo ? input.mensagem : input.interativo ? `Oi! Eu sou ${nome}. Acabamos de nos conhecer. Para que você quer minha ajuda? Pode escolher uma opção ou me contar do seu jeito.` : confirmado ? `${nome} está pronto. O perfil que você definiu já está salvo; envie a primeira tarefa.` : redigir("agente-nasceu", agora),
    confianca: "confiavel",
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "mensagem não criada" });

  return {
    data: { agente, conversa, mensagem },
    events: [
      evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: conversa.id, dados: { agente_id: agente.id, acao: "criado", nome: agente.nome, dono: agente.dono, ...(input.criadoPorAgenteId ? { criado_por_agente_id: input.criadoPorAgenteId, apos_conteudo_de_fora: input.aposConteudoDeFora === true } : {}) } }),
      evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, dados: { mensagem_id: mensagem.id, kind: mensagem.kind } }),
    ],
  };
};
