import type { AcaoNoLote, MotivoCardDoLote, PayloadPropostaLoteBots, Proposta } from "../../src/contracts/conversa.ts";
import { cardProposta, MAX_LINHAS } from "../lib/card-proposta.ts";
import { botao, esc } from "../lib/render.ts";

/** O card do lote do Nod (definido em 2026-10-07, ADR-082), fora de conversa.ts como card-perfil e card-pasta. */

const VERBO_DO_LOTE: Record<AcaoNoLote["tipo"], string> = {
  criar: "Criar",
  duplicar: "Duplicar",
  editar: "Editar",
  mover: "Mover",
  excluir: "Excluir",
  criar_rotina: "Criar rotina",
  dar_acesso: "Dar acesso",
  mudar_modo: "Mudar modo",
  restaurar_versao: "Restaurar versão de",
  excluir_time: "Excluir o time",
  remover_computador: "Remover o nod de",
  acessos_em_lote: "Mudar o acesso de",
  padrao_acesso: "Padrão do app",
  desfazer_acessos: "Desfazer acessos no",
};
const NIVEL_HUMANO: Record<NonNullable<AcaoNoLote["nivel_lote"]>, string> = { nenhum: "Nenhum", leitura: "Ler", escrita: "Ler e alterar" };
const MODO_HUMANO: Record<NonNullable<AcaoNoLote["modo"]>, string> = { manual: "manual", automatico: "automático", total: "sem aprovações" };
/** Por que a ação esperou você, quando não foi só o modo manual (QA de 2026-10-07: uma frase por tipo, não uma genérica). */
function motivoDoLote(a: AcaoNoLote, motivo: Exclude<MotivoCardDoLote, "manual">): string {
  // Emenda de 2026-10-18 da ADR-059: ligar o total é sempre da pessoa, em qualquer modo do Nod.
  if (a.tipo === "remover_computador") return "Tirar o nod de um computador sempre espera o seu ok. Dá para instalar de novo depois.";
  // ADA-241: Ler e alterar para vários bots, ou como padrão do app, deixa cada um mudar coisas fora do nod.
  if (motivo === "acesso_escrita") return a.tipo === "padrao_acesso" ? `Com Ler e alterar como padrão, cada bot novo já nasce podendo mudar coisas no ${a.app ?? "app"}. Por isso espera o seu ok.` : `Ler e alterar deixa cada bot mudar coisas no ${a.app ?? "app"} (enviar, apagar, editar). Por isso espera o seu ok.`;
  if (motivo === "ligar_total") return "Ignorar todas as aprovações só liga com o seu ok: o Nod nunca põe um bot nesse modo sozinho.";
  if (a.tipo === "excluir_time") return "Excluir um time com bots espera o seu ok. Dá para criar o time de novo depois.";
  if (motivo === "arriscada") return a.tipo === "excluir" ? "Excluir é arriscado: o Nod sempre pergunta antes. Dá para restaurar depois em Configurações › Agentes." : "Mudar o modo de um bot é arriscado: o Nod sempre pergunta antes.";
  return a.tipo === "dar_acesso" ? "O Nod leu conteúdo de fora nesta conversa, então dar acesso a um app espera você." : "O Nod leu conteúdo de fora nesta conversa, então esta mudança espera você.";
}

