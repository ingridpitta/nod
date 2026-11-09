import { ehBackchannel, palavrasDaFala } from "./ligacao-turno.ts";

/**
 * Falas de espera da ligação (plano do modo ligação, "Falas de espera"): clipes curtos, gravados uma vez por
 * (provedor, voz, velocidade, id, versão), que tocam enquanto o cérebro pensa ou trabalha. Nunca há TTS ao vivo no
 * caminho crítico; clipe ausente não toca nada. Espera nunca entra no contexto do cérebro nem na transcrição, e nunca
 * toca na janela de aprovação.
 *
 * definido em 2026-10-04: textos NEUTROS em gênero (nada de "pronta/pronto", "obrigado/obrigada"), curtos (≤ 60
 * caracteres) e coloquiais — a mesma biblioteca serve a voz feminina e a masculina.
 */

export const CATEGORIAS_ESPERA = [
  "reconhecimento",
  "pensando",
  "pensando_longo",
  "ferramenta",
  "tarefa_longa",
  "nao_entendi",
  "ociosidade",
  "ociosidade_final",
  "queda_cerebro",
  "queda_midia",
  "voltou",
  "limite_proximo",
  "saudacao_padrao",
  "despedida",
  // definido em 2026-10-05: a frase da rede de segurança (a IA do Mac caiu no meio da ligação). Mora aqui para ser
  // gravada e cacheada como as esperas; quem a toca é o orquestrador (`falarSemIa`), como aviso, nunca `escolherFala`.
  "sem_ia",
  // definido em 2026-10-05 (NOD-168): o aviso único do modo "só legenda" (o TTS falhou 2 frases seguidas). Só toca se o
  // clipe já estiver no cache — é a voz ao vivo que caiu; sem clipe, o aviso sai só escrito. Quem toca é o orquestrador.
  "voz_fora",
  // NOD-167: a vez ficou sem nenhum trecho de resposta no prazo (o cérebro travou); o orquestrador avisa e interrompe.
  "vez_sem_resposta",
] as const;
export type CategoriaEspera = (typeof CATEGORIAS_ESPERA)[number];

/** Ferramentas do nod com fala própria; `conector` é a genérica de app. Sem `ferramenta` = genérica. */
export const FERRAMENTAS_COM_FALA = [
  "criar_rotina",
  "pedir_acesso",
  "pedir_aprovacao",
  "lembrar",
  "ver_colegas",
  "pedir_a_bot",
  "listar_rotinas",
  "atualizar_rotina",
  "conector",
] as const;
export type FerramentaComFala = (typeof FERRAMENTAS_COM_FALA)[number];

export type FalaDeEspera = {
  /** Estável: o cache de áudio é por (provedor, voz, velocidade, id, versao). */
  id: string;
  categoria: CategoriaEspera;
  texto: string;
  /** Sobe quando o TEXTO desta fala muda (o clipe antigo deixa de valer). */
  versao: number;
  ferramenta?: FerramentaComFala;
};

/**
 * definido em 2026-10-04: versão da biblioteca inteira (sobe quando entra ou sai uma fala). 2 em 2026-10-05: `sem_ia`.
 * 3 em 2026-10-05 (NOD-168): `voz_fora`.
 * 4 em 2026-10-06 (NOD-167): `vez_sem_resposta`.
 */
export const VERSAO_FALAS_DE_ESPERA = 4;

type Grupo = { categoria: CategoriaEspera; ferramenta?: FerramentaComFala; textos: readonly string[] };

