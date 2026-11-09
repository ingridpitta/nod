import type { RuntimeEvent } from "../contracts/evento.ts";
import type { DesfechoRotina } from "../contracts/motivos.ts";
import type { Rotina } from "../contracts/rotina.ts";
import type { DesfazerRitmo, OpcaoRitmo, PayloadRotinaRitmo } from "../contracts/rotina-ritmo.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { nomeDaRotina } from "../domain/pedido-acesso.ts";
import { FUSO_DA_PESSOA_PADRAO, SEM_NOVIDADE_PARA_SUGERIR, SILENCIO_DO_DEIXAR_MS, deveSugerir, efeitoNaContagem, sugestaoDeRitmo } from "../domain/ritmo-rotina.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { autoriaPessoa, evento, exigir } from "./apoio-l7.ts";
import { fraseDoCorte, pausarRotina } from "./pausar-rotina.ts";
import { eventoDoCard, revisaoDoRitmo, textoInvalido } from "./ritmo-card.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * definido em 2026-10-23 (NOD-313): a sugestão de espaçar ou pausar a rotina que roda muitas vezes sem novidade.
 *
 * REGRA DE NEGÓCIO (Marlon, 2026-10-23): a rotina NUNCA é pausada nem alterada automaticamente. `contarRitmo` (chamado a
 * cada desfecho) só conta e, com 20 seguidas, escreve o card — não toca em `rotinas`. A mudança sai apenas de
 * `decidirRitmoRotina`, que é o clique da pessoa no card (POST rotinas/:id/ritmo).
 */
export const REGRA_RITMO = "regra:ritmo-rotina" as const;

/** O texto do card aberto, que também vai no histórico da conversa. */
export function textoDoCard(p: Pick<PayloadRotinaRitmo, "nome" | "seguidas" | "hoje">): string {
  return `A rotina “${p.nome}” rodou ${p.seguidas} vezes seguidas sem novidade. Hoje: ${p.hoje}. Quer ajustar?`;
}

/** A linha do card resolvido: "✓ Rotina “X” espaçada para a cada 2 h". */
export function textoResolvido(p: PayloadRotinaRitmo, opcao: OpcaoRitmo, extra = ""): string {
  const quem = `Rotina “${p.nome}”`;
  const frase =
    opcao === "espacar" ? `${quem} espaçada para ${p.espacar?.rotulo ?? "um intervalo maior"}`
    : opcao === "uteis" ? `${quem} agora roda só em dias úteis, das 8h às 19h`
    : opcao === "pausar" ? `${quem} pausada`
    : `${quem} segue como está; não pergunto de novo por 30 dias`;
  // "registra no histórico" (critério 3): a linha resolvida diz que o ajuste foi sugerido pelo nod e aceito pela pessoa.
  const origem = opcao === "deixar" ? "" : " (ajuste sugerido pelo nod, aceito por você)";
  return [`✓ ${frase}${origem}.`, extra].filter(Boolean).join(" ");
}

/**
 * Conta o desfecho que a janela acabou de ganhar e, ao chegar a 20 sem novidade seguidas, escreve UM card na conversa da
 * rotina. Chamado por `registrarDesfechoRotina` só quando o desfecho da janela MUDOU (o mesmo desfecho de novo volta
 * `inalterado` antes). Nunca altera a rotina.
 */
