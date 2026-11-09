import { decidirLoteDeBots } from "../../../use-cases/gerir-bots.ts";
import { decidirAssumirQuadro } from "../../../use-cases/assumir-quadro.ts";
import { decidirColunasDoQuadro } from "../../../use-cases/colunas-do-quadro.ts";
import { decidirImportacaoLinear } from "../../../use-cases/importar-linear.ts";
import { EXECUTORES_APPS, RecusaDasPaginas } from "../../../use-cases/acoes/apps.ts";
import { decidirQuadroExclusao } from "../../../use-cases/quadro-exclusao.ts";
import { randomUUID } from "node:crypto";
import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { Decisao } from "../../../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../../../contracts/evento.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Escopo } from "../../../shared/types.ts";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina, erroRotinaMudou } from "../../../use-cases/aplicar-proposta-rotina.ts";
import { erroPerfilMudou } from "../../../use-cases/confirmar-perfil.ts";
import { confirmarProposta } from "../../../use-cases/confirmar-proposta.ts";
import { decidirAcesso } from "../../../use-cases/decidir-acesso.ts";
import { decidirPropostaDeBot } from "../../../use-cases/onboarding.ts";
import { assentarAprovacao, executarItens, marcarEDecidir, retomarPorDecisao, type DesfechoExecutado, type MarcacaoItem } from "../../../use-cases/decidir.ts";
import { liberarNaTarefa } from "../../../use-cases/liberar-na-tarefa.ts";
import { permitirSempre } from "../../../use-cases/permitir-sempre.ts";
import { reciboDaPropostaConfirmada } from "../../../use-cases/proposta-decidida.ts";
import { recusarProposta } from "../../../use-cases/recusar-proposta.ts";
import { autoriaDaPessoa } from "../../../use-cases/registrar-negacao.ts";
import { fecharComResposta, retomarComResposta } from "../../../use-cases/responder-decisao.ts";
import { fecharPedidoDeCredencial } from "../../../use-cases/guardar-credencial.ts";
import { retomarTurno } from "../../../use-cases/retomar-turno.ts";
import type { Deps, Services } from "../../../use-cases/tipos.ts";
import { sincronizarDasDecisoes } from "../../../use-cases/trabalhos.ts";
import { responderErro } from "../erros.ts";
import type { Rota } from "../roteador.ts";
import { executar, textoDoCorpo, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasDecisoes = {
  dentro: DentroDeTx;
  /**
   * definido em 2026-10-04 (ADR-074): aprovação por voz. O orquestrador confere (e gasta) o comando que ele mesmo
   * emitiu ao reconhecer "eu aprovo"/"recuso" na janela; sem o comando válido, `canal:"voz"` é recusado.
   */
  conferirComandoVoz?(p: { pessoaId: string; ligacaoId: string; comandoId: string; decisaoId: string; acao: "aprovar" | "recusar" }): boolean;
  aoDecidirPorVoz?(p: { pessoaId: string; ligacaoId: string; decisaoId: string; acao: "aprovar" | "recusar" }): void;
  services: Pick<Services, "conectores" | "rotinas" | "computadores">;
  prazoDecisaoMs?: number;
  executor?: Executor;
};

const ID = "(?<id>[^/]+)";

function marcacoes(corpo: unknown): MarcacaoItem[] | undefined {
  const itens = typeof corpo === "object" && corpo !== null ? (corpo as { itens?: unknown }).itens : undefined;
  if (itens === undefined) return undefined;
  if (!Array.isArray(itens)) throw new ErroDeDominio("entrada_invalida", { cause: "itens" });
  return itens.map((i: unknown) => {
    const o = typeof i === "object" && i !== null ? (i as Record<string, unknown>) : {};
    if (typeof o.id !== "string" || typeof o.selecionado !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "item" });
    return { id: o.id, selecionado: o.selecionado, ...(typeof o.textoFinal === "string" ? { textoFinal: o.textoFinal } : {}) };
  });
}

/** `sempre: true` no corpo = a pessoa clicou no terceiro botão junto com aprovar (ADR-042). */
function sempre(corpo: unknown): boolean {
  return typeof corpo === "object" && corpo !== null && (corpo as { sempre?: unknown }).sempre === true;
}