const GRUPOS: readonly Grupo[] = [
  { categoria: "reconhecimento", textos: ["Tá.", "Entendi.", "Certo.", "Hum, tá.", "Ah, entendi.", "Beleza.", "Tá bom.", "Saquei."] },
  {
    categoria: "pensando",
    textos: ["Hum, deixa eu ver…", "Só um instante…", "Tô vendo aqui…", "Deixa eu pensar…", "Um segundinho…", "Peraí, deixa eu ver…", "Vamos ver…", "Hum…"],
  },
  {
    categoria: "pensando_longo",
    textos: ["Ainda tô vendo aqui, só mais um pouco…", "Tá quase, só mais um instante…", "Já já te falo…", "Só mais um pouquinho…", "Tô terminando de ver aqui…", "Calma que já te respondo…"],
  },
  { categoria: "ferramenta", textos: ["Tô fazendo isso agora…", "Só um instante, tô mexendo aqui…", "Tô cuidando disso…", "Deixa eu fazer isso aqui…"] },
  { categoria: "ferramenta", ferramenta: "criar_rotina", textos: ["Tô montando a rotina…", "Deixa eu criar essa rotina…"] },
  { categoria: "ferramenta", ferramenta: "pedir_acesso", textos: ["Vou pedir o acesso…", "Tô preparando o pedido de acesso…"] },
  { categoria: "ferramenta", ferramenta: "pedir_aprovacao", textos: ["Vou deixar isso pra você aprovar…", "Tô preparando pra você aprovar…"] },
  { categoria: "ferramenta", ferramenta: "lembrar", textos: ["Deixa eu guardar isso…", "Vou guardar isso aqui…"] },
  { categoria: "ferramenta", ferramenta: "ver_colegas", textos: ["Deixa eu ver os colegas…", "Tô olhando o que o time faz…"] },
  { categoria: "ferramenta", ferramenta: "pedir_a_bot", textos: ["Vou pedir ajuda pra um colega…", "Tô chamando um colega…"] },
  { categoria: "ferramenta", ferramenta: "listar_rotinas", textos: ["Deixa eu ver as rotinas…", "Tô olhando suas rotinas…"] },
  { categoria: "ferramenta", ferramenta: "atualizar_rotina", textos: ["Tô ajustando a rotina…", "Deixa eu mudar essa rotina…"] },
  { categoria: "ferramenta", ferramenta: "conector", textos: ["Tô olhando no app…", "Só um instante, tô vendo no app…", "Consultando aqui no app…"] },
  {
    categoria: "tarefa_longa",
    textos: [
      "Isso leva um tempinho. Pode ir falando comigo.",
      "Vai demorar um pouquinho, mas tô nisso.",
      "Ainda tô nisso. Te aviso quando terminar.",
      "Tá andando. Pode falar comigo enquanto isso.",
      "Segue rodando. Assim que acabar, te falo.",
      "Demora um pouco mesmo. Sigo aqui.",
      "Tô nessa ainda. Quer falar de outra coisa?",
    ],
  },
  {
    categoria: "nao_entendi",
    textos: [
      "Desculpa, não peguei.",
      "Não entendi, pode repetir?",
      "Hum, não ouvi direito. Repete?",
      "Pode falar de novo?",
      "Cortou aqui. Pode repetir?",
      "Foi mal, não captei. Fala de novo?",
      "Não consegui ouvir. Repete pra mim?",
    ],
  },
  {
    categoria: "ociosidade",
    textos: ["Pode falar, tô ouvindo.", "Tô aqui, pode falar.", "Ainda tá aí?", "Quando quiser, é só falar.", "Tô te ouvindo.", "Sem pressa, tô aqui.", "Quer falar mais alguma coisa?"],
  },
  {
    categoria: "ociosidade_final",
    textos: ["Vou desligar por agora. Qualquer coisa, me liga.", "Parece que você saiu. Vou encerrar. Até mais!", "Vou deixar você à vontade. Até mais!"],
  },
  {
    categoria: "queda_cerebro",
    textos: ["Perdi a conexão com o seu Mac; já volto.", "Opa, caiu a conexão com o Mac. Tô tentando voltar…", "Um instante, a conexão com o Mac caiu…"],
  },
  { categoria: "queda_midia", textos: ["A ligação tá falhando. Tô tentando reconectar…", "Opa, o áudio caiu. Um instante…", "Tô com problema na conexão. Já volto…"] },
  { categoria: "voltou", textos: ["Voltei!", "Voltei! Onde a gente estava?", "Tô de volta.", "Opa, voltou. Pode falar."] },
  { categoria: "limite_proximo", textos: ["Temos só mais um minuto de ligação.", "Falta um minuto pro fim da ligação.", "Só mais um minutinho e a ligação acaba."] },
  { categoria: "saudacao_padrao", textos: ["Oi! Tô aqui.", "Oi! Pode falar.", "Oi, tudo bem? Tô ouvindo."] },
  { categoria: "despedida", textos: ["Até mais!", "Tchau, até mais!", "Falou! Até a próxima.", "Até logo!"] },
  // Uma frase só, a do protótipo aprovado em 2026-10-05: ela aponta para a tela, onde estão o motivo e as saídas.
  { categoria: "sem_ia", textos: ["Não consegui usar a IA deste Mac. As opções estão na tela."] },
  { categoria: "voz_fora", textos: ["A voz falhou. Sigo por escrito, na legenda e no chat."] },
  // NOD-167: a IA não mandou nada no prazo e a vez foi interrompida; a pessoa precisa saber que pode repetir.
  { categoria: "vez_sem_resposta", textos: ["A IA não me respondeu. Pode repetir, por favor?", "Não veio resposta da IA. Fala de novo?", "Travou aqui e a IA não respondeu. Repete pra mim?"] },
];