export async function contarRitmo(deps: Pick<Deps, "repos" | "escopo" | "agora" | "fusoPadrao">, rotina: Rotina, desfecho: DesfechoRotina, turnoId: string | null): Promise<RuntimeEvent[]> {
  const efeito = efeitoNaContagem(desfecho);
  // NOD-84 (definido em 2026-10-30): a rotina webhook roda quando o provedor chama; não há ritmo para espaçar.
  if (efeito === "neutro" || rotina.gatilho === "webhook") return [];
  // A rotina pausada ou apagada no meio da execução não ganha card (o clique não teria o que aplicar).
  if (rotina.estado !== "ativa" || rotina.excluidoEm !== null) {
    if (efeito === "zera") await deps.repos.rotinaRitmo.contar(rotina.id, "zera");
    return [];
  }
  const ritmo = await deps.repos.rotinaRitmo.contar(rotina.id, efeito);
  if (!ritmo) return [];
  // A rotina recebida pertence ao começo do fechamento. Pausa/edição/exclusão pode ter commitado enquanto a execução
  // terminava; reler antes da reivindicação evita abrir um card com esse retrato antigo sem inverter a ordem das travas.
  const atual = await deps.repos.rotinas.buscar(rotina.id);
  if (!atual || atual.estado !== "ativa" || atual.excluidoEm !== null) {
    await deps.repos.rotinaRitmo.contar(rotina.id, "zera");
    return [];
  }
  const agora = deps.agora();
  if (!deveSugerir({ seguidas: ritmo.semNovidadeSeguidas, silenciadaAte: ritmo.silenciadaAte, cardAberto: ritmo.sugeridaEm !== null }, agora)) return [];
  if (!(await deps.repos.rotinaRitmo.reivindicarCard(rotina.id, agora, SEM_NOVIDADE_PARA_SUGERIR))) return [];
  // Ao nascer uma sugestão nova, o ajuste anterior deixa de ser o estado de referência. Remove o "desfazer" visual
  // daquele card antes de trocar o id corrente; do contrário ele continuaria oferecendo um clique que vira no-op.
  if (ritmo.desfazer && ritmo.sugestaoMensagemId) {
    const anterior = await deps.repos.mensagens.buscar(ritmo.sugestaoMensagemId);
    if (anterior?.payload?.kind === "rotina_ritmo" && anterior.payload.rotinaId === rotina.id && anterior.payload.decisao?.desfazivel) {
      await deps.repos.mensagens.atualizarSistema(anterior.id, { texto: anterior.texto, payload: { ...anterior.payload, decisao: { ...anterior.payload.decisao, desfazivel: false } } });
    }
  }
  const sugestao = sugestaoDeRitmo(atual.cron, atual.fusoIana, agora, deps.fusoPadrao ?? FUSO_DA_PESSOA_PADRAO);
  const payload: PayloadRotinaRitmo = {
    kind: "rotina_ritmo",
    rotinaId: atual.id,
    nome: nomeDaRotina(atual.instrucao),
    seguidas: ritmo.semNovidadeSeguidas,
    hoje: sugestao.hoje,
    cronAtual: atual.cron,
    revisao: revisaoDoRitmo(atual),
    espacar: sugestao.espacar,
    uteis: sugestao.uteis,
    decisao: null,
  };
  const autoria = autoriaPessoa(deps.escopo.pessoaId, REGRA_RITMO);
  const linha = await deps.repos.mensagens.criar({ conversaId: atual.conversaId, turnoId, autoria, kind: "sistema", texto: textoDoCard(payload), payload, confianca: "confiavel" });
  if (!linha) throw new ErroDeDominio("estado_invalido", { cause: "card de ritmo não gravado" });
  await deps.repos.rotinaRitmo.fixarCard(rotina.id, linha.id);
  return [evento(deps, "mensagem_criada", autoria, { mensagem_id: linha.id, kind: "sistema" }, { conversaId: atual.conversaId, turnoId })];
}

export type EntradaRitmo = { rotinaId: string; mensagemId: string; opcao: OpcaoRitmo | "desfazer" };
export type SaidaRitmo = { aplicada: boolean; motivo?: "ja_decidido" | "rotina_mudou" };

/**
 * O clique da pessoa trava a rotina, serializando dois cliques. O desfazer também tenta travar ritmo SEM ESPERAR: se um
 * fechamento já está abrindo outro card, ele vence e o card antigo não reabre. Não esperar evita inverter a ordem do
 * fechamento (janela → ritmo) contra a pausa (rotina → janela). O card só aplica sobre a revisão que sugeriu; rotina
 * mudada, pausada ou apagada fecha como inválida. Segundo clique ou card antigo voltam `ja_decidido`.
 */
