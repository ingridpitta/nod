import type { TipoDecisao } from "../contracts/decisao.ts";
import type { CapacidadesHarness } from "../contracts/harness.ts";
import type { MotivoInterrupcao } from "../contracts/motivos.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";
import { ESTADOS_ABERTOS_TRABALHO, type EstadoTrabalho, type OrigemTrabalho, type TrabalhoDto } from "../contracts/trabalho.ts";
import type { EstadoTurno, OrigemTurno } from "../contracts/turno.ts";

/**
 * Regras puras dos trabalhos (definido em 2026-10-07, ADR-083, épico #188). Quem lê o banco e grava é o caso de uso
 * (src/use-cases/trabalhos.ts); aqui só decisão.
 */

/** CHECK trabalho_titulo da 0063. */
export const TITULO_TRABALHO_MAX = 200;

/** Estados em que o trabalho acabou: o `depois_de` de outro libera, e a linha vai para "Terminados hoje". */
export const ESTADOS_FINAIS_TRABALHO = ["terminado", "parado", "falhou"] as const satisfies readonly EstadoTrabalho[];

export function trabalhoAberto(estado: EstadoTrabalho): boolean {
  return (ESTADOS_ABERTOS_TRABALHO as readonly EstadoTrabalho[]).includes(estado);
}

export function trabalhoFinal(estado: EstadoTrabalho): boolean {
  return (ESTADOS_FINAIS_TRABALHO as readonly EstadoTrabalho[]).includes(estado);
}

/**
 * definido em 2026-10-07: a primeira linha não vazia, sem espaço repetido, cortada em 80 caracteres com reticências (a
 * faixa e a linha do chat têm uma linha só). Vazio vira "Trabalho". É a regra do último passo e do nome da rotina; o
 * título do trabalho é `tituloDoTrabalho`, que também recusa o que não tem letra.
 */
export function linhaCurta(texto: string): string {
  const primeira = texto.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l !== "") ?? "";
  if (primeira === "") return "Trabalho";
  return primeira.length > 80 ? `${cortar(primeira, 79).trimEnd()}…` : primeira;
}

/**
 * Os primeiros `n` caracteres (unidades UTF-16) sem partir um par substituto: a letra fora do plano básico ("𝐀", o CJK
 * da extensão B) cortada ao meio deixava meia letra no título, que o UTF-8 do Postgres e do JSON trocam por "�".
 * definido em 2026-10-18 (revisão do PR 5).
 */
function cortar(texto: string, n: number): string {
  if (texto.length <= n) return texto;
  const ultimo = texto.charCodeAt(n - 1);
  return texto.slice(0, ultimo >= 0xd800 && ultimo <= 0xdbff ? n - 1 : n);
}

const TEM_LETRA = /\p{L}/u;

// definido em 2026-10-18 (revisão do PR 5): caractere de controle (o NUL que o Postgres recusa em `text` e em `jsonb`, o que
// derrubava o `abrir_frentes` inteiro) vira espaço, menos a quebra de linha; o invisível de formatação (inversão de
// direção U+202E, espaço de largura zero) e o preenchimento do hangul, que conta como letra e dava um título em branco,
// saem. O ZWJ fica: une as sequências de emoji.
const CONTROLE = /[\p{Cc}]/gu;
const INVISIVEL = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;
function semInvisiveis(texto: string): string {
  return texto.replace(CONTROLE, (c) => (c === "\n" ? "\n" : " ")).replace(INVISIVEL, (c) => (c === "\u200D" ? c : ""));
}

/**
 * O título do trabalho: a `linhaCurta` do que o bot ou a pessoa escreveu. revisto em 2026-10-18 (plano chat limpo, PR 5):
 * título sem letra ("??", "...", só emoji) cai no reserva — o "??" que o modelo mandou (o `minLength 1` aceita) virava a
 * linha da frente.
 */
export function tituloDoTrabalho(texto: string, reserva = "Trabalho"): string {
  return tituloOuNada(texto) ?? reserva;
}