function montarFalas(): readonly FalaDeEspera[] {
  const falas: FalaDeEspera[] = [];
  for (const g of GRUPOS) {
    const prefixo = g.ferramenta ? `${g.categoria}.${g.ferramenta}` : g.categoria;
    g.textos.forEach((texto, i) => {
      const fala: FalaDeEspera = { id: `${prefixo}.${String(i + 1).padStart(2, "0")}`, categoria: g.categoria, texto, versao: 1 };
      if (g.ferramenta) fala.ferramenta = g.ferramenta;
      falas.push(fala);
    });
  }
  return falas;
}

export const FALAS_DE_ESPERA: readonly FalaDeEspera[] = montarFalas();

/** Chave do clipe no cache de áudio. */
export function chaveDoClipe(p: { provedor: string; voz: string; velocidade: number; fala: Pick<FalaDeEspera, "id" | "versao"> }): string {
  return `${p.provedor}/${p.voz}/${p.velocidade}/${p.fala.id}@${p.fala.versao}`;
}

/**
 * Quando cada espera toca (ms). definido em 2026-10-04, tabela do plano: reconhecimento 300 ms (200 se o p50 do
 * cérebro passar de 1,5 s), pensando 1,6 s e outra variante aos 4 s, ferramenta 1,2 s após o início sem narração,
 * tarefa longa aos 8, 20 e 45 s e depois a cada 60 s (no máximo 4), ociosidade 7 e 20 s após pergunta do bot,
 * despedida aos 3 min; pelo menos 2 s entre esperas e nenhum clipe repetido em 60 s.
 */
export const TEMPOS_ESPERA = {
  reconhecimentoMs: 300,
  reconhecimentoCerebroLentoMs: 200,
  cerebroLentoP50Ms: 1500,
  pensandoMs: 1600,
  pensandoLongoMs: 4000,
  ferramentaMs: 1200,
  tarefaLongaMs: [8000, 20000, 45000],
  tarefaLongaIntervaloMs: 60000,
  tarefaLongaMax: 4,
  ociosidadeMs: [7000, 20000],
  ociosidadeFinalMs: 180000,
  intervaloMinimoMs: 2000,
  naoRepetirMs: 60000,
  reconhecimentoProporcao: 0.4,
  /**
   * NOD-167 (definido em 2026-10-05, começa em 20 s): a vez sem nenhum trecho de resposta e sem ferramenta neste
   * prazo vira aviso falado (`vez_sem_resposta`) e interrupção dura do cérebro (no Codex, `turn/interrupt`).
   */
  vezSemRespostaMs: 20000,
} as const;

/** Uma espera que já tocou. */
export type EsperaTocada = { id: string; categoria: CategoriaEspera; em: number };

export type EstadoEspera = {
  botFalando: boolean;
  pessoaFalando: boolean;
  /** Janela de aprovação aberta: nenhuma espera toca. */
  janelaAprovacao: boolean;
  onboarding: boolean;
  /** O sorteio desta vez (`sortearReconhecimento`), feito quando a vez da pessoa fechou. */
  reconhecer: boolean;
  /** Mediana da latência do cérebro nesta ligação, ou null antes da primeira resposta. */
  p50CerebroMs: number | null;
  /** A vez foi entregue ao cérebro e nenhum trecho de resposta chegou ainda; null fora dessa espera. */
  aguardandoRespostaDesde: number | null;
  /** Ferramenta em curso; `narrada` = o bot anunciou antes ("Vou ver sua agenda"). */
  ferramenta: { nome: string; desde: number; narrada: boolean } | null;
  /** Desde quando o bot trabalha sem falar; ausente = conta de `aguardandoRespostaDesde`. */
  trabalhandoDesde: number | null;
  /** O bot terminou de falar uma pergunta e a pessoa ainda não respondeu. */
  perguntaDoBotEm: number | null;
  /** Último som de verdade na ligação (pessoa ou bot); esperas não contam. */
  ultimaAtividadeEm: number;
  /** Card, tarefa ou login aberto: a despedida por ociosidade fica suspensa. */
  ociosidadeSuspensa: boolean;
  historico: readonly EsperaTocada[];
};

export type DecisaoEspera = { categoria: CategoriaEspera; ferramenta?: string };

function tocadasDesde(historico: readonly EsperaTocada[], categoria: CategoriaEspera, desde: number): number {
  return historico.filter((h) => h.categoria === categoria && h.em >= desde).length;
}

