import { FONTES_DO_APP, FORMAS_DO_APP, ICONES_DO_APP, MAX_ORDEM_GUARDADA } from "../contracts/apps.ts";
import type { EstadoDoApp, FonteDoApp, FormaDoApp, IconeDoApp, ItemDoRetrato, PedeQuando, QuemVe, RetratoDoApp } from "../contracts/apps.ts";

export { FONTES_DO_APP, FORMAS_DO_APP, ICONES_DO_APP, QUEM_VE } from "../contracts/apps.ts";
export type { FonteDoApp, FormaDoApp, IconeDoApp, ItemDoRetrato, PedeQuando, QuemVe, RetratoDoApp } from "../contracts/apps.ts";

/**
 * NOD-445, Bloco 2 (definido em 2026-11-02, protótipo v1 do Gil aprovado pela Ada): as páginas do bot e os apps que a
 * pessoa cria. A Conversa é uma página que nunca sai; Tarefas aparece quando o bot tem quadro; cada app é mais uma
 * página. A ordem é por bot, guardada no servidor, e a primeira página é a tela inicial (home) do bot.
 *
 * O app só EXIBE: mostra o retrato (`dados`) que o próprio bot grava com os acessos dele; as ações saem pela conversa.
 * Aqui ficam só as regras, sem banco nem relógio (o `agora` vem por parâmetro).
 */

/**
 * definido em 2026-11-02 (protótipo v1, recomendação do Gil aprovada): até 12 páginas além da Conversa por bot; Tarefas
 * conta. A vaga de Tarefas fica sempre reservada (revisão 3 do #626): Tarefas liga sozinha quando o quadro nasce, e o
 * quadro não passa por aqui, então um bot sem quadro com 12 apps chegaria a 13 páginas.
 */
export const LIMITE_DE_APPS = 12;
/** definido em 2026-10-31 (spec da NOD-445): nome curto, até 20 caracteres. */
export const MAX_NOME_DO_APP = 20;
/** O retrato que o bot grava: um teto para a linha não crescer sem fim (itens e texto do doc). */
export const MAX_ITENS_DO_RETRATO = 200;
export const MAX_TEXTO_DO_RETRATO = 20_000;
export const MAX_REGRA = 300;

/** Os ids das páginas fixas; app é `app:<uuid>`. */
export const PAGINA_CONVERSA = "conversa";
export const PAGINA_TAREFAS = "tarefas";
/** ADA-13 (ADR-150): a página embutida do app Canvas, no bot com acesso; fora do limite de 12 (não é app do bot). */
export const PAGINA_CANVAS = "canvas";
export const idDaPaginaDoApp = (appId: string): string => `app:${appId}`;
export function appDaPagina(id: string): string | null {
  return id.startsWith("app:") && id.length > 4 ? id.slice(4) : null;
}

export type AppDoBot = {
  id: string;
  agenteId: string;
  nome: string;
  icone: IconeDoApp;
  fonte: FonteDoApp;
  /** O conector (slug), o caminho do arquivo ou nada. */
  fonteRef: string | null;
  forma: FormaDoApp;
  quemVe: QuemVe;
  /** A regra do "pede você" em linguagem natural; null = o app nunca acende o laranja. */
  regraPede: string | null;
  /** A regra estruturada do "pede você", avaliada aqui (revisão 7 do #626); null = vale a marca `pede` do bot. */
  pedeQuando: PedeQuando | null;
  dados: RetratoDoApp | null;
  /** Por que a fonte não respondeu (conector revogado, arquivo sumiu); null = a fonte está bem. */
  erroFonte: string | null;
  criadoEm: number;
  atualizadoEm: number;
};

