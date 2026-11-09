import type { CampoEntrevista, CamposEntrevista, EtapaOnboarding, IdObjetivo, ModeloDeBot, PassoConfiguracao, TamanhoTime } from "../contracts/onboarding.ts";
import { APELIDO_MAX, COMO_CONHECEU_MAX, OBJETIVO_MAX, TAMANHOS_TIME } from "../contracts/onboarding.ts";

/**
 * O roteiro do onboarding por ligação (definido em 2026-10-04, ADR-077; textos do protótipo "HiFiMac" aprovado em
 * 2026-10-03). Puro: a primeira fala, as quatro perguntas, os chips "Diga algo como", o resumo "Certo?", os quatro
 * modelos de bot e o passo da configuração guiada. Quem conduz é o orquestrador; o modelo só extrai os campos
 * (anotar_entrevista) e fala.
 */

/**
 * revisto em 2026-10-07 (ADR-081): a guia do onboarding é o Nod, o bot fixo da pessoa (antes a "Nina", uma bot comum
 * que podia ser excluída). Ele fica depois do onboarding: ajuda, tira dúvidas e mexe nos outros bots.
 */
export const NOME_DO_NOD = "Nod";

/** A primeira fala da ligação de onboarding (o orquestrador fala sem esperar o cérebro). */
export function saudacaoDoOnboarding(nomeGuia: string): string {
  return `Oi! Eu sou o ${nomeGuia}, seu bot fixo aqui no nod. Como você quer que eu te chame?`;
}

export const PERGUNTAS_ENTREVISTA: Record<CampoEntrevista, string> = {
  apelido: "Como você quer que eu te chame?",
  como_conheceu: "Como você conheceu o nod?",
  objetivo: "E o que te fez baixar o nod? O que você quer que os bots façam por você?",
  tamanho_time: "Última pergunta, quantas pessoas trabalham com você?",
};

const ORDEM: readonly CampoEntrevista[] = ["apelido", "como_conheceu", "objetivo", "tamanho_time"];

function valorDe(c: CamposEntrevista, campo: CampoEntrevista): string | null {
  if (campo === "apelido") return c.apelido;
  if (campo === "como_conheceu") return c.comoConheceu;
  if (campo === "objetivo") return c.objetivo;
  return c.tamanhoTime;
}

/** Os campos que ainda faltam, na ordem do roteiro. */
export function camposQueFaltam(c: CamposEntrevista): CampoEntrevista[] {
  return ORDEM.filter((campo) => !valorDe(c, campo));
}