/** Quando toca a k-ésima espera de tarefa longa (contada desde o começo do trabalho), ou null depois da última. */
function proximaTarefaLonga(k: number): number | null {
  const t = TEMPOS_ESPERA;
  if (k >= t.tarefaLongaMax) return null;
  const fixos: readonly number[] = t.tarefaLongaMs;
  return fixos[k] ?? fixos[fixos.length - 1]! + t.tarefaLongaIntervaloMs * (k - fixos.length + 1);
}

/**
 * Que espera tocar agora, ou null. Determinística: o sorteio do reconhecimento já vem em `estado.reconhecer`.
 * definido em 2026-10-04: nada toca com alguém falando, na janela de aprovação ou a menos de 2 s da última espera; a
 * prioridade é despedida por ociosidade > ferramenta > reconhecimento > pensando > pensando longo > tarefa longa >
 * ociosidade.
 */
export function decidirEspera(estado: EstadoEspera, agora: number): DecisaoEspera | null {
  const t = TEMPOS_ESPERA;
  if (estado.janelaAprovacao || estado.botFalando || estado.pessoaFalando) return null;
  const ultima = estado.historico.reduce((m, h) => Math.max(m, h.em), Number.NEGATIVE_INFINITY);
  if (agora - ultima < t.intervaloMinimoMs) return null;
  const h = estado.historico;

  const ocupado = estado.aguardandoRespostaDesde !== null || estado.trabalhandoDesde !== null || estado.ferramenta !== null;
  if (!ocupado && !estado.ociosidadeSuspensa && agora - estado.ultimaAtividadeEm >= t.ociosidadeFinalMs && tocadasDesde(h, "ociosidade_final", estado.ultimaAtividadeEm) === 0) {
    return { categoria: "ociosidade_final" };
  }

  const f = estado.ferramenta;
  if (f && !f.narrada && agora - f.desde >= t.ferramentaMs && tocadasDesde(h, "ferramenta", f.desde) === 0) {
    return { categoria: "ferramenta", ferramenta: f.nome };
  }

  const desde = estado.aguardandoRespostaDesde;
  if (desde !== null) {
    const dt = agora - desde;
    const limiarReconhecimento = estado.p50CerebroMs !== null && estado.p50CerebroMs > t.cerebroLentoP50Ms ? t.reconhecimentoCerebroLentoMs : t.reconhecimentoMs;
    const nadaTocouNestaVez = h.every((x) => x.em < desde);
    if (estado.reconhecer && !estado.onboarding && dt >= limiarReconhecimento && dt < t.pensandoMs && nadaTocouNestaVez) return { categoria: "reconhecimento" };
    if (f === null) {
      if (dt >= t.pensandoMs && tocadasDesde(h, "pensando", desde) === 0) return { categoria: "pensando" };
      if (dt >= t.pensandoLongoMs && tocadasDesde(h, "pensando_longo", desde) === 0) return { categoria: "pensando_longo" };
    }
  }

  const trabalho = estado.trabalhandoDesde ?? desde;
  if (trabalho !== null) {
    const proxima = proximaTarefaLonga(tocadasDesde(h, "tarefa_longa", trabalho));
    if (proxima !== null && agora - trabalho >= proxima) return { categoria: "tarefa_longa" };
    return null;
  }

  const pergunta = estado.perguntaDoBotEm;
  if (pergunta !== null) {
    const k = tocadasDesde(h, "ociosidade", pergunta);
    const limiar = t.ociosidadeMs[k];
    if (limiar !== undefined && agora - pergunta >= limiar) return { categoria: "ociosidade" };
  }
  return null;
}

/** Conversa social curta não ganha reconhecimento ("Tá." depois de "oi" soa robótico). */
const VOCABULARIO_SOCIAL = new Set([
  "oi", "ola", "opa", "eai", "e", "ai", "tudo", "bem", "bom", "boa", "dia", "tarde", "noite", "como", "vai", "voce", "vc",
  "obrigado", "obrigada", "valeu", "brigado", "brigada", "tchau", "ate", "mais", "logo", "certo", "beleza", "blz", "tranquilo",
  "joia", "td", "com", "contigo", "ta", "esta", "aqui", "alo", "hey", "salve", "fala", "otimo", "legal", "massa",
]);