/** A chave do nome para o duplicado: sem acento, sem caixa e com os espaços colapsados ("Vagás " = "vagas"). */
export function chaveDoNome(nome: string): string {
  return nome.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

export type ValidacaoDoNome = { ok: true; nome: string } | { ok: false; motivo: "vazio" | "longo" | "duplicado"; sugestao?: string };

/**
 * O nome do app: aparado, de 1 a 20 caracteres e sem repetir outro app do bot (ignorando maiúsculas e acentos). As
 * páginas fixas também contam ("Conversa", "Tarefas"), e "Quadro" também (revisão 2 do #626): no chat ele é o apelido
 * de Tarefas (`paginaPelaRef` em src/use-cases/apps-do-bot.ts), e um app com esse nome ficaria inalcançável por lá;
 * "Canvas" é a página do app Canvas (ADA-13, #649 revisão 4).
 * `ignorar` é o próprio app ao renomear. No duplicado, a sugestão é o nome com o primeiro número livre ("Vagas 2").
 */
export function validarNome(nome: string, existentes: readonly { id?: string; nome: string }[], ignorar?: string): ValidacaoDoNome {
  const limpo = nome.replace(/\s+/g, " ").trim();
  if (!limpo) return { ok: false, motivo: "vazio" };
  if ([...limpo].length > MAX_NOME_DO_APP) return { ok: false, motivo: "longo" };
  const tomadas = new Set([chaveDoNome("Conversa"), chaveDoNome("Tarefas"), chaveDoNome("Quadro"), chaveDoNome("Canvas"), ...existentes.filter((e) => !ignorar || e.id !== ignorar).map((e) => chaveDoNome(e.nome))]);
  if (!tomadas.has(chaveDoNome(limpo))) return { ok: true, nome: limpo };
  return { ok: false, motivo: "duplicado", sugestao: sugerirNome(limpo, tomadas) };
}

function sugerirNome(nome: string, tomadas: ReadonlySet<string>): string {
  for (let n = 2; n < 100; n++) {
    const sufixo = ` ${n}`;
    const base = [...nome].slice(0, MAX_NOME_DO_APP - sufixo.length).join("").trim();
    const candidato = `${base}${sufixo}`;
    if (!tomadas.has(chaveDoNome(candidato))) return candidato;
  }
  return nome;
}

/** Cabe mais um app? Até 11: a 12ª página é de Tarefas, com quadro ou não (o quadro criado depois não estoura). */
export function cabeMaisUmApp(o: { apps: number }): boolean {
  return o.apps < LIMITE_DE_APPS - 1;
}

/**
 * As páginas que existem agora, na ordem padrão: a Conversa, Tarefas (se o bot tem quadro), o Canvas (se o bot tem
 * acesso ao app Canvas, ADA-13) e os apps na ordem de criação.
 */
export function paginasPadrao(o: { temTarefas: boolean; temCanvas?: boolean; apps: readonly Pick<AppDoBot, "id" | "criadoEm">[] }): string[] {
  // `criadoEm` vem em milissegundos; o banco guarda microssegundos e já devolve os apps por (criado_em, id). Dois apps
  // criados no mesmo milissegundo (CI em máquina rápida, 2026-11-04: "Vagas" e "Leituras" trocavam de lugar entre dois
  // bots) empatam aqui, e o sort estável mantém a ordem do banco. Desempatar por id embaralhava: o id é aleatório.
  const apps = [...o.apps].sort((a, b) => a.criadoEm - b.criadoEm).map((a) => idDaPaginaDoApp(a.id));
  return [PAGINA_CONVERSA, ...(o.temTarefas ? [PAGINA_TAREFAS] : []), ...(o.temCanvas ? [PAGINA_CANVAS] : []), ...apps];
}

/**
 * A ordem que vale: a guardada, sem repetidas nem as que não existem mais, e as que faltam (um app novo, Tarefas que
 * acabou de ligar) no fim, na ordem padrão. A Conversa nunca some: se faltar na guardada, entra na ordem padrão (a
 * primeira). Sem nada guardado, a padrão.
 */
export function ordemQueVale(guardada: readonly string[] | null, existentes: readonly string[]): string[] {
  const existe = new Set(existentes);
  const vistos = new Set<string>();
  const ordem: string[] = [];
  for (const id of guardada ?? []) {
    if (existe.has(id) && !vistos.has(id)) { vistos.add(id); ordem.push(id); }
  }
  for (const [i, id] of existentes.entries()) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    // A Conversa ausente da guardada volta ao começo (ela é a home padrão); o resto entra no fim.
    if (id === PAGINA_CONVERSA && i === 0) ordem.unshift(id);
    else ordem.push(id);
  }
  return ordem;
}

