import { assertFusoIana, parseCron5, proximaJanela, RotinaInvalida } from "./rotina-janela.ts";
import { CRON_SENTINELA_WEBHOOK, type GatilhoWebhook, PROXIMA_WEBHOOK, quandoWebhook, resumoWebhook } from "./rotina-webhook.ts";

/**
 * Regra 9: NENHUM parser de intenção sobrevive aqui. interpretarRotinaTexto/textoTemRecorrencia
 * foram apagados em 2026-09-16 — a rotina chega TIPADA pela ferramenta criar_rotina (o modelo
 * interpreta; o domínio valida e normaliza). Ficam o resumo humano e o validador.
 */
export type RotinaNormalizada = {
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  /** Gate SEMPRE ligado: não sai do texto (E7.3). */
  exigeAprovacao: true;
  proximaExecucao: number;
  resumo: string;
  /** NOD-84: presente = a rotina dispara por webhook; `cron` é a sentinela e `proximaExecucao` nunca vence. */
  webhook?: GatilhoWebhook;
};

/** O mínimo de uma rotina para dizer QUANDO ela roda (NOD-84: horário ou webhook). */
export type QuandoDaRotina = { cron: string; fusoIana: string; gatilho?: "horario" | "webhook"; provedor?: string | null; eventos?: readonly string[] | null };

/** definido em 2026-10-30 (NOD-84): quem lê `rotina.cron` pergunta isto antes — a rotina webhook guarda um cron sentinela. */
export function ehWebhook(r: { gatilho?: "horario" | "webhook" }): boolean {
  return r.gatilho === "webhook";
}

/**
 * O "quando" em português de qualquer rotina: "dias úteis às 08:00 (…)" ou "Quando o Stripe avisa" (NOD-84). Nenhum
 * texto mostra o cron sentinela de uma rotina webhook.
 */
export function quandoDaRotina(r: QuandoDaRotina): string {
  return ehWebhook(r) ? resumoWebhook(r.provedor ?? "provedor") : resumoCron(r.cron, r.fusoIana);
}

/** A próxima execução de qualquer rotina: a rotina webhook nunca vence pelo relógio (NOD-84). */
export function proximaDaRotina(r: QuandoDaRotina, agora: number): number {
  return ehWebhook(r) ? PROXIMA_WEBHOOK : proximaJanela({ cron: r.cron, fusoIana: r.fusoIana, agora });
}

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

function hhmm(hora: number, minuto: number): string {
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

/** Resumo em português do cron, com fuso nomeado: "dias úteis às 08:00 (America/Sao_Paulo)". */
export function resumoCron(cron: string, fusoIana: string): string {
  const c = parseCron5(cron);
  const [minuto, hora] = cron.trim().split(/\s+/);
  let horario: string;
  if (hora === "*" && (minuto === "*" || minuto?.startsWith("*/"))) horario = `a cada ${minuto === "*" ? 1 : Number(minuto?.slice(2))} min`;
  else if (hora?.startsWith("*/") && c.minuto.length === 1) horario = `a cada ${Number(hora.slice(2))} horas, no minuto ${c.minuto[0]}`;
  else if (hora === "*" && c.minuto.length === 1) horario = `a cada hora, no minuto ${c.minuto[0]}`;
  else horario = `às ${c.hora.flatMap((h) => c.minuto.map((m) => hhmm(h, m))).join(", ")}`;
  const partes: string[] = [];
  if (c.diasSemana === "uteis") partes.push("dias úteis");
  else if (c.diasSemana !== "*") partes.push(`toda ${c.diasSemana.map((d) => NOMES_DIA[d] ?? String(d)).join(", ")}`);
  if (c.diasMes !== "*") partes.push(`dia ${c.diasMes.join(", ")}`);
  if (c.mes !== "*") partes.push(`de ${c.mes.map((m) => NOMES_MES[m - 1] ?? String(m)).join(", ")}`);
  const quando = partes.length === 0 ? "todo dia" : partes.join(" ");
  return `${quando} ${horario} (${fusoIana})`;
}

function textoObrigatorio(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.trim() === "") throw new RotinaInvalida("entrada_invalida", `${campo} vazio`);
  return valor.trim();
}

/**
 * Valida a rotina TIPADA vinda de criar_rotina e devolve a forma persistível com próxima execução.
 * Lança fuso_invalido / cron_sem_futuro / entrada_invalida; nunca lê intenção de texto.
 */