/** definido em 2026-10-04: até 6 palavras, todas do vocabulário de cumprimento e agradecimento. */
export function ehConversaSocial(texto: string, nomeBot?: string): boolean {
  const nome = nomeBot ? new Set(palavrasDaFala(nomeBot)) : new Set<string>();
  const palavras = palavrasDaFala(texto).filter((p) => !nome.has(p));
  return palavras.length > 0 && palavras.length <= 6 && palavras.every((p) => VOCABULARIO_SOCIAL.has(p));
}

/** definido em 2026-10-04: pedido = pelo menos 3 palavras que não são cumprimento nem backchannel. */
export function ehPedido(texto: string, nomeBot?: string): boolean {
  return !ehConversaSocial(texto, nomeBot) && !ehBackchannel(texto) && palavrasDaFala(texto).length >= 3;
}

/** O sorteio do reconhecimento para esta vez: só em pedido, em ≤ 40% das vezes, nunca no onboarding. */
export function sortearReconhecimento(p: { texto: string; onboarding: boolean; aleatorio: () => number; nomeBot?: string }): boolean {
  if (p.onboarding || !ehPedido(p.texto, p.nomeBot)) return false;
  return p.aleatorio() < TEMPOS_ESPERA.reconhecimentoProporcao;
}

/** Categorias que avisam algo: tocam mesmo repetidas (melhor repetir que calar) e não esperam os 2 s. */
const INFORMATIVAS: ReadonlySet<CategoriaEspera> = new Set(["ociosidade_final", "queda_cerebro", "queda_midia", "voltou", "limite_proximo", "saudacao_padrao", "despedida", "vez_sem_resposta"]);

/** O grupo de falas para uma ferramenta: a dela, a de app (nome com "__") ou a genérica. */
function grupoDaFerramenta(ferramenta: string | undefined): FerramentaComFala | undefined {
  if (ferramenta === undefined) return undefined;
  const nome = ferramenta.replace(/^mcp__nod__/u, "");
  const propria = FERRAMENTAS_COM_FALA.find((f) => f === nome);
  if (propria !== undefined) return propria;
  return nome.includes("__") ? "conector" : undefined;
}

function sortear<T>(lista: readonly T[], aleatorio: () => number): T | null {
  if (lista.length === 0) return null;
  const i = Math.min(lista.length - 1, Math.max(0, Math.floor(aleatorio() * lista.length)));
  return lista[i] ?? null;
}

/**
 * Escolhe a fala de uma categoria sem repetir as últimas ⌈n/2⌉ dela nem nenhuma dos últimos 60 s, com ≥ 2 s desde a
 * última espera. definido em 2026-10-04: sem candidata, a de ferramenta cai na genérica; as informativas tocam a
 * menos recente; as demais calam (null).
 */
export function escolherFala(categoria: CategoriaEspera, historico: readonly EsperaTocada[], agora: number, aleatorio: () => number, ferramenta?: string): FalaDeEspera | null {
  const t = TEMPOS_ESPERA;
  const informativa = INFORMATIVAS.has(categoria);
  const ultima = historico.reduce((m, h) => Math.max(m, h.em), Number.NEGATIVE_INFINITY);
  if (!informativa && agora - ultima < t.intervaloMinimoMs) return null;

  const livres = (pool: readonly FalaDeEspera[]): FalaDeEspera[] => {
    const ids = new Set(pool.map((f) => f.id));
    const recentesDaCategoria = historico.filter((h) => ids.has(h.id)).sort((a, b) => b.em - a.em).slice(0, Math.ceil(pool.length / 2)).map((h) => h.id);
    const bloqueadas = new Set([...recentesDaCategoria, ...historico.filter((h) => agora - h.em < t.naoRepetirMs).map((h) => h.id)]);
    return pool.filter((f) => !bloqueadas.has(f.id));
  };

  const grupo = categoria === "ferramenta" ? grupoDaFerramenta(ferramenta) : undefined;
  const daCategoria = FALAS_DE_ESPERA.filter((f) => f.categoria === categoria);
  const pool = categoria === "ferramenta" ? daCategoria.filter((f) => f.ferramenta === grupo) : daCategoria;
  const escolhida = sortear(livres(pool), aleatorio);
  if (escolhida) return escolhida;
  if (categoria === "ferramenta" && grupo !== undefined) {
    const generica = sortear(livres(daCategoria.filter((f) => f.ferramenta === undefined)), aleatorio);
    if (generica) return generica;
  }
  if (!informativa) return null;
  const quando = (id: string) => historico.filter((h) => h.id === id).reduce((m, h) => Math.max(m, h.em), Number.NEGATIVE_INFINITY);
  return [...pool].sort((a, b) => quando(a.id) - quando(b.id) || a.id.localeCompare(b.id))[0] ?? null;
}