export const decidirRitmoRotina: CasoDeUso<EntradaRitmo, SaidaRitmo> = async (deps, input) => {
  const rotina = exigir(await deps.repos.rotinas.buscarParaAtualizar(input.rotinaId), "nao_encontrado", "rotina");
  const ritmo = await deps.repos.rotinaRitmo.buscar(rotina.id);
  const msg = exigir(await deps.repos.mensagens.buscar(input.mensagemId), "nao_encontrado", "card de ritmo");
  if (!ritmo || msg.payload?.kind !== "rotina_ritmo" || msg.payload.rotinaId !== rotina.id) throw new ErroDeDominio("nao_encontrado", { cause: "card de ritmo" });
  if (ritmo.sugestaoMensagemId !== input.mensagemId) return { data: { aplicada: false, motivo: "ja_decidido" } };
  const card = msg.payload;
  if (input.opcao === "desfazer") {
    const travado = await deps.repos.rotinaRitmo.tentarTravarParaDesfazer(rotina.id);
    if (!travado || travado.sugestaoMensagemId !== msg.id) return { data: { aplicada: false, motivo: "ja_decidido" } };
    return desfazer(deps, rotina, travado.desfazer, card, msg.id);
  }
  if (ritmo.sugeridaEm === null) return { data: { aplicada: false, motivo: "ja_decidido" } };

  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  const revisou = card.revisao !== undefined ? card.revisao !== revisaoDoRitmo(rotina) : card.cronAtual !== rotina.cron;
  if (rotina.excluidoEm !== null || rotina.estado !== "ativa" || revisou) {
    await deps.repos.rotinaRitmo.fecharCard(rotina.id, { silenciadaAte: null, desfazer: null });
    await deps.repos.mensagens.atualizarSistema(msg.id, { texto: textoInvalido(card.nome), payload: { ...card, invalida: true } });
    return { data: { aplicada: false, motivo: "rotina_mudou" }, events: [eventoDoCard(deps, rotina, "ritmo_invalidado")] };
  }

  const events: RuntimeEvent[] = [];
  // O "antes" é copiado ANTES de gravar: o repositório pode devolver a mesma referência que acabou de atualizar.
  const antes = { cron: rotina.cron, fusoIana: rotina.fusoIana, estado: rotina.estado };
  let desfazerRitmo: DesfazerRitmo | null = null;
  let extra = "";
  if (input.opcao === "espacar" || input.opcao === "uteis") {
    // O cron vem do domínio sobre o cron ATUAL (igual ao do card, conferido acima), nunca do corpo da requisição.
    const sugestao = sugestaoDeRitmo(rotina.cron, rotina.fusoIana, agora, deps.fusoPadrao ?? FUSO_DA_PESSOA_PADRAO);
    const novo = input.opcao === "espacar" ? (sugestao.espacar ? { cron: sugestao.espacar.cron, fusoIana: rotina.fusoIana } : null) : sugestao.uteis;
    if (!novo) throw new ErroDeDominio("entrada_invalida", { cause: `opção ${input.opcao} não se aplica a esta rotina` });
    const atualizada = exigir(await deps.repos.rotinas.atualizar(rotina.id, { cron: novo.cron, fusoIana: novo.fusoIana, proximaExecucao: proximaJanela({ cron: novo.cron, fusoIana: novo.fusoIana, agora }) }), "nao_encontrado", "rotina");
    desfazerRitmo = { opcao: input.opcao, cronAntes: antes.cron, cronDepois: atualizada.cron, fusoAntes: antes.fusoIana, fusoDepois: atualizada.fusoIana, estadoAntes: antes.estado };
    events.push(evento(deps, "rotina_atualizada", autoria, { rotinaId: rotina.id, proximaExecucao: atualizada.proximaExecucao, fusoIana: atualizada.fusoIana, origem: "ritmo" }, { conversaId: rotina.conversaId }));
  } else if (input.opcao === "pausar") {
    const r = await pausarRotina(deps, { rotinaId: rotina.id, estado: "pausada", semLinha: true });
    events.push(...(r.events ?? []));
    extra = r.data.corte ? fraseDoCorte(r.data.corte) : "";
    desfazerRitmo = { opcao: "pausar", cronAntes: antes.cron, cronDepois: antes.cron, fusoAntes: antes.fusoIana, fusoDepois: antes.fusoIana, estadoAntes: antes.estado };
  }
  await deps.repos.rotinaRitmo.fecharCard(rotina.id, { silenciadaAte: input.opcao === "deixar" ? agora + SILENCIO_DO_DEIXAR_MS : null, desfazer: desfazerRitmo });
  const payload: PayloadRotinaRitmo = { ...card, decisao: { opcao: input.opcao, em: agora, desfazivel: desfazerRitmo !== null } };
  await deps.repos.mensagens.atualizarSistema(msg.id, { texto: textoResolvido(card, input.opcao, extra), payload });
  // Todo desfecho avisa a outra tela aberta (revisão do PR, M5): "Deixar" não muda a rotina, mas muda o card.
  if (!events.some((e) => e.kind === "rotina_atualizada")) events.push(eventoDoCard(deps, rotina, "ritmo"));
  return { data: { aplicada: true }, events };
};