/** A regra de `tituloDoTrabalho` sem o reserva: null quando o texto não tem letra (o título do lote é opcional). */
export function tituloOuNada(texto: string): string | null {
  const visivel = semInvisiveis(texto);
  const linha = linhaCurta(visivel);
  return TEM_LETRA.test(linha) && visivel.trim() !== "" ? linha : null;
}

/** definido em 2026-10-18 (plano chat limpo, PR 5): o título provisório tem até 6 palavras e 40 caracteres. */
export const PALAVRAS_TITULO_PROVISORIO = 6;
export const CARACTERES_TITULO_PROVISORIO = 40;
/** O reserva do título provisório, quando a mensagem não tem letra (só link, emoji, "??" ou nada). */
export const TITULO_PROVISORIO_RESERVA = "Frente da conversa";

// A saudação do começo ("Oi", "Bom dia", "E aí", "Tudo bem?"), com o vocativo curto que vem depois ("Oi Nina,").
// revisto em 2026-10-18 (QA do PR 5): também a do espanhol ("Hola, ¿puedes arreglar…" dava "Hola, ¿puedes arreglar el
// login"), com o "¿"/"¡" de abertura, que sai como a outra pontuação.
const SAUDACAO = /^(oi+|h?ol[aá]|opa|e a[ií]|eai|fala|salve|hey|hi|hello|bom dia|boa tarde|boa noite|buenos d[ií]as|buenas tardes|buenas noches|buenas|tudo (?:bem|bom|certo|joia|jóia)|beleza|blz)(?=[\s,.!?;:…¡¿]|$)[\s,.!?;:…¡¿]*/iu;
// revisto em 2026-10-18 (revisão do PR 5): "fala", "salve" e "hello" também são verbo ou palavra do pedido ("Salve o
// arquivo em PDF", "Fala sobre o projeto", "Hello world em Rust"): só são saudação seguidas de pontuação, do fim ou de um
// vocativo ("Fala Nina, …"). E o vocativo não começa por palavra de ligação ("Oi, as planilhas, …" não perde "as planilhas").
const SAUDACAO_AMBIGUA = new Set(["fala", "salve", "hello"]);
const VOCATIVO = /^(?:@?([\p{L}\p{N}_-]+)(?:\s+[\p{L}\p{N}_-]+)?)\s*[,!]+\s*/u;
const LINK = /\b(?:https?:\/\/|www\.)\S+/giu;
// O que sobra do link em markdown ("[veja aqui](" depois que o link saiu) vira espaço; a ênfase ("**Urgente**",
// "`deploy`") só sai.
const RESTO_DE_LINK = /\]\(|[[\]]/gu;
const ENFASE = /[*`]+/gu;
// Fim de oração: ponto, exclamação, interrogação, reticências, ponto e vírgula ou dois-pontos seguidos de espaço (ou no
// fim), a pontuação de largura cheia do chinês e do japonês (sem espaço depois) e a quebra de linha. "v1.2" e "12:30" não
// cortam.
const FIM_DE_ORACAO = /[.!?…;:](?=\s|$)|[。！？；：]|\n/gu;
// A pontuação do fim sai por laço (`semPontuacaoNoFim`), não por /[…]+$/: com a âncora no fim o regex é quadrático numa
// sequência longa de pontuação no meio do texto (medido em 2026-10-18 na guarda do teste: razão 16 com a entrada 4x).
const PONTUACAO = /[\s.,;:!?¡¿…\-–—"'“”‘’()[\]*_`。！？；：，、「」『』（）]/u;
const PONTUACAO_INICIAL = /^[\s.,;:!?¡¿…\-–—"'“”‘’()[\]*_`#>。！？；：，、「」『』（）]+/u;
// Palavra de ligação que não fecha título ("Refazer os roteiros de" → "Refazer os roteiros"); as do espanhol e do inglês
// entram desde a revisão do PR 5 (2026-10-18: "arregla el login y" acabava no "y").
const LIGACAO = new Set([
  "a", "o", "as", "os", "ao", "aos", "de", "da", "do", "das", "dos", "e", "ou", "em", "no", "na", "nos", "nas", "para", "pra", "pro", "com", "por", "pelo", "pela", "que", "um", "uma", "se", "mas",
  "y", "el", "la", "los", "las", "del", "al", "con", "en", "and", "the", "of", "to", "an", "for", "with", "or", "in", "on",
]);

// Emoji (com o seletor de variação e o ZWJ das sequências) sai do título: não é palavra.
// revisto em 2026-10-18 (revisão do PR 5): também o tom de pele, as bandeiras (indicadores regionais) e as tags
// ("👍🏽 refazer" deixava "🏽 refazer").
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u{E0020}-\u{E007F}]/gu;

function semPontuacaoNoFim(texto: string): string {
  let fim = texto.length;
  while (fim > 0 && PONTUACAO.test(texto.charAt(fim - 1))) fim--;
  return texto.slice(0, fim);
}

/** Espaço junto e sem pontuação nas pontas. */
function aparar(texto: string): string {
  return semPontuacaoNoFim(texto.replace(/\s+/g, " ").replace(PONTUACAO_INICIAL, ""));
}

function semSaudacao(texto: string): string {
  let t = texto.replace(PONTUACAO_INICIAL, "");
  for (let i = 0; i < 3; i++) {
    const m = SAUDACAO.exec(t);
    if (!m) break;
    const resto = t.slice(m[0].length);
    const v = VOCATIVO.exec(resto);
    const vocativo = v && !LIGACAO.has((v[1] ?? "").toLowerCase()) ? v[0] : null;
    // "Salve o arquivo": sem pontuação depois, sem vocativo e com mais texto, é o pedido, não a saudação.
    if (SAUDACAO_AMBIGUA.has((m[1] ?? "").toLowerCase()) && !/[,.!?;:…]/u.test(m[0]) && resto.trim() !== "" && vocativo === null) break;
    t = (vocativo ? resto.slice(vocativo.length) : resto).replace(PONTUACAO_INICIAL, "");
  }
  return t;
}

/**
 * As linhas que dizem o pedido: sem as de dentro de um bloco de código (```) e sem as citadas ("> …"), salvo quando só há
 * citação (ou só código). definido em 2026-10-18 (revisão do PR 5): "```ts" virava o título "Ts" e a citação tomava o lugar do pedido.
 */
function linhasDoPedido(texto: string): string[] {
  const proprias: string[] = [];
  const citadas: string[] = [];
  const codigo: string[] = [];
  let noCodigo = false;
  for (const bruta of texto.split("\n")) {
    const l = bruta.trim();
    // A cerca abre ou fecha o bloco; "```npm test``` falhou" (fechada na mesma linha) é texto.
    if (l.startsWith("```") && !l.includes("```", 3)) {
      noCodigo = !noCodigo;
      continue;
    }
    if (l === "") continue;
    (noCodigo ? codigo : l.startsWith(">") ? citadas : proprias).push(l);
  }
  return proprias.length > 0 ? proprias : citadas.length > 0 ? citadas : codigo;
}

/**
 * A primeira oração com letra. Oração sem letra ("??") é pulada; o rótulo curto antes de dois-pontos ("Bug: o login
 * quebra", "Pedido: refazer o hero") fica com o que vem depois — uma vez só, para o laço seguir linear. revisto em
 * 2026-10-18 (revisão do PR 5): antes, "Bug: …" dava o título "Bug", e o "??\nFaz o deploy. Depois…" pegava a mensagem
 * inteira.
 */
function primeiraOracao(corpo: string): string {
  FIM_DE_ORACAO.lastIndex = 0;
  let inicio = 0;
  let rotulo = true;
  for (;;) {
    const m = FIM_DE_ORACAO.exec(corpo);
    const ate = m ? m.index : corpo.length;
    const oracao = aparar(corpo.slice(inicio, ate));
    const ehRotulo = rotulo && m !== null && (m[0] === ":" || m[0] === "：") && TEM_LETRA.test(oracao) && oracao.split(" ").length < 3;
    if (ehRotulo) rotulo = false;
    else if (TEM_LETRA.test(oracao) || !m) return oracao;
    else inicio = ate + m[0].length;
  }
}

/**
 * O título provisório da frente que nasce da rede de 2 min (definido em 2026-10-18, plano chat limpo, PR 5): a frente da
 * rede é o turno do dono promovido, e o título vinha da mensagem crua da pessoa ("Os resultados estão ficando muito
 * bons, mas…", até 80 caracteres). Agora: sem links, código, citação e a saudação do começo, a primeira oração com letra,
 * até 6 palavras e 40 caracteres, sem palavra de ligação nem pontuação no fim, com a primeira letra maiúscula. Sem letra,
 * "Frente da conversa". Fica o provisório até o fim: nenhum modelo renomeia a frente da rede (decisão 16 do plano).
 */
/**
 * O pedido que o "Abrir task com isto" da fala manda (`textoAbrirTask` em web/telas/acoes-da-fala.ts, ADR-113):
 * "Abre uma task com isto: «começo da fala…»". definido em 2026-10-18 (rebase do PR 5 sobre o #392): o título sai do
 * assunto citado; sem isso, a primeira oração dava "Abre uma task com isto".
 */
const PEDIDO_TASK_DA_FALA = /^Abre uma task com isto: «([^»]+)»$/u;

export function tituloProvisorio(texto: string): string {
  texto = PEDIDO_TASK_DA_FALA.exec(texto.trim())?.[1] ?? texto;
  const limpo = linhasDoPedido(semInvisiveis(texto).replace(LINK, " ").replace(EMOJI, " ")).join("\n").replace(RESTO_DE_LINK, " ").replace(ENFASE, "");
  const corpo = semSaudacao(limpo);
  const frase = primeiraOracao(corpo);
  if (!TEM_LETRA.test(frase)) return TITULO_PROVISORIO_RESERVA;
  // A vírgula fecha a oração quando o que vem antes já diz algo (3 palavras ou mais): "Faz o deploy, depois roda os
  // testes" → "Faz o deploy". Antes disso ela é vocativo ou aposto e fica ("Hoje, refaça os roteiros").
  const virgula = frase.indexOf(", ");
  const base = virgula > 0 && frase.slice(0, virgula).split(" ").length >= 3 ? frase.slice(0, virgula) : frase;
  const palavras = base.split(" ").slice(0, PALAVRAS_TITULO_PROVISORIO);
  while (palavras.length > 1 && palavras.join(" ").length > CARACTERES_TITULO_PROVISORIO) palavras.pop();
  while (palavras.length > 1 && LIGACAO.has(semPontuacaoNoFim(palavras.at(-1)!.toLowerCase()))) palavras.pop();
  let titulo = semPontuacaoNoFim(palavras.join(" "));
  if (titulo.length > CARACTERES_TITULO_PROVISORIO) titulo = semPontuacaoNoFim(cortar(titulo, CARACTERES_TITULO_PROVISORIO));
  if (!TEM_LETRA.test(titulo)) return TITULO_PROVISORIO_RESERVA;
  // "ß" e "ﬁ" viram duas letras na maiúscula e passariam dos 40: ficam como estão.
  const inicial = titulo.charAt(0).toLocaleUpperCase("pt-BR");
  return (inicial.length === 1 ? inicial : titulo.charAt(0)) + titulo.slice(1);
}

/**
 * A pasta do trabalho dentro da pasta do bot (convenção da ADR-065: `~/nod/<bot>/<repo>-<task>`). definido em
 * 2026-10-07: o slug do título mais os 6 primeiros caracteres do id — dois trabalhos com o mesmo título nunca
 * dividem pasta (critério 2 da #192). Só [a-z0-9-], até 40 caracteres antes do sufixo.
 */
export function slugDoTrabalho(titulo: string, id: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const sufixo = id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase();
  return `${base === "" ? "task" : base}-${sufixo}`;
}

/** `~/nod/<pastaDoBot>/<slug>`, a forma que `trabalhos.pasta` guarda e a tela mostra. */
export function pastaDoTrabalho(pastaDoBot: string, titulo: string, id: string): string {
  return `~/nod/${pastaDoBot}/${slugDoTrabalho(titulo, id)}`;
}

/** O caminho relativo a `~/nod` que o plano leva em `pastaDoBot` (o driver faz `join(home, "nod", …)`). */
export function pastaRelativa(pasta: string): string | null {
  const m = /^~\/nod\/(.+)$/.exec(pasta);
  return m?.[1] ?? null;
}

/**
 * O que se sabe de um trabalho para decidir o estado dele, lido de uma vez (trabalhosRepo.fatos). `ultimo` é o
 * turno terminal mais recente; `decisaoPendente`: alguma decisão pendente (pergunta, aprovação, acesso, "Retomar")
 * de um turno dele.
 */
export type FatosTrabalho = {
  estadoAtual: EstadoTrabalho;
  iniciado: boolean;
  /** Turnos rodando com o Parar já pedido (o processo ainda está acabando). */
  parando: number;
  despachando: number;
  pendentes: number;
  /** O trabalho de `depois_de` ("Fazer depois da …") ainda não acabou: o turno na fila espera por ele. */
  esperandoOutro: boolean;
  decisaoPendente: boolean;
  /**
   * definido em 2026-10-08 (revisão do épico, S3): pedidos a colegas (`pedir_a_bot`) feitos por um turno do trabalho que
   * ainda não voltaram — handoff sem peer_ask da mesma tarefa, a regra de `pedidosEmAberto` (entregar-resposta-peer.ts).
   * A resposta vira a continuação do trabalho: até lá ele está trabalhando, não terminou.
   */
  aguardandoColega: boolean;
  /** ADR-086 (revisão do #212): uma volta marcada ("me chame às 16:00") ainda por vir. Não é fila: fica abaixo da decisão. */
  aguardandoDespertar?: boolean;
  /**
   * definido em 2026-10-12 (ADR-099, parte 2): um comando que o trabalho deixou esperando (`esperar_comando`) ainda roda na
   * máquina. Como a volta marcada, não é fila: o fim dele acorda o trabalho.
   */
  aguardandoComando?: boolean;
  ultimo: { estado: EstadoTurno; motivo: MotivoInterrupcao | null } | null;
  /**
   * NOD-264 (C21): a última pergunta à pessoa (decisão que não é "Retomar") venceu sem resposta e foi feita pelo último
   * turno terminal. Sem turno vivo, o trabalho falhou com o motivo `pergunta_vencida` — não "terminou" com a pergunta.
   */
  perguntaVencida?: boolean;
  /** NOD-282 (G5): com `perguntaVencida`, o tipo da decisão que venceu (a aprovação tem texto próprio no resumo). */
  vencidaTipo?: TipoDecisao;
};

/** NOD-264 (C21): o motivo da frente que acabou porque a pergunta à pessoa venceu sem resposta. */
export const MOTIVO_PERGUNTA_VENCIDA = "pergunta_vencida" as const;

/**
 * A tabela de estados da #192, derivada dos fatos (definido em 2026-10-07). Derivar em vez de transicionar evento a
 * evento deixa um lugar só para a regra: quem muda um turno ou uma decisão de um trabalho chama a sincronização e o
 * estado sai daqui.
 *
 * - turno com o Parar pedido e ainda acabando, sem outro na fila: `parado` (a renovação seguinte o encerra);
 * - turno rodando: `rodando`, ou `precisa_de_voce` se ele parou numa decisão (a aprovação dentro do turno) — ou segue
 *   `fechado_ocioso` se a memória já mandou soltar essa espera (#194) e o processo está acabando;
 * - turno na fila: `rodando` se o trabalho já começou, senão `na_fila`; esperando o `depois_de`, sempre `na_fila`
 *   (revisto em 2026-10-08: "Fazer depois" com a task já começada a devolve à fila — fazerDepois);
 * - nada vivo e já `parado`: continua `parado` (revisão do épico, S1, 2026-10-08) — nem a decisão que sobrou nem o
 *   desfecho do turno que acabou depois do Parar o reabrem; só um turno novo (a pessoa escreveu na task) o tira daí;
 * - nada vivo e decisão pendente: `precisa_de_voce` (ou continua `fechado_ocioso`, #194);
 * - nada vivo e pedido a colega sem resposta, uma volta marcada (ADR-086) ou um comando esperando (ADR-099): `rodando`
 *   (S3) — a resposta, a volta ou o fim do comando chegam como turno do trabalho;
 * - nada vivo nem pendente: o desfecho do último turno — concluído `terminado`, parado pela pessoa `parado`, o resto
 *   `falhou` (máquina sumiu sem "Retomar", IA indisponível, erro).
 */
export function estadoDoTrabalho(f: FatosTrabalho): EstadoTrabalho {
  if (f.parando > 0 && f.despachando === 0 && f.pendentes === 0) return "parado";
  if (f.despachando > 0) return f.decisaoPendente ? (f.estadoAtual === "fechado_ocioso" ? "fechado_ocioso" : "precisa_de_voce") : "rodando";
  if (f.pendentes > 0) return f.iniciado && !f.esperandoOutro ? "rodando" : "na_fila";
  if (f.estadoAtual === "parado") return "parado";
  if (f.decisaoPendente) return f.estadoAtual === "fechado_ocioso" ? "fechado_ocioso" : "precisa_de_voce";
  if (f.perguntaVencida) return "falhou";
  if (f.aguardandoColega || f.aguardandoDespertar || f.aguardandoComando) return "rodando";
  if (f.ultimo === null) return "na_fila";
  if (f.ultimo.estado === "concluido") return "terminado";
  if (f.ultimo.motivo === "parado_pela_pessoa") return "parado";
  return "falhou";
}

/** Pelo que um trabalho aberto espera sem trabalhar: um colega, um comando (`esperar_comando`) ou a volta marcada. */
export type EsperaDoTrabalho = "colega" | "comando" | "volta";

/**
 * definido em 2026-10-12 (ADR-099, parte 1, "esperar não é trabalhar"): o trabalho `rodando` sem turno vivo que só espera
 * — um colega responder (ADR-084) ou a hora da volta (ADR-086) — está esperando, não trabalhando. O estado gravado continua
 * `rodando` (o CHECK de `trabalhos.estado` e quem o lê não mudam); a espera é derivada na leitura, dos campos que o
 * `TrabalhoDto` já traz. A volta conta mesmo depois da hora enquanto ninguém a pegou: sem turno vivo não há trabalho.
 * A web repete a regra em `foraDoMac` (web/lib/trabalhos.ts; tests/unit/web/trabalhos.test.ts confere as duas).
 * Motivo: em 11/10 a tela dizia "Trabalhando · 13" com um trabalhando de fato. Revisto em 2026-10-12 (ADR-099, parte 5):
 * a espera de um comando (`esperar_comando`) também é espera, em todo lugar.
 */
export function esperaDoTrabalho(t: Pick<TrabalhoDto, "estado" | "turnoVivoId"> & { esperandoColega?: TrabalhoDto["esperandoColega"]; esperandoComando?: TrabalhoDto["esperandoComando"]; acordaEm?: number | null }): EsperaDoTrabalho | null {
  if (t.estado !== "rodando" || t.turnoVivoId) return null;
  if (t.esperandoColega) return "colega";
  if (t.esperandoComando) return "comando";
  return t.acordaEm ? "volta" : null;
}

/**
 * Quem pode abrir task (`abrir_task`, #193): a conversa (turno sem trabalho) e o trabalho de rotina sem mãe
 * (profundidade 1: a rotina abre, as filhas não). Trabalho da pessoa, de colega ou da rede não abre: ele já é a task.
 */
export function podeAbrirTask(trabalho: { origem: OrigemTrabalho; trabalhoMaeId: string | null } | null): boolean {
  return trabalho === null || (trabalho.origem === "rotina" && trabalho.trabalhoMaeId === null);
}

/**
 * definido em 2026-10-08 (revisão do épico, S12, decisão do Marlon): uma execução de rotina abre no máximo isto de tasks;
 * a seguinte é recusada com instrução. Sem teto por bot — o limite é a máquina (ADR-083 §4).
 */
export const TETO_TASKS_POR_EXECUCAO_DE_ROTINA = 10;

/** `mandar_para_task` é da conversa coordenadora: só turno sem trabalho repassa a uma task. */
export function podeMandarParaTask(trabalho: unknown): boolean {
  return trabalho === null || trabalho === undefined;
}

/**
 * definido em 2026-10-07 (ADR-083 §4, #194): sob pressão amarela (ou pior), a task que espera a pessoa DENTRO do turno
 * há mais disto solta a espera: o turno encerra, o processo fecha e a decisão segue pendente, voltando por --resume.
 */
export const FECHAR_OCIOSA_SOB_PRESSAO_MS = 5 * 60_000;

/** A espera de uma decisão dentro do turno deve ser solta para liberar memória? Só com a máquina sob pressão. */
export function soltarPorMemoria(p: { nivel: "verde" | "amarela" | "vermelha" | null; esperandoDesde: number; agora: number }): boolean {
  return (p.nivel === "amarela" || p.nivel === "vermelha") && p.agora - p.esperandoDesde > FECHAR_OCIOSA_SOB_PRESSAO_MS;
}

/** definido em 2026-10-07 (ADR-083 §2): a resposta de conversa que passa disto trabalhando vira task sozinha. */
export const REDE_MS = 120_000;

/**
 * A rede de 2 min (#193): só o turno do dono com a pessoa (nada de sala, ligação, rotina ou colega), sem trabalho,
 * rodando há REDE_MS, que já chamou ao menos uma ferramenta. `redeMs` existe só para o e2e (ausente, vale REDE_MS).
 * revisto em 2026-10-12 (ADR-099, I8): também a retomada do dono em modo conversa, e com harness que bifurca OU que nem
 * retoma sessão (o dono segue com o histórico). As capacidades são as declaradas do harness; quem escolhe entre bifurcar
 * e largar a sessão é a máquina (`seguimentoNaRede`, domain/frente.ts).
 */
export function promoveNaRede(p: { origem: OrigemTurno; modo?: ModoTurno | null; trabalhoId: string | null | undefined; estado: EstadoTurno; despachadoHaMs: number; fezFerramenta: boolean; capacidades: CapacidadesHarness; redeMs?: number }): boolean {
  const doDono = p.origem === "conversa" || (p.origem === "retomada" && p.modo === "conversa");
  return doDono && !p.trabalhoId && p.estado === "despachando" && p.despachadoHaMs >= (p.redeMs ?? REDE_MS) && p.fezFerramenta && (p.capacidades.bifurcaSessao || !p.capacidades.retomaSessao);
}

/** O que a linha "Abriu a task …" diz por origem (texto da mensagem `sistema`; a web desenha pelo payload). */
export function textoTrabalhoAberto(titulo: string, origem: OrigemTrabalho): string {
  // revisto em 2026-10-12 (ADR-099, I8): a rede promove a frente, não mais a task.
  return origem === "rede" ? `Virou a frente ${titulo}` : `Abriu a task ${titulo}`;
}