/**
 * A ordem pedida (pela tela ou pelo chat) é aceita se for uma permutação das páginas que existem; senão, a que vale
 * (tira o desconhecido, completa o que falta). Nunca lança: duas abas reordenando ao mesmo tempo, vale a última.
 */
export function ordemPedida(pedida: readonly string[], existentes: readonly string[]): string[] {
  return ordemQueVale(pedida, existentes);
}

/**
 * definido em 2026-11-02 (0145, CHECK de paginas_do_bot.ordem): a ordem guardada tem no máximo 20 ids. Mora no contrato
 * (src/contracts/apps.ts) porque o schema do gerir_apps usa o mesmo teto para a ordem pedida (revisão 7 do #626).
 */
export { MAX_ORDEM_GUARDADA } from "../contracts/apps.ts";

/**
 * A ordem a gravar (revisão 1 do #626): a nova, só de páginas vivas, com os apps removidos que o Desfazer ainda traz de
 * volta no lugar que tinham na guardada (logo depois da página que vinha antes deles; sem nenhuma antes, no começo).
 * Assim reordenar com um app fora não manda o app para o fim quando ele volta. No teto de 20, só saem removidos (os do
 * fim de `removidos`, que vem do mais recente para o mais antigo); página viva, e a Conversa, nunca são cortadas.
 * Sem ordem guardada (a primeira vez que a pessoa reordena), a referência é `padrao`: a ordem padrão com os removidos
 * incluídos (`paginasPadrao` sobre os vivos e os removidos), para o app removido antes do primeiro arrasto também ter
 * lugar para voltar (revisão 2 do #626, achado 3; antes ele saía da ordem e o Desfazer o mandava para o fim).
 */
export function ordemParaGravar(nova: readonly string[], guardada: readonly string[] | null, removidos: readonly string[], padrao: readonly string[] = []): string[] {
  const vivos = new Set(nova);
  const cabem = Math.max(0, MAX_ORDEM_GUARDADA - nova.length);
  const manter = new Set(removidos.filter((id) => !vivos.has(id)).slice(0, cabem));
  const ordem = [...nova];
  const antes = guardada ?? padrao;
  for (const [i, id] of antes.entries()) {
    if (!manter.has(id) || ordem.includes(id)) continue;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = ordem.indexOf(antes[j]!);
      if (k >= 0) { pos = k + 1; break; }
    }
    ordem.splice(pos, 0, id);
  }
  return ordem;
}

/** Leva o id para a posição `para` (0 = a primeira, a home), presa nas pontas. Id ausente: a ordem como veio. */
export function moverPagina(ordem: readonly string[], id: string, para: number): string[] {
  const de = ordem.indexOf(id);
  if (de < 0) return [...ordem];
  const nova = ordem.filter((x) => x !== id);
  nova.splice(Math.max(0, Math.min(nova.length, Math.floor(para))), 0, id);
  return nova;
}

/** "põe Tarefas antes da Conversa": leva `id` para logo antes (ou depois) de `alvo`. */
export function moverRelativo(ordem: readonly string[], id: string, alvo: string, lado: "antes" | "depois"): string[] {
  if (id === alvo || !ordem.includes(id) || !ordem.includes(alvo)) return [...ordem];
  const sem = ordem.filter((x) => x !== id);
  const i = sem.indexOf(alvo);
  sem.splice(lado === "antes" ? i : i + 1, 0, id);
  return sem;
}

/** A home do bot: a primeira página da ordem (a Conversa quando não há nada). */
export function homeDoBot(ordem: readonly string[]): string {
  return ordem[0] ?? PAGINA_CONVERSA;
}