/**
 * "desfazer": restaura o cron (ou reativa a rotina) e reabre o mesmo card, com as opções de novo. Só desfaz se a rotina
 * ainda está como o clique a deixou; se a pessoa já a mudou por outro caminho, não sobrescreve.
 */
async function desfazer(deps: Deps, rotina: Rotina, d: DesfazerRitmo | null, card: PayloadRotinaRitmo, mensagemId: string): Promise<{ data: SaidaRitmo; events?: RuntimeEvent[] }> {
  if (!d || card.decisao === null) return { data: { aplicada: false, motivo: "ja_decidido" } };
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const estadoDepois = d.opcao === "pausar" ? "pausada" : d.estadoAntes;
  if (rotina.excluidoEm !== null || rotina.cron !== d.cronDepois || rotina.fusoIana !== d.fusoDepois || rotina.estado !== estadoDepois) {
    await deps.repos.rotinaRitmo.fecharCard(rotina.id, { silenciadaAte: null, desfazer: null });
    await deps.repos.mensagens.atualizarSistema(mensagemId, { texto: `A rotina “${card.nome}” mudou depois deste ajuste; o desfazer não se aplica mais.`, payload: { ...card, decisao: { ...card.decisao, desfazivel: false }, invalida: true } });
    return { data: { aplicada: false, motivo: "rotina_mudou" }, events: [eventoDoCard(deps, rotina, "ritmo_invalidado")] };
  }
  if (d.opcao === "pausar") {
    if (rotina.estado === "pausada" && d.estadoAntes === "ativa") {
      const r = await pausarRotina(deps, { rotinaId: rotina.id, estado: "ativa", semLinha: true });
      events.push(...(r.events ?? []));
    }
  } else {
    const volta = exigir(await deps.repos.rotinas.atualizar(rotina.id, { cron: d.cronAntes, fusoIana: d.fusoAntes, proximaExecucao: proximaJanela({ cron: d.cronAntes, fusoIana: d.fusoAntes, agora }) }), "nao_encontrado", "rotina");
    events.push(evento(deps, "rotina_atualizada", autoriaPessoa(deps.escopo.pessoaId), { rotinaId: rotina.id, proximaExecucao: volta.proximaExecucao, fusoIana: volta.fusoIana, origem: "ritmo_desfeito" }, { conversaId: rotina.conversaId }));
  }
  await deps.repos.rotinaRitmo.reabrirCard(rotina.id, agora);
  // O card reaberto guarda a revisão da rotina restaurada: o próximo clique confere contra ela.
  const restaurada = (await deps.repos.rotinas.buscar(rotina.id)) ?? rotina;
  await deps.repos.mensagens.atualizarSistema(mensagemId, { texto: textoDoCard(card), payload: { ...card, revisao: revisaoDoRitmo(restaurada), decisao: null } });
  if (!events.some((e) => e.kind === "rotina_atualizada")) events.push(eventoDoCard(deps, restaurada, "ritmo_desfeito"));
  return { data: { aplicada: true }, events };
}