export const MODELOS_DE_BOT: Record<IdObjetivo, ModeloDeBot> = {
  clientes: {
    objetivo: "clientes",
    fala: "Responder clientes mais rápido",
    curto: "responder clientes mais rápido",
    nome: "Atendente",
    papel: "Clientes",
    descricao: "Lê os e-mails de clientes, separa o que pede resposta e escreve rascunhos no meu tom. Nunca envia sem eu aprovar.",
    forma: "shape-triangle",
    cor: "c-amber",
    app: { slug: "gmail", nome: "Gmail", letra: "G", cor: "#d93025" },
    pode: ["Ler e-mails da caixa de entrada", "Criar rascunhos de resposta"],
    nao: "Enviar sem a sua aprovação",
    rotinas: [
      { quando: "Dias úteis, 8:00", oque: "O que pede resposta hoje", cron: "0 8 * * 1-5", instrucao: "Leia os e-mails de clientes que chegaram e liste o que pede resposta hoje, do mais urgente ao menos." },
      { quando: "De hora em hora", oque: "Avisar quando chegar algo urgente", cron: "0 * * * *", instrucao: "Confira os e-mails de clientes da última hora e avise só se chegou algo urgente." },
      { quando: "Sexta, 17:00", oque: "Resumo dos clientes da semana", cron: "0 17 * * 5", instrucao: "Faça um resumo curto dos clientes que escreveram nesta semana e do que ficou sem resposta." },
    ],
  },
  time: {
    objetivo: "time",
    fala: "Acompanhar o trabalho do time",
    curto: "acompanhar o trabalho do time",
    nome: "Coordenador",
    papel: "Time",
    descricao: "Acompanha as tarefas do time, aponta o que está parado e com quem, e me manda um resumo curto.",
    forma: "shape-hex",
    cor: "c-purple",
    app: { slug: "clickup", nome: "ClickUp", letra: "C", cor: "#7b68ee" },
    pode: ["Ler tarefas e listas", "Comentar nas tarefas"],
    nao: "Mudar status sem a sua aprovação",
    rotinas: [
      { quando: "Dias úteis, 9:00", oque: "O que está parado e com quem", cron: "0 9 * * 1-5", instrucao: "Liste as tarefas do time paradas há mais de dois dias e com quem cada uma está." },
      { quando: "Segunda, 8:30", oque: "Plano da semana do time", cron: "30 8 * * 1", instrucao: "Monte o plano da semana do time a partir das tarefas abertas e dos prazos." },
      { quando: "Sexta, 17:00", oque: "O que o time entregou", cron: "0 17 * * 5", instrucao: "Resuma o que o time entregou nesta semana." },
    ],
  },
  dia: {
    objetivo: "dia",
    fala: "Organizar meu dia",
    curto: "organizar o seu dia",
    nome: "Secretário",
    papel: "Agenda",
    descricao: "Olha minha agenda, prepara cada reunião com o contexto que importa e me lembra do que ficou pendente.",
    forma: "shape-circle",
    cor: "c-blue",
    app: { slug: "googlecalendar", nome: "Google Agenda", letra: "A", cor: "#1a73e8" },
    pode: ["Ler eventos da agenda", "Ler documentos anexados"],
    nao: "Criar eventos sem a sua aprovação",
    rotinas: [
      { quando: "Todo dia, 7:30", oque: "Meu dia em cinco linhas", cron: "30 7 * * *", instrucao: "Resuma o meu dia em cinco linhas a partir da agenda." },
      { quando: "Dias úteis, 8:00", oque: "Preparar as reuniões do dia", cron: "0 8 * * 1-5", instrucao: "Para cada reunião de hoje, prepare o contexto que importa em poucas linhas." },
      { quando: "Todo dia, 18:00", oque: "O que ficou pendente", cron: "0 18 * * *", instrucao: "Liste o que ficou pendente das reuniões de hoje." },
    ],
  },
  codigo: {
    objetivo: "codigo",
    fala: "Revisar o código do time",
    curto: "revisar o código do time",
    nome: "Revisor",
    papel: "Código",
    descricao: "Lê os pull requests abertos, aponta riscos e sugere comentários. Nada é publicado sem eu aprovar.",
    forma: "shape-square",
    cor: "c-teal",
    app: { slug: "github", nome: "GitHub", letra: "H", cor: "#24292f" },
    pode: ["Ler repositórios e pull requests", "Sugerir comentários"],
    nao: "Publicar sem a sua aprovação",
    rotinas: [
      { quando: "Dias úteis, 9:30", oque: "PRs parados há mais de 2 dias", cron: "30 9 * * 1-5", instrucao: "Liste os pull requests abertos parados há mais de dois dias e o que falta em cada um." },
      { quando: "Dias úteis, 14:00", oque: "Primeira revisão dos PRs novos", cron: "0 14 * * 1-5", instrucao: "Faça a primeira revisão dos pull requests abertos desde a última vez e aponte os riscos." },
      { quando: "Sexta, 16:00", oque: "O que entrou na semana", cron: "0 16 * * 5", instrucao: "Resuma o que entrou na base de código nesta semana." },
    ],
  },
};

/** O objetivo padrão do caminho sem voz e de quem não disse nada que case. */
export const OBJETIVO_PADRAO: IdObjetivo = "clientes";

const PALAVRAS: readonly [IdObjetivo, RegExp][] = [
  ["codigo", /\b(c[oó]digo|pull ?requests?|prs?|github|revis\w*|deploy|programa\w*|dev\w*)\b/],
  ["dia", /\b(agenda|meu dia|organiza\w*|reuni[aã]o|reuni[oõ]es|compromissos?|calend[aá]rio)\b/],
  ["time", /\b(time|equipe|tarefas?|projetos?|clickup|acompanha\w*|coordena\w*)\b/],
  ["clientes", /\b(clientes?|atendimento|atende\w*|e-?mails?|suporte|responder|vendas?)\b/],
];

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** O modelo de bot do que a pessoa disse que quer (palavras-chave; nada casa = o padrão). */
export function objetivoDoTexto(texto: string | null | undefined): IdObjetivo {
  if (!texto) return OBJETIVO_PADRAO;
  const t = texto.toLowerCase();
  const s = semAcento(texto);
  for (const [id, re] of PALAVRAS) if (re.test(t) || re.test(s)) return id;
  return OBJETIVO_PADRAO;
}

