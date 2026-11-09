import type { Autoria } from "../contracts/evento.ts";
import type { KindMensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import { ASSUNTOS, type Assunto, type Destino, type RegraDeDestino } from "../contracts/destino-no-chat.ts";
import { ehMotivoDaQueda } from "./incidente.ts";

/**
 * Para onde cada assunto vai (definido em 2026-10-18, plano do chat limpo, PR 1; ADR-114). Só no servidor: a web recebe
 * o destino pronto no DTO. No chat ficam só falas, conversa com outros bots, rotinas (criar, mudar, pausar, apagar e a
 * falha), o que é com você e entregas; o resto vai para a Atividade do bot. Mudar uma regra é mudar esta tabela.
 *
 * Ficam no chat também (revisão de engenharia de 18/10, decisão 10): a criação do bot (é a primeira linha da conversa), o
 * turno que terminou sem resposta para a pessoa (órfão, interrompido por falha, retorno do lote que caiu) e o recibo
 * automático com item que falhou (uma ação em nome da pessoa que não saiu). E o que pede ação da pessoa (orquestrador,
 * 18/10, QA do PR 1): a queda da máquina (card "Retomar") e a pergunta vencida ("você pode reabrir"). Na dúvida entre chat e Atividade, chat: um
 * aviso a mais polui, um aviso escondido de quem precisava agir é pior.
 */
export const DESTINO: Readonly<Record<Assunto, RegraDeDestino>> = {
  "colega.handoff": { destino: "chat", categoria: null },
  "colega.pedido": { destino: "chat", categoria: null },
  "colega.resposta": { destino: "chat", categoria: null },
  "acesso.concedido": { destino: "chat", categoria: null },
  "acesso.revogado": { destino: "chat", categoria: null },
  "acesso.pasta": { destino: "chat", categoria: null },
  "aprovacao.recibo": { destino: "chat", categoria: null, seBastidor: "bastidor.aprovacao_recibo" },
  "aprovacao.automatica_falhou": { destino: "chat", categoria: null },
  // PR 6 dos modos de aprovação: a mudança de regra que a pessoa precisa ver no chat, uma vez, nos bots já no total.
  "aprovacao.total_credenciais": { destino: "chat", categoria: null },
  // "Esta mudança não foi aplicada… Peça de novo ao bot": pede ação.
  "proposta.obsoleta": { destino: "chat", categoria: null },
  // A proposta confirmada ou recusada com payload (`proposta_decidida`, chat limpo PR 4): é o cartão encolhido no lugar
  // do cartão da proposta. As de antes, sem payload, continuam `proposta.decidida` (Atividade).
  "proposta.resultado": { destino: "chat", categoria: null },
  artefato: { destino: "chat", categoria: null },
  ligacao: { destino: "chat", categoria: null },
  // /nova: a pessoa pediu e precisa ver que o bot começou do zero.
  "sessao.nova": { destino: "chat", categoria: null },
  // A sala nunca aplica a tabela (só a conversa própria); o assunto existe para o backfill e a medição.
  "sala.evento": { destino: "chat", categoria: null },
  "rotina.evento": { destino: "chat", categoria: null },
  "rotina.falhou": { destino: "chat", categoria: null },
  // NOD-114: o aviso que o bot deu por conta própria é fala para a pessoa ler.
  "aviso.pessoa": { destino: "chat", categoria: null },
  // NOD-119: o card da barra lateral pede o clique da pessoa.
  "barra.ajuste": { destino: "chat", categoria: null },
  // ADA-13: o card do canvas publicado ou importado (Abrir leva à página Canvas).
  canvas: { destino: "chat", categoria: null },
  // NOD-449: o card dos não lidos tem ✓ por item; o recibo tem Desfazer.
  "leitura.lista": { destino: "chat", categoria: null },
  "leitura.recibo": { destino: "chat", categoria: null },
  // NOD-437: o recibo do gerir_times ("Time Marketing criado... Pedido por Marlon via Edu"), no chat e na Atividade.
  "times.organizados": { destino: "chat", categoria: null },
  // ADA-241: o recibo do gerir_acessos ("3 bots com Ler no Gmail. Pedido por Marlon via Edu").
  "acessos.mudados": { destino: "chat", categoria: null },
  // O aviso único de janelas adiadas (NOD-243): diz por que a rotina não roda e quando volta.
  "rotina.adiada": { destino: "chat", categoria: null },
  // A linha "Rotina executou" (ou "passou em branco"): a silenciosa (sem_novidade) não grava linha nenhuma, então é ela que
  // diz à web que a execução teve algo para a pessoa — sem ela na janela, o resultado virava "rodou 1 vez · nada para você"
  // (revisão do PR 2, 18/10). Por isso `anexo`: vem na janela, não vira linha, e aparece na Atividade.
  "rotina.execucao": { destino: "anexo", categoria: null },
  "agente.criado": { destino: "chat", categoria: null },
  "bot.criado": { destino: "atividade", categoria: null },
  "turno.orfao": { destino: "chat", categoria: null, seBastidor: "bastidor.turno_orfao" },
  "turno.falhou": { destino: "chat", categoria: null, seBastidor: "bastidor.turno_falhou" },
  "turno.interrompido": { destino: "atividade", categoria: "bloqueios" },
  // A queda da máquina vem com o card "Retomar" e diz "você pode reabrir": pede ação (decidido pelo orquestrador em 18/10,
  // no lugar do Marlon, na QA do PR 1). Se o card for dispensado ou vencer, a linha continua dizendo o que houve.
  "turno.queda_da_maquina": { destino: "chat", categoria: null },
  "turno.retomado": { destino: "atividade", categoria: "bloqueios" },
  "lote.retorno_caiu": { destino: "chat", categoria: null, seBastidor: "bastidor.lote_retorno_caiu" },
  passe: { destino: "atividade", categoria: "bloqueios" },
  parada: { destino: "atividade", categoria: "bloqueios" },
  "negacao.ferramenta": { destino: "atividade", categoria: "bloqueios" },
  "negacao.conector": { destino: "atividade", categoria: "bloqueios" },
  // O turno parou (ADR-029): fica.
  "negacao.terminal": { destino: "chat", categoria: null, seBastidor: "bastidor.negacao_terminal" },
  // Os quatro de destino temporal ficam no chat enquanto pedem ação e a Atividade os lista sempre, no filtro "Máquina e IA"
  // (plano, 1a; QA do PR 2: com categoria null eles só apareciam em "Tudo").
  "negacao.plano_ausente": { destino: "chat", categoria: "maquina_ia", temporal: true },
  "ia.trocada": { destino: "atividade", categoria: "maquina_ia" },
  "ia.troca": { destino: "chat", categoria: "maquina_ia", temporal: true },
  "ia.limite_do_plano": { destino: "chat", categoria: "maquina_ia", temporal: true },
  // A fala da pessoa espera a hora do limite (NOD-268): ela não teve resposta e a linha diz quando volta.
  "ia.fala_espera": { destino: "chat", categoria: null },
  "conta.trocada": { destino: "atividade", categoria: "maquina_ia" },
  "conta.seguiu": { destino: "atividade", categoria: "maquina_ia" },
  "conta.escolhida": { destino: "atividade", categoria: "maquina_ia" },
  "conta.nota": { destino: "atividade", categoria: "maquina_ia" },
  // "Seguir com" numa conta que não está na máquina: o clique não fez nada e a linha diz o que fazer.
  "conta.recusada": { destino: "chat", categoria: null },
  "cota.pedido_na_fila": { destino: "atividade", categoria: "maquina_ia" },
  "cota.espera": { destino: "atividade", categoria: "maquina_ia" },
  "fundo.espera": { destino: "atividade", categoria: "maquina_ia" },
  "computador.fora_do_ar": { destino: "chat", categoria: "maquina_ia", temporal: true },
  "computador.em_operacao": { destino: "chat", categoria: "maquina_ia" },
  // NOD-97 (protótipo v1.1): fechar a tela no controle deixa uma linha cinza no chat, para a pessoa saber que o bot retomou.
  "computador.tela_fechada": { destino: "chat", categoria: "maquina_ia" },
  // NOD-97 PR 5: o Chrome preencheu a senha salva; a linha cinza no chat avisa que o bot não vê o que está escrito.
  "computador.senha_preenchida": { destino: "chat", categoria: "maquina_ia" },
  "trabalho.aberto": { destino: "anexo", categoria: "frentes" },
  "frentes.abertas": { destino: "anexo", categoria: "frentes" },
  "frentes.terminadas": { destino: "anexo", categoria: "frentes" },
  "frentes.recado": { destino: "anexo", categoria: "frentes" },
  "pedido.respondido": { destino: "anexo", categoria: null },
  "memoria.anotada": { destino: "atividade", categoria: null },
  "memoria.task_fechada": { destino: "atividade", categoria: null },
  compactacao: { destino: "atividade", categoria: null },
  "arquivos.desfeitos": { destino: "atividade", categoria: null },
  "proposta.decidida": { destino: "atividade", categoria: null },
  inteligencia: { destino: "atividade", categoria: null },
  "aprovacao.modo": { destino: "atividade", categoria: null },
  // PR 6 dos modos de aprovação: o que o modo aprovou num app ou num acesso também é "Sem aprovação" na Atividade.
  "aprovacao.automatica": { destino: "atividade", categoria: "sem_aprovacao" },
  "acesso.automatico": { destino: "atividade", categoria: "sem_aprovacao" },
  // "Você pode reabrir": a pergunta vencida ainda pede ação da pessoa (decidido pelo orquestrador em 18/10, no lugar do
  // Marlon, na QA do PR 1; o plano mandava para a Atividade porque o cartão já diz "Sem resposta").
  "decisao.vencida": { destino: "chat", categoria: null },
  "sistema.generico": { destino: "atividade", categoria: null },
  // ADA-28 (ADR-159): o chat só aponta para a tarefa — uma linha com link.
  "tarefa.precisa": { destino: "chat", categoria: null },
  "tarefa.resultado": { destino: "chat", categoria: null },
  // ADA-28 (ADR-159, S7): o bastidor que falhou ou parou mora na Atividade; o que pede ação da pessoa chega pela tarefa.
  "bastidor.turno_falhou": { destino: "atividade", categoria: "bloqueios" },
  "bastidor.turno_orfao": { destino: "atividade", categoria: "bloqueios" },
  "bastidor.lote_retorno_caiu": { destino: "atividade", categoria: "bloqueios" },
  "bastidor.negacao_terminal": { destino: "atividade", categoria: "bloqueios" },
  "bastidor.aprovacao_recibo": { destino: "atividade", categoria: "sem_aprovacao" },
};

/**
 * ADA-28 (ADR-159): o assunto gravado quando o turno é de bastidor. Puro: quem grava sabe se o turno é de bastidor e se a
 * flag está ligada. Sem variante (ou fala, `null`), o mesmo assunto.
 */
export function assuntoNoBastidor(assunto: Assunto | null): Assunto | null {
  return assunto !== null ? (DESTINO[assunto].seBastidor ?? assunto) : null;
}

/** Os pares (assunto do chat → variante de bastidor), para o SQL da gravação trocar quando o turno é de bastidor. */
export const TROCAS_DE_BASTIDOR: readonly (readonly [Assunto, Assunto])[] = ASSUNTOS.flatMap((a) => {
  const v = DESTINO[a].seBastidor;
  return v ? [[a, v] as const] : [];
});

/** `null` é fala ou linha sem backfill: fica no chat. Valor fora da tabela (gravado por um código mais novo) também. */
export function destinoDe(assunto: string | null): Destino {
  return assunto !== null && Object.hasOwn(DESTINO, assunto) ? DESTINO[assunto as Assunto].destino : "chat";
}

/** Os assuntos que a Atividade lista: o que sai do chat (atividade e anexo) e os de destino temporal. */
export const ASSUNTOS_DA_ATIVIDADE: readonly Assunto[] = ASSUNTOS.filter((a) => DESTINO[a].destino !== "chat" || DESTINO[a].temporal === true);

/**
 * O assunto do aviso "Turno interrompido: {motivo}" pelo código do motivo (definido em 2026-10-18, QA do PR 1: o produtor
 * gravava `turno.falhou` e o backfill `turno.queda_da_maquina` para a mesma queda). O produtor (assentar-turno.ts,
 * interromper-por-maquina.ts) e o backfill (assunto-do-texto.ts, depois de traduzir a frase de volta ao código) passam por
 * aqui, então a linha nova e a antiga têm o mesmo assunto. Parado pela pessoa ou lido junto da seguinte: Atividade; a queda
 * da máquina ou do servidor: a dela (chat, com o "Retomar"); qualquer outro motivo, inclusive o desconhecido: falhou (chat).
 */
export function assuntoDaInterrupcao(motivo: string): Assunto {
  if (motivo === "parado_pela_pessoa" || motivo === "absorvido") return "turno.interrompido";
  if (ehMotivoDaQueda(motivo)) return "turno.queda_da_maquina";
  return "turno.falhou";
}

/** Regra de aprovação automática ou de outra regra do servidor (ADR-013): `decidido_por` não é a pessoa. */
const porRegra = (autoria: Pick<Autoria, "decidido_por"> | null): boolean => autoria !== null && autoria.decidido_por !== "pessoa";

/**
 * O assunto que o kind, o payload e a autoria determinam. `null` = fala (texto, pergunta, resposta, boas-vindas). Para
 * `sistema` sem payload o produtor escolhe (o tipo de NovaMensagem exige); aqui cai em `sistema.generico`, que só o
 * backfill de uma linha sem casamento alcança. O `consentimento` da aprovação automática tem o mesmo payload do manual
 * e só se distingue pela autoria (conceder.ts).
 */
export function assuntoDe(kind: KindMensagem, payload: PayloadMensagem | null, autoria: Pick<Autoria, "decidido_por"> | null): Assunto | null {
  if (payload) {
    switch (payload.kind) {
      case "handoff":
        return "colega.handoff";
      case "peer_pedido":
        return "colega.pedido";
      case "peer_ask":
        return "colega.resposta";
      case "passe":
        return "passe";
      case "parada":
        return "parada";
      case "consentimento":
        return porRegra(autoria) ? "acesso.automatico" : "acesso.concedido";
      case "pasta_aberta":
        return "acesso.pasta";
      // "Sempre permitir isto" (PR 4): o recibo da regra que a pessoa criou, como o consentimento manual.
      case "regra_permanente":
        return "acesso.concedido";
      case "proposta_decidida":
        return "proposta.resultado";
      case "rotina_execucao":
        return payload.desfecho === "falhou" || payload.desfecho === "bloqueada" || payload.desfecho === "interrompida" ? "rotina.falhou" : "rotina.execucao";
      // NOD-313: o card que sugere espaçar ou pausar a rotina fica no chat, como as linhas da rotina.
      case "rotina_evento":
      case "rotina_ritmo":
        return "rotina.evento";
      case "resultado_aprovacao":
        return "aprovacao.recibo";
      case "negacao":
        if (payload.classe === "plano_ausente") return "negacao.plano_ausente";
        if (payload.terminal) return "negacao.terminal";
        return payload.classe === "conector_indisponivel" ? "negacao.conector" : "negacao.ferramenta";
      case "ia_trocada":
        return "ia.trocada";
      case "troca_de_ia":
        return "ia.troca";
      case "limite_do_plano":
        return "ia.limite_do_plano";
      case "conta_trocada":
        return "conta.trocada";
      case "conta_seguiu":
        return "conta.seguiu";
      case "conta_escolhida":
        return "conta.escolhida";
      case "pedido_na_fila_da_cota":
        return "cota.pedido_na_fila";
      case "computador_fora_do_ar":
        return "computador.fora_do_ar";
      case "computador_em_operacao":
        return "computador.em_operacao";
      case "computador_tela_fechada":
        return "computador.tela_fechada";
      case "computador_senha_preenchida":
        return "computador.senha_preenchida";
      case "turno_preso":
        return "turno.orfao";
      case "artefato":
        return "artefato";
      case "ligacao":
        return "ligacao";
      case "trabalho_aberto":
        return "trabalho.aberto";
      case "frentes_abertas":
        return "frentes.abertas";
      case "frentes_terminadas":
        return "frentes.terminadas";
      case "recado_a_frente":
        return "frentes.recado";
      case "pedido_respondido":
        return "pedido.respondido";
      case "aviso_pessoa":
        return "aviso.pessoa";
      case "ajuste_barra":
        return "barra.ajuste";
      case "canvas":
        return "canvas";
      case "nao_lidos_lista":
        return "leitura.lista";
      case "recibo_leitura":
        return "leitura.recibo";
      case "tarefa_linha":
        return payload.motivo === "precisa" ? "tarefa.precisa" : "tarefa.resultado";
      case "boas_vindas":
      case "acoes_do_turno": // NOD-353: a fala final com o resumo das ações continua fala.
      case "pedido_a_pessoa":
      case "resposta_a_pedido":
        return null;
    }
  }
  switch (kind) {
    case "texto":
      return null;
    case "handoff":
      return "colega.handoff";
    case "peer_ask":
      return "colega.resposta";
    case "passe":
      return "passe";
    case "parada":
      return "parada";
    // "permitiu para sempre" (permitir-sempre.ts) é consentimento sem payload: recibo da pessoa, fica (Parte 3).
    case "consentimento":
      return porRegra(autoria) ? "acesso.automatico" : "acesso.concedido";
    case "rotina_execucao":
      return "rotina.execucao";
    // Sem payload, só o recibo automático grava (o produtor escolhe entre tudo saiu e item que falhou); a reserva fica.
    case "resultado_aprovacao":
      return "aprovacao.recibo";
    case "negacao":
      return "negacao.ferramenta";
    case "artefato":
      return "artefato";
    case "sistema":
      return "sistema.generico";
  }
}

/**
 * Os assuntos por destino (definido em 2026-10-18, chat limpo, PR 2): a janela da conversa (mensagens.repo
 * `listarComTurno`) conta só o que NÃO está aqui como item de chat, traz os `anexo` desde o corte e deixa os `atividade` de
 * fora. Assunto nulo (fala ou linha sem backfill) não está em lista nenhuma: conta como chat.
 */
export const ASSUNTOS_ANEXO: readonly Assunto[] = ASSUNTOS.filter((a) => DESTINO[a].destino === "anexo");
export const ASSUNTOS_ATIVIDADE: readonly Assunto[] = ASSUNTOS.filter((a) => DESTINO[a].destino === "atividade");