/** "Pode fazer e o resto desta tarefa" (2026-09-28): libera o computador ou o terminal (ADR-055) para a cadeia do turno raiz. */
function restoDaTarefa(corpo: unknown): boolean {
  return typeof corpo === "object" && corpo !== null && (corpo as { restoDaTarefa?: unknown }).restoDaTarefa === true;
}

/** O pedido veio da janela de aprovação por voz: `{canal:"voz", ligacaoId, comandoId, acao}`. */
function comandoDeVoz(corpo: unknown): { ligacaoId: string; comandoId: string; acao: "aprovar" | "recusar" } | null {
  if (typeof corpo !== "object" || corpo === null || (corpo as { canal?: unknown }).canal !== "voz") return null;
  const c = corpo as Record<string, unknown>;
  if (typeof c.ligacaoId !== "string" || typeof c.comandoId !== "string" || (c.acao !== "aprovar" && c.acao !== "recusar")) throw new ErroDeDominio("entrada_invalida", { cause: "comando de voz" });
  // A voz aprova ou recusa o card inteiro: nada de "sempre", resto da tarefa, edição ou seleção parcial.
  if ("sempre" in c || "restoDaTarefa" in c || "itens" in c || "capacidades" in c) throw new ErroDeDominio("entrada_invalida", { cause: "voz decide o card inteiro" });
  return { ligacaoId: c.ligacaoId, comandoId: c.comandoId, acao: c.acao };
}

function recusada(corpo: unknown): boolean {
  return typeof corpo === "object" && corpo !== null && (corpo as { recusar?: unknown }).recusar === true;
}

/** Decisão de proposta (perfil/rotina/acesso) fechada pela dona: o evento vai para ela. */
function eventoDecidida(deps: Deps, d: Decisao, extra: Record<string, string | number | boolean | null> = {}): RuntimeEvent {
  return {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: deps.agora(),
    kind: "decisao_decidida",
    autoria: autoriaDaPessoa(deps.escopo),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: d.conversaId,
    turnoId: d.turnoId,
    dados: { decisao_id: d.id, tipo: d.tipo, ...extra },
  };
}

/**
 * Rotas de decisão (EMENDA 4, EMENDA-L9 §4): `decidir` cobre os tipos que se decidem por
 * botão — aprovacao/gate_rotina (lista tipada, L5), retomar_turno (L6), acesso (decidirAcesso,
 * ADR-044), perfil (confirmarProposta, L6), rotina (services.rotinas.ativar, L7; decisao.id === propostaId) —
 * e recusa os três de pedir_a_pessoa, que se RESPONDEM com texto em `responder`. `retomar` é a
 * retomada por frase da pessoa de um turno interrompido.
 *
 * Decisora ≠ dona (EMENDA 1, PENDÊNCIA L5 §4/L3 §3): a fase que a decisora pode assinar (marcar
 * itens, fechar a decisão) roda na tx DELA (policy nod_decisora); o que exige owner_id = pessoa
 * (mensagem, turno de retomada, concessão) roda numa tx da DONA — a decisão diz quem é.
 */