export function modeloDoObjetivo(texto: string | null | undefined): ModeloDeBot {
  return MODELOS_DE_BOT[objetivoDoTexto(texto)];
}

/** O tamanho do time dito em palavras ("só eu", "uns cinco", "trinta pessoas") ou já no código da 0049. */
export function tamanhoDoTexto(texto: string): TamanhoTime | null {
  const t = semAcento(texto.trim());
  if ((TAMANHOS_TIME as readonly string[]).includes(t)) return t as TamanhoTime;
  if (/\b(so eu|sozinh[oa]|ninguem|apenas eu|eu mesm[oa])\b/.test(t)) return "so_eu";
  const numeros: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cem: 100, mil: 1000 };
  const digito = t.match(/\d+/);
  const palavra = Object.entries(numeros).find(([p]) => new RegExp(`\\b${p}\\b`).test(t));
  const n = digito ? Number(digito[0]) : palavra ? palavra[1] : null;
  if (n === null) return null;
  if (n <= 1) return "so_eu";
  if (n <= 10) return "2_10";
  if (n <= 50) return "11_50";
  return "51_mais";
}

/** Normaliza o valor que o modelo anotou; null = inválido para o campo. */
export function normalizarCampo(campo: CampoEntrevista, valor: string): string | null {
  const v = valor.replace(/\s+/g, " ").trim();
  if (v === "") return null;
  if (campo === "apelido") return v.slice(0, APELIDO_MAX);
  if (campo === "como_conheceu") return v.slice(0, COMO_CONHECEU_MAX);
  if (campo === "objetivo") return v.slice(0, OBJETIVO_MAX);
  return tamanhoDoTexto(v);
}

const ROTULO_TAMANHO: Record<TamanhoTime, string> = { so_eu: "Só você", "2_10": "2 a 10", "11_50": "11 a 50", "51_mais": "Mais de 50" };

export function rotuloTamanho(t: TamanhoTime): string {
  return ROTULO_TAMANHO[t];
}

/** "Então, você é Marlon, chegou por indicação, quer responder clientes mais rápido e trabalha com 2 a 10 pessoas. Certo?" */
export function resumoDaEntrevista(c: CamposEntrevista): string {
  const quem = c.apelido ?? "você";
  const origem = (c.comoConheceu ?? "").toLowerCase();
  const quer = modeloDoObjetivo(c.objetivo).curto;
  const time = c.tamanhoTime === "so_eu" || !c.tamanhoTime ? "ninguém, por enquanto" : `${ROTULO_TAMANHO[c.tamanhoTime].toLowerCase()} pessoas`;
  return `Então, você é ${quem}${origem ? `, chegou por ${origem}` : ""}, quer ${quer} e trabalha com ${time}. Certo?`;
}

/** O primeiro nome da pessoa, para o chip "Me chama de …". */
function primeiroNome(nome: string | null | undefined): string {
  const n = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  return n || "Marlon";
}

/**
 * Os chips "Diga algo como" da etapa (textos fixos do protótipo). Na entrevista, os da próxima pergunta; com tudo
 * respondido, os do resumo. Na configuração, os do passo. Nas outras etapas, nenhum.
 */
export function sugestoesDoOnboarding(p: { etapa: EtapaOnboarding | null; campos: CamposEntrevista; pessoaNome?: string | null; passo?: PassoConfiguracao; nomeBot?: string | null }): string[] {
  if (p.etapa === "entrevista" || p.etapa === "chamando") {
    const proxima = camposQueFaltam(p.campos)[0];
    if (proxima === "apelido") return [`Me chama de ${primeiroNome(p.pessoaNome)}`];
    if (proxima === "como_conheceu") return ["Um amigo me indicou", "Vi no LinkedIn", "Pesquisando no Google"];
    if (proxima === "objetivo") return Object.values(MODELOS_DE_BOT).map((m) => m.fala);
    if (proxima === "tamanho_time") return ["Só eu", "Somos uns cinco", "Umas trinta pessoas"];
    return ["Quero corrigir", "Isso mesmo"];
  }
  if (p.etapa === "configurando") {
    const modelo = modeloDoObjetivo(p.campos.objetivo);
    if (p.passo === "bot") return [`Pode ser ${p.nomeBot ?? modelo.nome}`];
    if (p.passo === "app") return ["Conecta aí"];
    if (p.passo === "rotina") return modelo.rotinas.slice(0, 2).map((r) => r.quando);
    if (p.passo === "fim") return ["Pode desligar"];
  }
  return [];
}