/**
 * Revisão 7 do #626 (ADR-146): o "pede você" calculado no servidor. Antes ele era só a marca `pede` que o bot grava, e o
 * retrato de turno que leu conteúdo de fora perde essa marca (ADR-047); como atualizar um app de conector ou arquivo é
 * ler a fonte, o laranja desses apps nunca acendia. Com a regra estruturada (`pedeQuando`, que só muda em turno limpo ou
 * pelo card que a pessoa confirma), quem decide é a regra da pessoa aplicada aos campos do item, em qualquer turno: o
 * conteúdo de fora preenche o retrato, mas não escreve o `pede`. A marca do bot é ignorada quando há regra estruturada.
 */
const DIA_MS = 86_400_000;
/** definido em 2026-11-02 (revisão 7 do #626): dez anos bastam para "há mais de N dias". */
export const MAX_DIAS_DESDE = 3650;

/** A regra estruturada que chega (do bot ou do card): null = sem regra; false = inválida (nenhuma condição, número torto). */
export function normalizarPedeQuando(v: unknown): PedeQuando | null | false {
  if (v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const r: PedeQuando = {};
  if (o.coluna !== undefined) {
    if (typeof o.coluna !== "string" || !o.coluna.trim() || o.coluna.trim().length > 40) return false;
    r.coluna = o.coluna.trim();
  }
  if (o.dias_desde !== undefined) {
    if (typeof o.dias_desde !== "number" || !Number.isFinite(o.dias_desde) || o.dias_desde < 0 || o.dias_desde > MAX_DIAS_DESDE) return false;
    r.dias_desde = o.dias_desde;
  }
  for (const k of ["valor_acima", "valor_abaixo"] as const) {
    if (o[k] === undefined) continue;
    const n = o[k];
    if (typeof n !== "number" || !Number.isFinite(n)) return false;
    r[k] = n;
  }
  return Object.keys(r).length ? r : false;
}

/** A regra em português, para o card e a lista quando o bot não escreve a frase ("coluna Sem resposta e há mais de 2 dias"). */
export function descreverPedeQuando(p: PedeQuando): string {
  const partes: string[] = [];
  if (p.coluna !== undefined) partes.push(`coluna ${p.coluna}`);
  if (p.dias_desde !== undefined) partes.push(`há mais de ${p.dias_desde} ${p.dias_desde === 1 ? "dia" : "dias"}`);
  if (p.valor_acima !== undefined) partes.push(`valor acima de ${p.valor_acima}`);
  if (p.valor_abaixo !== undefined) partes.push(`valor abaixo de ${p.valor_abaixo}`);
  return partes.join(" e ");
}

/** O número do `valor` do item ("R$ 1.200,50" = 1200.5, "90" = 90, "3.5" = 3.5); null = sem número. */
export function numeroDoValor(valor: string | undefined): number | null {
  const m = valor?.match(/-?\d[\d.,]*/);
  if (!m) return null;
  let t = m[0];
  // Com vírgula, o ponto é de milhar (pt-BR); sem ela, um ponto só com 3 dígitos depois também é milhar ("1.200").
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".").replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** O item cumpre a regra? Todas as condições dadas; um campo que falta no item (sem `desde`, sem número) não cumpre. */
export function itemPede(i: ItemDoRetrato, p: PedeQuando, agora: number): boolean {
  if (p.coluna !== undefined && (!i.coluna || chaveDoNome(i.coluna) !== chaveDoNome(p.coluna))) return false;
  if (p.dias_desde !== undefined) {
    const t = i.desde ? Date.parse(i.desde) : Number.NaN;
    if (!Number.isFinite(t) || agora - t <= p.dias_desde * DIA_MS) return false;
  }
  if (p.valor_acima !== undefined || p.valor_abaixo !== undefined) {
    const n = numeroDoValor(i.valor);
    if (n === null) return false;
    if (p.valor_acima !== undefined && !(n > p.valor_acima)) return false;
    if (p.valor_abaixo !== undefined && !(n < p.valor_abaixo)) return false;
  }
  return true;
}

/**
 * Os itens como a tela os mostra: com regra estruturada, o `pede` de cada um é o da regra (a marca do bot sai); sem ela,
 * a marca do bot, que só vale com a regra em texto (o jeito antigo). Sem regra em texto, nada pede, nem com a estruturada
 * (QA do #626: a tela diz "sem regra" e o laranja não pode acender por uma regra que a pessoa não vê).
 */
export function itensComPede(a: Pick<AppDoBot, "regraPede" | "pedeQuando" | "dados">, agora: number): ItemDoRetrato[] {
  const itens = a.dados?.itens ?? [];
  if (!a.regraPede?.trim()) return itens.map(({ pede: _p, ...i }) => i);
  if (a.pedeQuando) {
    const p = a.pedeQuando;
    return itens.map(({ pede: _p, ...i }) => (itemPede(i, p, agora) ? { ...i, pede: true } : i));
  }
  return itens;
}

/**
 * O app pede a pessoa? Com regra estruturada, algum item a cumpre (`itemPede`, em qualquer turno); sem ela, só com a regra
 * em texto e algum item marcado `pede` pelo bot. Com a fonte em erro, não acende: o ícone apagado já diz.
 */
export function appPedeVoce(a: Pick<AppDoBot, "regraPede" | "pedeQuando" | "dados" | "erroFonte">, agora: number): boolean {
  if (a.erroFonte) return false;
  return itensComPede(a, agora).some((i) => i.pede === true);
}

/**
 * O estado da página do app na tela (vai no `AppDto.estado`; a web desenha por ele). Sem retrato (o app recém-criado, que
 * o bot ainda não preencheu) é "vazio": a frase e o exemplo do que pedir, nunca um esqueleto sem fim (revisão 4 do #626).
 * O doc mostra o texto e os itens; as outras formas, só os itens.
 */
export function estadoDoApp(a: Pick<AppDoBot, "dados" | "erroFonte" | "forma">): EstadoDoApp {
  if (a.erroFonte) return "erro";
  const d = a.dados;
  if (!d) return "vazio";
  if (d.itens.length > 0) return "pronto";
  return a.forma === "doc" && d.texto?.trim() ? "pronto" : "vazio";
}

/** Normaliza o retrato que o bot manda: corta textos, itens demais e campos estranhos. null = o retrato inválido. */
export function normalizarRetrato(v: unknown): RetratoDoApp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { itens?: unknown; texto?: unknown };
  const corta = (x: unknown, n: number): string | undefined => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : undefined);
  const itens: ItemDoRetrato[] = [];
  for (const bruto of Array.isArray(o.itens) ? o.itens.slice(0, MAX_ITENS_DO_RETRATO) : []) {
    if (!bruto || typeof bruto !== "object") continue;
    const b = bruto as Record<string, unknown>;
    const titulo = corta(b.titulo, 200);
    if (!titulo) continue;
    const detalhe = corta(b.detalhe, 300);
    const coluna = corta(b.coluna, 40);
    const valor = corta(b.valor, 40);
    // A data do item só se for data de verdade, guardada em ISO (a regra `dias_desde` conta daqui).
    const t = typeof b.desde === "string" ? Date.parse(b.desde.trim().slice(0, 40)) : Number.NaN;
    const desde = Number.isFinite(t) ? new Date(t).toISOString() : undefined;
    itens.push({ titulo, ...(detalhe ? { detalhe } : {}), ...(coluna ? { coluna } : {}), ...(valor ? { valor } : {}), ...(desde ? { desde } : {}), ...(b.pede === true ? { pede: true } : {}) });
  }
  const texto = corta(o.texto, MAX_TEXTO_DO_RETRATO);
  return { itens, ...(texto ? { texto } : {}) };
}

/** O ícone que o bot sugere pela forma, quando ele não diz qual. */
export function iconePadrao(forma: FormaDoApp): IconeDoApp {
  return forma === "quadro" ? "quadro" : forma === "painel" ? "painel" : forma === "doc" ? "doc" : "lista";
}

export const ehForma = (v: unknown): v is FormaDoApp => typeof v === "string" && (FORMAS_DO_APP as readonly string[]).includes(v);
export const ehFonte = (v: unknown): v is FonteDoApp => typeof v === "string" && (FONTES_DO_APP as readonly string[]).includes(v);
export const ehIcone = (v: unknown): v is IconeDoApp => typeof v === "string" && (ICONES_DO_APP as readonly string[]).includes(v);