export function criarRotasDecisoes(d: DepsRotasDecisoes): Rota[] {
  const comoDona = <T>(escopo: Escopo, decisao: Decisao, fn: (deps: Deps) => Promise<T>): Promise<T> =>
    d.dentro(decisao.ownerId === escopo.pessoaId ? escopo : { tenantId: escopo.tenantId, pessoaId: decisao.ownerId }, fn);

  return [
    {
      metodo: "POST", acao: "cartoes.decidir",
      padrao: new RegExp(`^/decisoes/${ID}/decidir$`),
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        let corpo = await ctx.corpo();
        const atual = await d.dentro(ctx.escopo, (deps) => deps.repos.decisoes.buscar(decisaoId));
        if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
        const voz = comandoDeVoz(corpo);
        if (voz) {
          if (!d.conferirComandoVoz?.({ pessoaId: ctx.escopo.pessoaId, ligacaoId: voz.ligacaoId, comandoId: voz.comandoId, decisaoId, acao: voz.acao })) throw new ErroDeDominio("nao_permitido", { cause: "comando de voz inválido ou já usado" });
          if (atual.tipo === "retomar_turno" && voz.acao === "recusar") throw new ErroDeDominio("estado_invalido", { cause: "retomar não se recusa por voz" });
          // O corpo é montado aqui, como a web faria: recusar uma aprovação = todos os itens desmarcados.
          if (voz.acao === "recusar" && (atual.tipo === "aprovacao" || atual.tipo === "gate_rotina")) {
            const itens = await d.dentro(ctx.escopo, (deps) => deps.repos.itensAprovacao.listar(decisaoId));
            corpo = { itens: itens.map((i) => ({ id: i.id, selecionado: false })) };
          } else corpo = voz.acao === "recusar" ? { recusar: true } : {};
          // Só depois de decidida de fato (resposta 200): a ligação fala o resultado e avisa o cérebro.
          const aviso = { pessoaId: ctx.escopo.pessoaId, ligacaoId: voz.ligacaoId, decisaoId, acao: voz.acao };
          ctx.res.once("finish", () => {
            if (ctx.res.statusCode === 200) d.aoDecidirPorVoz?.(aviso);
          });
        }
        const ids: Record<string, string> = { decisao: atual.id };

        if (atual.tipo === "aprovacao" || atual.tipo === "gate_rotina" || atual.tipo === "retomar_turno") {
          // FASE 1 (decisora): marcar e fechar. FASE 2 (dona): efeito externo assentado / turno de retomada.
          const fase1 = await d.dentro(ctx.escopo, (deps) => executar(deps, marcarEDecidir, { decisaoId, itens: marcacoes(corpo) }));
          if (atual.tipo === "retomar_turno") {
            const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, retomarPorDecisao, { decisao: fase1.decisao }));
            if (r.turnoRetomadaId) ids.turnoRetomada = r.turnoRetomadaId;
          } else {
            // Liberar ANTES de executar: a próxima ação da tarefa pode chegar enquanto esta ainda roda.
            if (restoDaTarefa(corpo)) await comoDona(ctx.escopo, atual, (deps) => executar(deps, liberarNaTarefa, { decisao: fase1.decisao }));
            // A chamada ao conector roda FORA de qualquer transação (não segura conexão do banco).
            const desfechos: DesfechoExecutado[] = await executarItens(d.services, fase1.aExecutar);
            const fase2 = await comoDona(ctx.escopo, atual, (deps) => executar(deps, assentarAprovacao, { decisaoId, desfechos }));
            if (fase2.mensagemId) ids.mensagem = fase2.mensagemId;
            if (fase2.turnoRetomadaId) ids.turnoRetomada = fase2.turnoRetomadaId;
            // ADR-042: o mesmo clique aprova AGORA e grava a regra para as próximas vezes. Só os
            // itens que a pessoa manteve marcados; sensível e computador ficam de fora no caso de uso.
            if (sempre(corpo)) {
              const marcados = fase2.itens.filter((i) => i.selecionado).map((i) => i.id);
              const regras = await comoDona(ctx.escopo, atual, (deps) => executar(deps, permitirSempre, { decisaoId, itemIds: marcados }));
              if (regras.criadas.length > 0) ids.regras = String(regras.criadas.length);
              if (regras.mensagemId) ids.consentimento = regras.mensagemId;
            }
          }
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "acesso") {
          // definido em 2026-09-24 (ADR-044): um clique concede e continua (decidir-acesso.ts). Roda como a
          // DONA — concessão, consentimento e turno exigem owner = pessoa —, gravando quem clicou.
          // definido em 2026-09-25: `capacidades` = os grupos que a pessoa deixou marcados no card; ausente = tudo o que foi pedido.
          const bruto = typeof corpo === "object" && corpo !== null ? (corpo as { capacidades?: unknown }).capacidades : undefined;
          if (bruto !== undefined && (!Array.isArray(bruto) || !bruto.every((c): c is string => typeof c === "string"))) throw new ErroDeDominio("entrada_invalida", { cause: "capacidades" });
          const capacidades = bruto as string[] | undefined;
          const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, decidirAcesso, { decisaoId: atual.id, recusar: recusada(corpo), executor: d.executor ?? "catcher", por: ctx.escopo.pessoaId, ...(capacidades ? { capacidades } : {}) }));
          if (r.concessoes > 0) ids.concessoes = String(r.concessoes);
          if (r.consentimentoId) ids.consentimento = r.consentimentoId;
          if (r.rotinaId) ids.rotina = r.rotinaId;
          if (r.turnoId) ids[r.rotinaId ? "turnoRotina" : "turnoRetomada"] = r.turnoId;
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "bot") {
          // ADR-077: o card "Novo bot" do onboarding (propor_bot). O clique pode trazer o nome e o que ele faz editados;
          // a voz confirma o que a Nina propôs (o corpo da voz é montado acima, sem campos).
          const c = typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>) : {};
          await comoDona(ctx.escopo, atual, async (deps) => {
            const decidida = await deps.repos.decisoes.decidir(atual.id, { por: ctx.escopo.pessoaId, agora: deps.agora() });
            if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.estado}` });
            const r = await executar(deps, decidirPropostaDeBot, { propostaId: atual.id, recusar: recusada(corpo), nome: c.nome, descricao: c.descricao });
            if (r.agenteId) ids.agente = r.agenteId;
            // Revisão do épico (S2, 2026-10-08): a task do turno que propôs relê o estado.
            await deps.repos.events.gravarComOutbox([eventoDecidida(deps, decidida, { recusada: recusada(corpo) }), ...(await sincronizarDasDecisoes(deps, [decidida]))]);
          });
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "credencial") {
          // NOD-50: em "Sua vez" o cartão de credencial só se RECUSA; guardar é pelo campo do cartão (POST
          // propostas/:id/credencial), porque o valor nunca passa por esta rota. Recusar retoma o turno com `recusada`.
          // Só a dona decide o pedido de chave (a mesma regra do POST que guarda): a decisão visível à equipe não dá a
          // outra pessoa o poder de recusá-lo em nome dela (revisão do PR #553).
          if (atual.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "pedido de chave de outra pessoa" });
          if (!recusada(corpo)) throw new ErroDeDominio("estado_invalido", { cause: "credencial se guarda pelo cartão" });
          const r = await d.dentro(ctx.escopo, (deps) => executar(deps, fecharPedidoDeCredencial, { propostaId: atual.id, resultado: "recusada" }));
          if (r.turnoId) ids.turnoRetomada = r.turnoId;
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "lote_bots") {
          // ADR-082: o card do lote do Nod. `selecionados` = os índices das ações que a pessoa deixou marcadas; ausente =
          // todas as que esperam. Roda como a DONA (as ações mexem nos bots dela), gravando quem clicou.
          const c = typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>) : {};
          const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, decidirLoteDeBots, { decisaoId: atual.id, recusar: recusada(corpo), selecionados: c.selecionados }));
          ids.feitas = String(r.feitas);
          if (r.falhas > 0) ids.falhas = String(r.falhas);
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "importacao_linear") {
          // NOD-422: confirmar grava a importação 'trazendo' e o servidor busca depois do commit (Deps.aposCommit). Quadro
          // removido ou importação já em andamento: recusa sem lançar; o 409 sai DEPOIS do commit (padrão NOD-159).
          // Revisão 6 do PR #630: só a dona (o quadro e a conta do Linear são dela), como assumir_quadro e quadro_exclusao.
          if (atual.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "importação no quadro de outra pessoa" });
          const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, decidirImportacaoLinear, { decisaoId: atual.id, recusar: recusada(corpo) }));
          if (r.obsoleta) throw new ErroDeDominio("estado_invalido", { cause: "importacao_obsoleta" });
          if (r.importacaoId) ids.importacao = r.importacaoId;
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "assumir_quadro") {
          // NOD-422 (PR 2): o quadro assume a esteira. Confirmar pausa as rotinas listadas e marca assumido_em na mesma
          // transação. Só a dona (pausar é dela). Quadro removido ou já assumido: recusa sem lançar; o 409 sai depois do commit.
          if (atual.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "assumir o quadro de outra pessoa" });
          const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, decidirAssumirQuadro, { decisaoId: atual.id, recusar: recusada(corpo) }));
          if (r.obsoleta) throw new ErroDeDominio("estado_invalido", { cause: "quadro_assumido" });
          ids.pausadas = String(r.pausadas.length);
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "app") {
          // NOD-445 (ADR-146): o card Criar/Ajustar do app. Roda como a DONA (as páginas são dela). O card que não vale
          // mais (o nome foi tomado, o limite chegou) fecha como recusado e avisa; o 409 sai DEPOIS do commit.
          const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: atual.id, recusar: recusada(corpo) }));
          // Revisão 6 do #626: o motivo da lista fechada (limite, nome em uso) vai no corpo, como nas rotas das páginas.
          if (r.obsoleta && r.motivo) {
            responderErro(ctx.res, new RecusaDasPaginas("estado_invalido", r.motivo, "app_nao_cabe"), { metodo: ctx.req.method ?? "?", caminho: ctx.req.url ?? "" }, r.motivo);
            return;
          }
          if (r.obsoleta) throw new ErroDeDominio("estado_invalido", { cause: "app_nao_cabe" });
          if (r.criado) ids.app = r.criado.id;
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "quadro_exclusao") {
          // NOD-430: excluir o quadro de um bot pela conversa. Roda como a DONA; o quadro que mudou depois do card fecha
          // como recusa e avisa sem lançar, e o 409 sai DEPOIS do commit (padrão NOD-159).
          // Revisão 3 do PR #627: só a dona decide (como a credencial). Excluir não tem Desfazer e o caso grava a dona como
          // quem decidiu; uma decisora designada não apaga o quadro dela em nome dela. (O colunas_quadro, com Desfazer, segue
          // aceitando a decisora pelo comoDona.)
          if (atual.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "exclusão de quadro de outra pessoa" });
          const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, decidirQuadroExclusao, { decisaoId: atual.id, recusar: recusada(corpo), executor: d.executor ?? "catcher" }));
          if (r.obsoleta) throw new ErroDeDominio("estado_invalido", { cause: "quadro_mudou" });
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "colunas_quadro") {
          // NOD-448 (ADR-140): trocar o conjunto de colunas pela conversa. Roda como a DONA (o quadro é dela). Quadro que
          // mudou depois do card: o caso recusa e avisa sem lançar; o 409 sai DEPOIS do commit (padrão NOD-159).
          const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, decidirColunasDoQuadro, { decisaoId: atual.id, recusar: recusada(corpo), executor: d.executor ?? "catcher" }));
          if (r.obsoleta) throw new ErroDeDominio("estado_invalido", { cause: "colunas_mudaram" });
          if (r.loteId) ids.lote = r.loteId;
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "perfil" || atual.tipo === "rotina" ||atual.tipo === "rotina_atualizacao" || atual.tipo === "rotina_exclusao") {
          // Proposta confirmada por botão em "Sua vez": decisao.id === proposta.id (criar-rotina.ts, rotinas-do-agente.ts).
          // NOD-159/NOD-190: a rotina (ou o perfil) mudou depois da proposta — o caso recusou e avisou sem lançar; o erro
          // sai DEPOIS do commit.
          let obsoleta = false;
          await comoDona(ctx.escopo, atual, async (deps) => {
            // NOD-190: o perfil trava o AGENTE antes da decisão, na mesma ordem de POST propostas/:id/confirmar
            // (confirmar-perfil.ts trava o agente e, no card obsoleto, fecha a decisão). Na ordem inversa, o mesmo card
            // clicado na conversa e em "Sua vez" ao mesmo tempo fazia deadlock (decisão → agente × agente → decisão).
            // Vale também para RECUSAR (QA da NOD-190): a recusa fecha a decisão e depois a proposta, e a confirmação do
            // card obsoleto pela conversa trava a proposta e depois a decisão — sem o agente na frente, 40P01 e 500.
            // (A leitura sem trava aqui só descobre QUAL agente travar; o estado vale o da leitura travada logo abaixo.)
            if (atual.tipo === "perfil") {
              const lida = await deps.repos.propostas.buscar(atual.id);
              if (lida) await deps.repos.agentes.buscarParaAtualizar(lida.agenteId);
            }
            // NOD-197: depois (do agente, no perfil) a PROPOSTA, e só então a decisão — a ordem da conversa, que trava a
            // proposta em propostas.decidir e fecha a decisão depois (ativar-rotina.ts, recusar-proposta.ts). Lida sem
            // trava, a proposta saía `pendente` daqui enquanto a conversa a recusava: a rotina nascia, mudava ou era
            // excluída com a proposta recusada, e confirmar × confirmar dava 40P01. Travada, quem chega depois relê o
            // estado já commitado e acha a decisão fechada (409).
            const proposta = await deps.repos.propostas.buscarParaAtualizar(atual.id);
            const decidida = await deps.repos.decisoes.decidir(atual.id, { por: ctx.escopo.pessoaId, agora: deps.agora() });
            if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.estado}` });
            if (recusada(corpo)) {
              if (proposta && proposta.estado === "pendente") await executar(deps, recusarProposta, { propostaId: proposta.id });
            } else if (atual.tipo === "rotina") {
              // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): ativar concede os
              // acessos declarados dos apps conectados NESTA transação (conceder-acessos-da-rotina.ts).
              const rotina = await deps.tx((trx) => d.services.rotinas.ativar(trx, atual.id));
              ids.rotina = rotina.id;
            } else if (atual.tipo === "rotina_atualizacao" || atual.tipo === "rotina_exclusao") {
              // A rotina já existe e tem id próprio: a ligação é payload.rotinaId, não a igualdade
              // de ids que 'rotina' (nascimento) usa. O caso aplica o payload JÁ normalizado (E7.1).
              const caso = atual.tipo === "rotina_atualizacao" ? aplicarAtualizacaoRotina : aplicarExclusaoRotina;
              const r = await executar(deps, caso, { propostaId: atual.id });
              ids.rotina = r.rotina.id;
              obsoleta = r.obsoleta === true;
            } else if (proposta && proposta.estado === "pendente") {
              const r = await executar(deps, confirmarProposta, { propostaId: proposta.id, prazoMs: d.prazoDecisaoMs });
              if (r.agente) ids.agente = r.agente.id;
              obsoleta = r.obsoleta === true;
            }
            // Chat limpo (revisão do PR 4): a rotina criada, mudada ou excluída por este botão deixa o recibo da proposta, e o
            // cartão encolhe ("Confirmado por você") como o de confirmarProposta. Obsoleta (recusada) não grava: só confirmada.
            if (!recusada(corpo) && atual.tipo !== "perfil") await executar(deps, reciboDaPropostaConfirmada, { propostaId: atual.id });
            // Obsoleta: a pessoa clicou em confirmar, mas a proposta saiu recusada — o frame diz o que ficou no banco.
            // Revisão do épico (S2, 2026-10-08): a task do turno que propôs relê o estado.
            await deps.repos.events.gravarComOutbox([eventoDecidida(deps, decidida, { recusada: recusada(corpo) || obsoleta }), ...(await sincronizarDasDecisoes(deps, [decidida]))]);
          });
          if (obsoleta) throw atual.tipo === "perfil" ? erroPerfilMudou() : erroRotinaMudou();
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        // pergunta | falta_de_dado | permissao: a resposta é texto (EMENDA 16), nunca um botão de decidir.
        // A resposta pronta (opcoes, emenda da ADR-045) também vai como TEXTO por `responder`. Tirar da tela
        // sem responder ("Deixar pra lá") é POST decisoes/:id/dispensar (#46, ADR-045): dispensar não é responder.
        throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.tipo} se responde em POST decisoes/:id/responder` });
      },
    },
    {
      metodo: "POST", acao: "cartoes.responder",
      padrao: new RegExp(`^/decisoes/${ID}/responder$`),
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const texto = textoDoCorpo(await ctx.corpo(), "texto") ?? "";
        // FASE 1 (decisora, pode ser outra pessoa): fecha a decisão. FASE 2 (dona): mensagem + turno de retomada.
        const { decisao } = await d.dentro(ctx.escopo, (deps) => executar(deps, fecharComResposta, { decisaoId, texto }));
        const r = await comoDona(ctx.escopo, decisao, async (deps) => {
          const pessoa = await deps.repos.pessoas.buscar(ctx.escopo.pessoaId);
          return executar(deps, retomarComResposta, { decisao, texto, respondidaPor: { id: ctx.escopo.pessoaId, nome: pessoa?.nome ?? "a pessoa" }, prazoMs: d.prazoDecisaoMs, executor: d.executor });
        });
        const ids: Record<string, string> = { decisao: decisao.id, mensagem: r.mensagem.id };
        if (r.turno) ids.turnoRetomada = r.turno.id;
        const resposta: RespostaMutacao = { ok: true, ids };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST", acao: "turnos.retomar_decisao",
      padrao: new RegExp(`^/decisoes/${ID}/retomar$`),
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const texto = textoDoCorpo(await ctx.corpo(), "texto") ?? "retomar de onde parou";
        const atual = await d.dentro(ctx.escopo, (deps) => deps.repos.decisoes.buscar(decisaoId));
        if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
        const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, retomarTurno, { decisaoId, texto, prazoMs: d.prazoDecisaoMs, executor: d.executor }));
        const resposta: RespostaMutacao = { ok: true, ids: { decisao: atual.id, turno: r.turno.id, retomaTurno: r.original.id, mensagem: r.mensagem.id } };
        ctx.json(201, resposta);
      },
    },
  ];
}