/** O passo da configuração guiada, do que já existe no banco. */
export function passoDaConfiguracao(p: { temBot: boolean; appConectado: boolean; temRotina: boolean }): PassoConfiguracao {
  if (!p.temBot) return "bot";
  if (!p.appConectado) return "app";
  if (!p.temRotina) return "rotina";
  return "fim";
}

/** A frase final, na tela e na fala do Nod. */
export function textoTudoMontado(nomeGuia: string): string {
  return `Tudo montado. Quando quiser, é só chamar o ${nomeGuia} por aqui.`;
}

/**
 * As linhas do prompt de voz da primeira ligação (prompt-ligacao.ts junta às fixas): o roteiro das quatro perguntas,
 * o resumo e a configuração guiada com as ferramentas do onboarding.
 *
 * definido em 2026-10-04 (emenda da ADR-077): a guia FALA primeiro (a reação e a próxima pergunta) e só então anota.
 * Antes o roteiro mandava anotar e depois perguntar: duas respostas do modelo antes do primeiro som. Medido no UAT
 * com a voz do Google e o `fable`: o primeiro texto saía 2,1–3,2 s depois da vez (a ferramenta em si levava ~45 ms);
 * na sonda com o roteiro novo, em ~0,7 s. Depois da ferramenta ela escreve só "ok" (ver `ehSoOk` em ligacao-frases.ts).
 */
export function linhasDoPromptOnboarding(p: { nomeGuia: string; campos: CamposEntrevista; etapa: EtapaOnboarding | null }): string[] {
  const falta = camposQueFaltam(p.campos);
  const ja = [
    p.campos.apelido ? `apelido: ${p.campos.apelido}` : null,
    p.campos.comoConheceu ? `como conheceu: ${p.campos.comoConheceu}` : null,
    p.campos.objetivo ? `objetivo: ${p.campos.objetivo}` : null,
    p.campos.tamanhoTime ? `time: ${ROTULO_TAMANHO[p.campos.tamanhoTime]}` : null,
  ].filter((x): x is string => x !== null);
  const modelo = modeloDoObjetivo(p.campos.objetivo);
  const linhas = [
    `Esta é a primeira ligação da pessoa com o nod, e você é o ${p.nomeGuia}, o bot fixo dela, que guia o começo. Primeiro uma entrevista curta, uma pergunta por vez, nesta ordem: 1) ${PERGUNTAS_ENTREVISTA.apelido} 2) ${PERGUNTAS_ENTREVISTA.como_conheceu} 3) ${PERGUNTAS_ENTREVISTA.objetivo} 4) ${PERGUNTAS_ENTREVISTA.tamanho_time}`,
    "Quando ela responder uma pergunta, fale primeiro: uma reação curta e a próxima pergunta. Só depois, na mesma resposta, chame anotar_entrevista com o campo e o valor curto. Não anuncie essa ferramenta. Depois dela, siga o que a ferramenta devolver. Use o apelido dela daí em diante.",
    `Na resposta à última pergunta, diga só uma ponte curta ("Deixa eu juntar tudo.") antes de anotar_entrevista: a ferramenta devolve o resumo, que você lê terminando com "Certo?". Se ela confirmar, diga "Perfeito. Agora vou te mostrar o nod. Não desliga, a gente continua conversando enquanto eu monto tudo." e só depois chame concluir_entrevista. Se ela quiser corrigir, pergunte de novo o que estiver errado.`,
    `Depois, guie a configuração em três passos: (1) propor_bot com um bot para "${modelo.curto}" (sugestão: ${modelo.nome}, "${modelo.descricao}"), e espere ela confirmar; (2) pedir_acesso ao ${modelo.app.nome} (slug ${modelo.app.slug}, nivel leitura, capacidades []) com para_bot igual ao nome do bot novo; (3) criar_rotina com para_bot igual ao nome do bot novo, com o horário que ela escolher. No fim, diga "${textoTudoMontado(p.nomeGuia)}" e pergunte se pode desligar.`,
  ];
  if (ja.length) linhas.push(`Ela já respondeu: ${ja.join("; ")}.`);
  if (p.etapa === "configurando") linhas.push("A entrevista já terminou: siga direto para a configuração.");
  else if (falta.length) linhas.push(`Ainda falta: ${falta.join(", ")}.`);
  return linhas;
}
