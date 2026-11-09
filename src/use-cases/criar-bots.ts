import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ArgsCriarBots, ProblemaBotNovo, ResultadoCriarBots } from "../contracts/ferramentas-criar-bots.ts";
import type { ContextoFerramenta, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { linhaDoDesfecho, mensagemDeNascimento, validarBotsNovos } from "../domain/criar-bots.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import { evento } from "./autoria-evento.ts";
import { aplicarPadroes } from "./acoes/acessos.ts";
import { secaoComTime } from "./acoes/times.ts";
import { criarAgente } from "./criar-agente.ts";
import { turnoComAPessoa } from "./nod.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { emSavepoint } from "./savepoint.ts";
import type { Deps } from "./tipos.ts";

/**
 * criar_bots (definido em 2026-10-13, NOD-210, ADR-104): o bot que a pessoa pediu cria bots NOVOS, na hora. Não há card
 * nem decisão e o modo de aprovação de quem pede não é lido: o Matheus, ao aprovar o protótipo, pediu "assim que eu
 * pedir, ele só cria". As cercas que sobram são estas:
 * 1. só num turno do próprio bot, da pessoa dona, em que ela fala com ele (conversa ou criação) — rotina, sala, ligação
 *    e pedido de colega ficam de fora; o Nod tem gerir_bots e não usa esta. revisto em 2026-10-13 (revisão do PR #309):
 *    e o turno não pode ter nascido de conteúdo de fora — entrada não confiável (ADR-026) ou recado de outro bot numa
 *    task (mensagem de origem não confiável) recusa com `sem_pedido_da_pessoa`. O turno aberto pela pessoa que depois
 *    leu a web (ADR-062) cria, como o Matheus decidiu, e a criação leva `apos_conteudo_de_fora` no evento;
 * 2. o pedido inteiro é validado antes, com os nomes TRAVADOS (agentes.travarNomesDeBots) e comparados com todos os
 *    bots que a pessoa vê; qualquer problema e nada é criado, e tudo roda num SAVEPOINT só (um erro no meio volta o lote);
 * 3. o bot novo nasce como qualquer bot criado pela pessoa: sem apps, sem rotinas, sem memória e em Aprovar
 *    automaticamente (criarAgente, MODO_APROVACAO_INICIAL; revisto em 2026-10-20, NOD-316, emenda da ADR-059 §1).
 *    A pessoa muda em Aprovações. Quem pede não muda.
 */

type Criado = { bot_id: string; nome: string; secao: string | null };

const NADA_CRIADO = { problemas: [] as ProblemaBotNovo[] };

export async function criarBots(deps: Deps, input: ContextoFerramenta & ArgsCriarBots): Promise<SaidaCasoDeUso<ResultadoCriarBots>> {
  const portao = await turnoComAPessoa(deps, input, "bot_comum");
  if (!portao) return { data: { ok: false, erro: "fora_da_conversa", ...NADA_CRIADO, instrucao: "criar_bots só vale na conversa com a pessoa. Nada foi criado." } };
  const { agente: quem, turno } = portao;
  // Cerca 1b (revisão do PR #309): o pedido é da pessoa, não de conteúdo de fora. A entrada do turno (ADR-026) e a
  // mensagem que o disparou (o recado de um bot numa task é não confiável) precisam ser dela.
  const origem = turno.mensagemOrigemId ? await deps.repos.mensagens.buscar(turno.mensagemOrigemId) : null;
  if (turno.entradaConfianca !== "confiavel" || input.plano?.confiancaEntrada === "nao_confiavel" || origem?.confianca === "nao_confiavel") {
    log("info", "criar_bots_recusado", { motivo: "sem_pedido_da_pessoa" });
    return { data: { ok: false, erro: "sem_pedido_da_pessoa", ...NADA_CRIADO, instrucao: "Nada foi criado: este turno não nasceu de um pedido da pessoa. Pergunte a ela com pedir_a_pessoa se quer esses bots; só crie quando ela pedir na conversa." } };
  }
  const aposConteudoDeFora = await deps.repos.turnos.contaminado(turno.id);

  // Cerca 2: a trava dos nomes antes de ler — dois pedidos juntos não criam o mesmo nome (o segundo espera e o vê).
  await deps.repos.agentes.travarNomesDeBots();
  // Todos os bots que a pessoa vê, dela e da empresa: pedir_a_bot e gerir_bots resolvem pelo nome no tenant inteiro.
  const existentes = (await deps.repos.agentes.listar({ incluirOcultos: true })).map((b) => b.nome);
  const validado = validarBotsNovos(Array.isArray(input.bots) ? input.bots : [], existentes);
  if (!validado.ok) return { data: { ok: false, erro: "entrada_invalida", problemas: validado.problemas, instrucao: "Nada foi criado. Corrija os problemas e chame criar_bots de novo com o pedido inteiro." } };

  const pessoa = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  const agora = deps.agora();
  const autoria = autoriaDoAgente(deps.escopo, quem.id, { decididoPor: "regra:criar_bots" });
  const secaoDeQuem = quem.secao && quem.secao.trim() !== "" ? quem.secao : null;
  const events: RuntimeEvent[] = [];
  let criados: Criado[];
  try {
    criados = await emSavepoint(deps, async () => {
      const feitos: Criado[] = [];
      for (const b of validado.bots) {
        const r = await criarAgente(deps, {
          dono: "pessoa",
          nome: b.nome,
          titulo: b.titulo,
          descricao: b.descricao,
          criadoPorAgenteId: quem.id,
          aposConteudoDeFora,
          mensagem: mensagemDeNascimento({ nome: b.nome, quem: quem.nome, pessoa, agora, descricao: b.descricao }),
        });
        events.push(...(r.events ?? []));
        // ADA-241: o bot novo nasce com o padrão de cada app que a dona definiu (o mesmo do Criar bot da tela).
        events.push(...(await aplicarPadroes(deps, r.data.agente.id)));
        const pedida = b.secao ?? secaoDeQuem;
        // NOD-437 (revisão 3): o time da seção nasce junto (a barra não fica com time provisório).
        const secao = pedida ? await secaoComTime(deps, pedida) : pedida;
        // A seção com a mesma autoria do nascimento (o bot, pela regra), não a da pessoa como no gerir_agente da tela.
        if (secao && !(await deps.repos.agentes.organizar(r.data.agente.id, { secao }))) throw new ErroDeDominio("estado_invalido", { cause: "seção" });
        if (secao) events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: r.data.conversa.id, dados: { agente_id: r.data.agente.id, acao: "organizar" } }));
        feitos.push({ bot_id: r.data.agente.id, nome: r.data.agente.nome, secao });
      }
      return feitos;
    });
  } catch (e) {
    if (!ehErroDeDominio(e)) throw e;
    log("info", "criar_bots_falhou", { pedidos: validado.bots.length, erro: e.codigo });
    return { data: { ok: false, erro: "nao_deu_para_criar", problemas: [{ i: -1, motivo: `a criação falhou no meio (${e.codigo}) e foi desfeita` }], instrucao: "Nada foi criado: a criação falhou no meio e foi desfeita inteira. Diga à pessoa em uma frase que não deu certo e por quê; não tente de novo no mesmo turno." } };
  }

  const nomes = criados.map((c) => c.nome);
  const msg = await deps.repos.mensagens.criar({ conversaId: input.conversaId, autoria, kind: "sistema", assunto: "bot.criado", texto: linhaDoDesfecho(quem.nome, pessoa, nomes), confianca: "confiavel" });
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
  log("info", "criar_bots", { criados: criados.length, apos_conteudo_de_fora: aposConteudoDeFora });
  return {
    data: {
      ok: true,
      criados,
      instrucao: `Criados agora (${criados.length}), sem card: já estão na barra lateral e você pode passar trabalho a eles com pedir_a_bot. Conte à pessoa em poucas linhas o que criou, com os nomes. Você continua como é: não mude o seu perfil.`,
    },
    events,
  };
}