export function validarRotinaNormalizada(entrada: {
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  agora: number;
  /** NOD-84: rotina por webhook — o cron recebido é ignorado e vira a sentinela. */
  webhook?: GatilhoWebhook;
}): RotinaNormalizada {
  assertFusoIana(entrada.fusoIana);
  const webhook = entrada.webhook;
  const cron = webhook ? CRON_SENTINELA_WEBHOOK : textoObrigatorio(entrada.cron, "cron");
  parseCron5(cron);
  const proximaExecucao = webhook ? PROXIMA_WEBHOOK : proximaJanela({ cron, fusoIana: entrada.fusoIana, agora: entrada.agora });
  return {
    cron,
    fusoIana: entrada.fusoIana,
    instrucao: textoObrigatorio(entrada.instrucao, "instrucao"),
    fonte: textoObrigatorio(entrada.fonte, "fonte"),
    entregavel: textoObrigatorio(entrada.entregavel, "entregavel"),
    limitesAprovacao: textoObrigatorio(entrada.limitesAprovacao, "limitesAprovacao"),
    politicaSemDado: textoObrigatorio(entrada.politicaSemDado, "politicaSemDado"),
    exigeAprovacao: true,
    proximaExecucao,
    resumo: webhook ? quandoWebhook(webhook) : resumoCron(cron, entrada.fusoIana),
    ...(webhook ? { webhook } : {}),
  };
}

/** Os campos que atualizar_rotina pode mudar; ausente = fica como está. */
export type CamposRotinaAtualizaveis = Partial<Pick<RotinaNormalizada, "cron" | "fusoIana" | "instrucao" | "fonte" | "entregavel" | "limitesAprovacao" | "politicaSemDado">>;

/**
 * Atualização PARCIAL: funde o pedido sobre a rotina atual e revalida o conjunto INTEIRO pelo
 * mesmo validarRotinaNormalizada. Assim um cron novo com o fuso antigo (ou o contrário) é checado
 * junto, e não há um segundo caminho de validação para divergir do primeiro.
 * `mudou` lista os campos que de fato mudam — pedido que não muda nada é `entrada_invalida`,
 * porque virar proposta vazia só gastaria a confirmação da pessoa. `mudaAcessos` (definido em
 * 2026-09-24, "rotina nasce com o acesso"): a mudança que só declara acessos novos também é mudança.
 */
export function validarAtualizacaoRotina(entrada: {
  atual: Pick<RotinaNormalizada, "cron" | "fusoIana" | "instrucao" | "fonte" | "entregavel" | "limitesAprovacao" | "politicaSemDado"> & Pick<QuandoDaRotina, "gatilho" | "provedor" | "eventos">;
  pedido: CamposRotinaAtualizaveis;
  agora: number;
  mudaAcessos?: boolean;
}): { normalizada: RotinaNormalizada; mudou: (keyof CamposRotinaAtualizaveis)[] } {
  // NOD-84 (definido em 2026-10-30): a rotina webhook não tem horário; mudar o cron dela seria trocar o gatilho, que
  // fica fora desta issue (o endereço do provedor ficaria órfão). O resto muda e "o endereço não muda".
  const webhook = ehWebhook(entrada.atual) ? { provedor: entrada.atual.provedor ?? "provedor", eventos: [...(entrada.atual.eventos ?? [])] } : undefined;
  if (webhook && entrada.pedido.cron !== undefined) throw new RotinaInvalida("entrada_invalida", "rotina por webhook não tem horário");
  const chaves = ["cron", "fusoIana", "instrucao", "fonte", "entregavel", "limitesAprovacao", "politicaSemDado"] as const;
  const fundido = { ...entrada.atual };
  const mudou: (keyof CamposRotinaAtualizaveis)[] = [];
  for (const k of chaves) {
    const v = entrada.pedido[k];
    if (v === undefined) continue;
    const limpo = textoObrigatorio(v, k);
    if (limpo === entrada.atual[k]) continue;
    fundido[k] = limpo;
    mudou.push(k);
  }
  if (mudou.length === 0 && entrada.mudaAcessos !== true) throw new RotinaInvalida("entrada_invalida", "nenhum campo muda");
  return { normalizada: validarRotinaNormalizada({ ...fundido, agora: entrada.agora, ...(webhook ? { webhook } : {}) }), mudou };
}
