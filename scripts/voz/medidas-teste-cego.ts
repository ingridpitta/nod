/**
 * As contas do teste cego de voz (definido em 2026-10-05, NOD-166), separadas do script para terem teste. Sem rede,
 * sem disco: o scripts/teste-cego-voz.ts lê o corpus, chama os provedores e passa os textos para cá.
 *
 * Metas (spec da Ada na NOD-166): nomes de bots ≥ 90%, comandos de aprovação ≥ 95%, zero recusa transcrita como
 * aprovação; no TTS, voz com MOS < 3,5 sai do catálogo da Release 1.
 */
import { interpretarComando, type PerfilComando, type ResultadoComando } from "../../src/domain/comando-de-voz.ts";
import { palavrasDaFala } from "../../src/domain/ligacao-turno.ts";

export const META_NOMES = 0.9;
export const META_COMANDOS = 0.95;
export const CORTE_MOS = 3.5;

/** Uma linha do `esperado.json` do corpus (o áudio fica fora do repositório, em NOD_CORPUS_VOZ). */
export type ItemCorpus = {
  arquivo: string;
  /** O que a pessoa disse, para conferência humana (não entra na conta). */
  texto: string;
  /** Nomes de bots ditos na fala; cada um conta como um acerto ou erro. */
  nomes?: string[];
  /** A fala é um comando de aprovação: o perfil da janela e a ação que o orquestrador deveria decidir. */
  comando?: { perfil: PerfilComando; acao: ResultadoComando["acao"]; nomeBot?: string };
};

export type ResultadoStt = {
  nomes: { acertos: number; total: number };
  comandos: { acertos: number; total: number };
  /** Falas que não eram aprovação e viraram aprovação pela transcrição: precisa ser zero. */
  aprovacoesFalsas: { arquivo: string; transcrito: string }[];
  erros: { arquivo: string; motivo: string; transcrito: string }[];
};

export function lerCorpus(json: unknown): ItemCorpus[] {
  if (!Array.isArray(json)) throw new Error("esperado.json precisa ser uma lista de itens { arquivo, texto, nomes?, comando? }");
  return json.map((x, i) => {
    const o = x as Partial<ItemCorpus>;
    if (typeof o.arquivo !== "string" || typeof o.texto !== "string") throw new Error(`item ${i} do esperado.json sem arquivo ou texto`);
    return o as ItemCorpus;
  });
}

/** O nome conta como acertado quando as palavras dele aparecem em sequência na transcrição (sem acento e caixa). */
export function temNome(transcrito: string, nome: string): boolean {
  const t = ` ${palavrasDaFala(transcrito).join(" ")} `;
  return t.includes(` ${palavrasDaFala(nome).join(" ")} `);
}

/** Usa o mesmo classificador do orquestrador (gramática fechada), não uma regex própria. */
export function avaliarStt(itens: readonly ItemCorpus[], transcricoes: ReadonlyMap<string, string>): ResultadoStt {
  const r: ResultadoStt = { nomes: { acertos: 0, total: 0 }, comandos: { acertos: 0, total: 0 }, aprovacoesFalsas: [], erros: [] };
  for (const item of itens) {
    const transcrito = transcricoes.get(item.arquivo) ?? "";
    for (const nome of item.nomes ?? []) {
      r.nomes.total++;
      if (temNome(transcrito, nome)) r.nomes.acertos++;
      else r.erros.push({ arquivo: item.arquivo, motivo: `nome "${nome}"`, transcrito });
    }
    if (item.comando) {
      r.comandos.total++;
      const decidido = interpretarComando(transcrito, item.comando.perfil, item.comando.nomeBot).acao;
      if (decidido === item.comando.acao) r.comandos.acertos++;
      else r.erros.push({ arquivo: item.arquivo, motivo: `comando ${item.comando.acao} → ${decidido}`, transcrito });
      if (decidido === "aprovar" && item.comando.acao !== "aprovar") r.aprovacoesFalsas.push({ arquivo: item.arquivo, transcrito });
    }
  }
  return r;
}

export const taxa = (x: { acertos: number; total: number }): number | null => (x.total === 0 ? null : x.acertos / x.total);

export function aprovado(r: ResultadoStt): boolean {
  const n = taxa(r.nomes);
  const c = taxa(r.comandos);
  return (n === null || n >= META_NOMES) && (c === null || c >= META_COMANDOS) && r.aprovacoesFalsas.length === 0;
}