function juntar(nomes: readonly string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** ADA-245 (critério 4): o card nomeia quem assume, como o diálogo; sem ninguém (o único computador), os bots esperam. */
function destinoDosBots(n: number, assume: string | null | undefined): string {
  if (assume === null) return n === 1 ? "espera um computador" : "esperam um computador";
  return `${n === 1 ? "passa" : "passam"} para ${assume ?? "o computador padrão"}`;
}

function detalheDaAcao(a: AcaoNoLote): string {
  switch (a.tipo) {
    case "criar": return [a.secao ? `em ${a.secao}` : "", a.descricao ?? ""].filter(Boolean).join(" · ");
    case "duplicar": return "leva memória, acessos e rotinas do original; as rotinas vêm pausadas; começa em Aprovar automaticamente; mude em Aprovações";
    case "editar": return [a.nome ? `nome: ${a.nome}` : "", a.titulo !== undefined ? `título: ${a.titulo || "—"}` : "", a.modelo ? `modelo: ${a.modelo}` : "", a.esforco !== undefined ? `esforço: ${a.esforco || "padrão"}` : "", a.descricao ? "descrição nova" : ""].filter(Boolean).join(" · ");
    case "mover": return a.secao ? `para ${a.secao}` : "para Sem time";
    case "excluir": return "dá para restaurar depois em Configurações › Agentes";
    case "criar_rotina": return [a.cron ? `${a.cron} (${a.fuso_iana ?? ""})` : "", a.instrucao ?? ""].filter(Boolean).join(" · ");
    case "dar_acesso": return `${a.app ?? ""}, ${a.nivel === "escrita" ? "ler e alterar" : "ler"}`;
    case "mudar_modo": return a.modo ? `para ${MODO_HUMANO[a.modo]}` : "";
    case "excluir_time": return a.membros?.length ? `${juntar(a.membros)} ${a.membros.length === 1 ? "vai" : "vão"} para Sem time, na mesma ordem. Nenhum bot é excluído.` : "o time está vazio";
    case "remover_computador": return [a.membros?.length ? `${juntar(a.membros)} ${destinoDosBots(a.membros.length, a.assume_nome)}` : "nenhum bot roda lá", a.manter_ias ? "o Claude e o ChatGPT ficam lá" : "tira também o Claude e o ChatGPT que o nod instalou", a.manter_conexao ? "continua ligado à sua conta" : "sai da sua conta"].join(" · ");
    case "acessos_em_lote": return a.todos ? `${a.app ?? ""}, ${NIVEL_HUMANO[a.nivel_lote ?? "nenhum"]} para todos os bots` : `${a.app ?? ""}, ${NIVEL_HUMANO[a.nivel_lote ?? "nenhum"]}: ${juntar(a.bots_nomes ?? [])}`;
    case "padrao_acesso": return `${a.app ?? ""}: bots novos começam com ${NIVEL_HUMANO[a.nivel_lote ?? "nenhum"]}${a.aplicar === false ? "" : "; quem segue o padrão também muda"}`;
    case "desfazer_acessos": return `${a.app ?? ""}: volta cada bot ao nível de antes`;
    case "restaurar_versao": return a.versao ? `volta o perfil à versão ${a.versao}; vira uma versão nova, dá para desfazer pelo Histórico` : "";
    default: return "";
  }
}

/**
 * O card do lote do Nod (ADR-082): cada ação com caixa de marcar enquanto o card está aberto; as já feitas pelo modo
 * aparecem como "feito"; depois de decidido, cada uma com o desfecho. "Aprovar" manda os índices marcados.
 * `aberto` = a proposta pendente com a decisão de mesmo id aberta em "Sua vez" (quem chama confere).
 */
export function renderCardLote(p: Pick<Proposta, "id">, c: PayloadPropostaLoteBots, aberto: boolean): string {
  const esperando = c.acoes.filter((a) => a.estado === "esperando").length;
  // NOD-437 (protótipo aprovado): o card de excluir um time é uma pergunta direta, com o verbo no botão.
  const soTime = c.acoes.filter((a) => a.estado === "esperando");
  if (aberto && soTime.length === 1 && soTime[0]!.tipo === "remover_computador") {
    const t = soTime[0]!;
    return cardProposta({
      id: p.id,
      classe: "card-lote card-remover-computador",
      titulo: `Remover o nod de ${t.alvoNome}?`,
      linhas: [esc(detalheDaAcao(t))],
      extra: `<input type="checkbox" data-lote-i="${t.i}" checked hidden aria-hidden="true" />`,
      acoes: `${botao("decidir-lote", "Remover", { classe: "cp-sim", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}`,
    });
  }
  if (aberto && soTime.length === 1 && soTime[0]!.tipo === "excluir_time") {
    const t = soTime[0]!;
    return cardProposta({
      id: p.id,
      classe: "card-lote card-excluir-time",
      titulo: `Excluir o time ${t.alvoNome}?`,
      linhas: [esc(detalheDaAcao(t))],
      extra: `<input type="checkbox" data-lote-i="${t.i}" checked hidden aria-hidden="true" />`,
      acoes: `${botao("decidir-lote", "Excluir time", { classe: "cp-sim", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}`,
    });
  }
  // ADA-241: o card de um lote de acesso (ou do padrão) também é pergunta direta, com o verbo no botão e o porquê.
  if (aberto && soTime.length === 1 && (soTime[0]!.tipo === "acessos_em_lote" || soTime[0]!.tipo === "padrao_acesso")) {
    const t = soTime[0]!;
    const nivel = NIVEL_HUMANO[t.nivel_lote ?? "nenhum"];
    const quem = t.todos ? "todos os bots" : `${t.bots_nomes?.length ?? 0} ${t.bots_nomes?.length === 1 ? "bot" : "bots"}`;
    const titulo = t.tipo === "padrao_acesso" ? `Bots novos começam com ${nivel} no ${t.app ?? "app"}?` : `Dar ${nivel} no ${t.app ?? "app"} a ${quem}?`;
    return cardProposta({
      id: p.id,
      classe: "card-lote card-acessos-lote",
      titulo,
      linhas: [esc(detalheDaAcao(t)), ...(t.motivo && t.motivo !== "manual" ? [`<small class="lote-motivo">${esc(motivoDoLote(t, t.motivo))}</small>`] : [])],
      extra: `<input type="checkbox" data-lote-i="${t.i}" checked hidden aria-hidden="true" />`,
      acoes: `${botao("decidir-lote", t.tipo === "padrao_acesso" ? "Definir padrão" : `Dar ${nivel}`, { classe: "cp-sim", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}`,
    });
  }
  const linhas = c.acoes.map((a) => ({ espera: a.estado === "esperando", html: linhaDaAcao(a) }));
  function linhaDaAcao(a: AcaoNoLote): string {
    const marca = a.estado === "feita" ? '<span class="tag tag-ok">feito</span>' : a.estado === "falhou" ? `<span class="tag tag-cinza">não deu certo${a.erro ? ` (${esc(a.erro.replaceAll("_", " "))})` : ""}</span>` : a.estado === "recusada" ? '<span class="tag tag-cinza">não feito</span>' : !aberto ? '<span class="tag tag-cinza">não decidido</span>' : "";
    const caixa = a.estado === "esperando" && aberto ? `<input type="checkbox" data-lote-i="${a.i}" checked aria-label="${esc(`${VERBO_DO_LOTE[a.tipo]} ${a.alvoNome}`)}" />` : "";
    const detalhe = detalheDaAcao(a);
    const motivo = a.estado === "esperando" && a.motivo && a.motivo !== "manual" ? `<small class="lote-motivo">${esc(motivoDoLote(a, a.motivo))}</small>` : "";
    return `<label class="lote-acao">${caixa}<span class="lote-texto"><span><i class="lote-verbo">${esc(VERBO_DO_LOTE[a.tipo])}</i><b>${esc(a.alvoNome)}</b>${marca}</span>${detalhe ? `<small>${esc(detalhe)}</small>` : ""}${motivo}</span></label>`;
  }
  // NOD-399 (definido em 2026-10-30): o componente comum. Sem o cabeçalho "O Nod propõe". Revisão 3 do PR #607: o título
  // é uma frase com o verbo ("Aplicar 3 mudanças nos seus bots") e o resumo do Nod vira a linha; até 3 ações ficam à
  // vista e o resto em "Mais N", recolhido — as caixas continuam no DOM (marcadas) sob o [data-proposta].
  const titulo = aberto ? `Aplicar ${esperando} ${esperando === 1 ? "mudança" : "mudanças"} nos seus bots` : "Mudanças nos seus bots";
  const botoes = aberto ? `${botao("decidir-lote", "Aprovar marcadas", { classe: "cp-sim", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}` : "";
  // Revisão 4: o que espera a pessoa (marcado, o que "Aprovar marcadas" faz) NUNCA fica recolhido — a pessoa vê o que
  // aprova antes do clique (ADR-082, cerca 3). Só o que já tem desfecho (feito, não feito, falhou) vai para "Mais N".
  const vista = aberto ? [...linhas.filter((l) => l.espera), ...linhas.filter((l) => !l.espera)] : linhas;
  const nVista = Math.max(MAX_LINHAS, aberto ? linhas.filter((l) => l.espera).length : 0);
  const resto = vista.slice(nVista).map((l) => l.html);
  const mais = resto.length ? `<details class="cp-detalhes lote-mais" data-disclosure="lote-${esc(p.id)}"><summary>Mais ${resto.length}</summary><div class="lote-acoes">${resto.join("")}</div></details>` : "";
  return cardProposta({
    id: p.id,
    classe: "card-lote",
    titulo,
    linhas: c.resumo ? [esc(c.resumo)] : [],
    extra: `<div class="lote-acoes">${vista.slice(0, nVista).map((l) => l.html).join("")}</div>${mais}`,
    acoes: botoes,
  });
}

/**
 * As ações que esperam, em lista curta, para "Sua vez" (revisão de 2026-10-07): lá o botão aprova todas de uma vez, então
 * a pessoa vê o que está aprovando — inclusive um excluir — antes do clique. Desmarcar uma é no card da conversa do Nod.
 */
export function listaDoLoteParaSuaVez(c: PayloadPropostaLoteBots): string {
  const esperando = c.acoes.filter((a) => a.estado === "esperando");
  if (esperando.length === 0) return "";
  return `<ul class="lote-sua-vez">${esperando.map((a) => `<li><i class="lote-verbo">${esc(VERBO_DO_LOTE[a.tipo])}</i>${esc(a.alvoNome)}${detalheDaAcao(a) ? ` <small>${esc(detalheDaAcao(a))}</small>` : ""}</li>`).join("")}</ul>`;
}