/**
 * definido em 2026-10-05: as 25 frases do teste cego de TTS, do jeito que o bot fala numa ligação (saudação, resposta,
 * leitura de aprovação, número, nome de app, pergunta, fala de espera).
 */
export const FRASES_TESTE_TTS: readonly string[] = [
  "Oi! Aqui é a Nina. Em que posso te ajudar hoje?",
  "Hum, deixa eu ver isso pra você.",
  "Achei três e-mails do cliente sobre o contrato. Quer que eu resuma?",
  "Mandar um e-mail para a Fernanda com o relatório de setembro. Para aprovar, diga eu aprovo.",
  "Novo bot: Atendente, para responder clientes no WhatsApp. Para criar, diga pode criar.",
  "Pronto, a reunião ficou para quinta-feira, às duas e meia da tarde.",
  "Você tem duas tarefas atrasadas no Linear e uma revisão pendente no GitHub.",
  "Não consegui abrir a planilha. Pode me dar acesso ao Google Drive?",
  "O faturamento de agosto fechou em cento e vinte e oito mil reais, doze por cento acima de julho.",
  "Beleza. Vou criar a rotina para toda segunda, às nove da manhã.",
  "Desculpa, não entendi. Pode repetir?",
  "Tem certeza? Isso apaga os quarenta e dois rascunhos da pasta.",
  "O Chico pediu para você revisar o PR quatrocentos e oitenta e um até amanhã.",
  "Encontrei o voo das sete e quinze para Recife, por oitocentos e noventa reais.",
  "Certo, cancelei. Mais alguma coisa?",
  "A Cecília já aprovou o plano; agora falta só o deploy.",
  "Opção um: mandar agora. Opção dois: agendar para amanhã. Qual você prefere?",
  "Ainda estou procurando, só um instante.",
  "Seu próximo compromisso é a reunião com a equipe de vendas, daqui a vinte minutos.",
  "O e-mail foi enviado para joao.silva arroba empresa ponto com ponto br.",
  "Hoje está ensolarado em São Paulo, com máxima de vinte e nove graus.",
  "Quer que eu avise o time no Slack, no canal de engenharia?",
  "Feito! A Teodora já recebeu a tarefa de QA.",
  "Olha, isso eu não consigo fazer sozinha, mas posso pedir ajuda ao Milton.",
  "Tchau! Qualquer coisa, é só me ligar de novo.",
];

/** Embaralhamento determinístico (mulberry32 + Fisher–Yates): com a mesma semente, o mesmo gabarito. */
export function embaralhar<T>(itens: readonly T[], semente: number): T[] {
  let s = semente >>> 0;
  const aleatorio = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...itens];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export type EntradaGabarito = { amostra: string; voz: string; frase: number };

/** A planilha que volta dos ouvintes: `amostra,ouvinte,nota` (nota de 1 a 5); linha sem nota válida é ignorada. */
export function lerNotas(csv: string): { amostra: string; ouvinte: string; nota: number }[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(",").map((c) => c.trim()))
    .filter((c) => c.length >= 3 && /^[1-5](\.\d+)?$/.test(c[2] ?? ""))
    .map(([amostra, ouvinte, nota]) => ({ amostra: amostra ?? "", ouvinte: ouvinte ?? "", nota: Number(nota) }));
}

export type MosPorVoz = { voz: string; mos: number | null; notas: number; ouvintes: number; sai: boolean };

export function apurarMos(gabarito: readonly EntradaGabarito[], notas: readonly { amostra: string; ouvinte: string; nota: number }[]): MosPorVoz[] {
  const vozDaAmostra = new Map(gabarito.map((g) => [g.amostra, g.voz]));
  const porVoz = new Map<string, { soma: number; n: number; ouvintes: Set<string> }>();
  for (const g of gabarito) if (!porVoz.has(g.voz)) porVoz.set(g.voz, { soma: 0, n: 0, ouvintes: new Set() });
  for (const n of notas) {
    const voz = vozDaAmostra.get(n.amostra);
    const acc = voz ? porVoz.get(voz) : undefined;
    if (!acc) continue;
    acc.soma += n.nota;
    acc.n++;
    acc.ouvintes.add(n.ouvinte);
  }
  return [...porVoz].map(([voz, a]) => {
    const mos = a.n === 0 ? null : Math.round((a.soma / a.n) * 100) / 100;
    return { voz, mos, notas: a.n, ouvintes: a.ouvintes.size, sai: mos !== null && mos < CORTE_MOS };
  });
}
