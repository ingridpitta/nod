import { MOTIVOS_RECUSA_APP, type AppDto, type MotivoRecusaApp, type PaginasDto, type PayloadPropostaApp } from "../contracts/apps.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { AppDoBot, FonteDoApp, FormaDoApp, IconeDoApp, PedeQuando, RetratoDoApp } from "../domain/apps-do-bot.ts";
import {
  appDaPagina, appPedeVoce, cabeMaisUmApp, chaveDoNome, descreverPedeQuando, ehFonte, estadoDoApp, ehForma, ehIcone, iconePadrao, idDaPaginaDoApp, itensComPede,
  LIMITE_DE_APPS, MAX_ORDEM_GUARDADA, MAX_REGRA, moverPagina, moverRelativo, normalizarPedeQuando, normalizarRetrato, ordemParaGravar, ordemPedida, ordemQueVale, PAGINA_CANVAS, PAGINA_CONVERSA, PAGINA_TAREFAS, paginasPadrao, validarNome,
} from "../domain/apps-do-bot.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * As páginas do bot e os apps da pessoa (definido em 2026-11-02, NOD-445, ADR-146). Um executor por ação, o mesmo para a
 * tela (src/adapters/http/rotas/apps.ts) e para o chat (gerir_apps): o teste de contrato
 * (tests/integration/paridade-apps.test.ts) leva os dois ao mesmo estado no banco. Criar pelo chat abre o card (proposta
 * + decisão 'app', mesmo id); editar, ordenar, remover e restaurar saem na hora. Tudo atrás do experimento Quadro
 * (NOD_QUADROS): sem ele a pílula é a de hoje.
 *
 * As falhas são um resultado fechado (`FalhaApps`): a rota as traduz em código (ADR-002) e a ferramenta em instrução.
 */

export type FalhaApps = "experimento_desligado" | "nao_encontrado" | "entrada_invalida" | "nome_em_uso" | "limite_de_apps" | "conversa_fica";
/** `instrucao`: a instrução ao bot quando a de sempre do erro não serve (o nome tomado pelo próprio card ajustado). */
export type Falha = { ok: false; erro: FalhaApps; detalhe: string; sugestao?: string; instrucao?: string };
type Ok<T> = { ok: true } & T;
export type Resultado<T> = Ok<T> | Falha;

const falha = (erro: FalhaApps, detalhe: string, sugestao?: string, instrucao?: string): Falha => ({ ok: false, erro, detalhe, ...(sugestao ? { sugestao } : {}), ...(instrucao ? { instrucao } : {}) });

/** O card Criar/Ajustar que um card novo do mesmo app substituiu: fecha por regra (definido em 2026-11-02, revisão 5 do #626). */
export const REGRA_APP_SUBSTITUIDO = "regra:app_substituido" as const;

/** Quem pediu: a pessoa (a tela, ou o Confirmar do card) ou um bot (gerir_apps), com o turno estar limpo ou não. */
export type Autor = { tipo: "pessoa" } | { tipo: "agente"; agenteId: string; limpo: boolean };

async function experimentoLigado(deps: Deps): Promise<boolean> {
  return (await deps.repos.preferencias.buscar()).experimentos?.quadro === true;
}

const autoriaDe = (deps: Deps, autor: Autor): Autoria => (autor.tipo === "agente" ? autoriaDoAgente(deps.escopo, autor.agenteId) : autoriaPessoa(deps.escopo));

/** O bot da pessoa: o id ou o nome exato. Bot de outra pessoa (ou excluído) = não encontrado. */
async function botDaPessoa(deps: Deps, ref: string): Promise<{ id: string; nome: string } | null> {
  const r = ref.trim();
  if (!r) return null;
  const porId = /^[0-9a-f-]{36}$/i.test(r) ? await deps.repos.agentes.buscar(r) : null;
  const a = porId ?? (await deps.repos.agentes.buscarPorNome(r));
  if (!a || a.ownerId !== deps.escopo.pessoaId) return null;
  return { id: a.id, nome: a.nome };
}

/**
 * O app como a tela e o chat o veem. Com a regra estruturada, o `pede` de cada item e o `pedeVoce` saem da regra aplicada
 * agora (revisão 7 do #626): "há mais de 2 dias" acende com o tempo, sem o bot regravar o retrato.
 */
export const paraDto = (a: AppDoBot, agora: number): AppDto => ({
  id: a.id, nome: a.nome, icone: a.icone, fonte: a.fonte, fonteRef: a.fonteRef, forma: a.forma, quemVe: a.quemVe, regraPede: a.regraPede, pedeQuando: a.pedeQuando,
  dados: a.dados ? { ...a.dados, itens: itensComPede(a, agora) } : null, erroFonte: a.erroFonte, pedeVoce: appPedeVoce(a, agora), estado: estadoDoApp(a),
  criadoEm: a.criadoEm, atualizadoEm: a.atualizadoEm,
});

/** As páginas que valem agora para o bot: a ordem guardada normalizada, os apps vivos e se Tarefas existe. */
async function montar(deps: Deps, agenteId: string): Promise<PaginasDto> {
  const [apps, quadro, guardada, canvas] = await Promise.all([deps.repos.appsDoBot.doAgente(agenteId), deps.repos.quadros.doAgente(agenteId), deps.repos.appsDoBot.ordem(agenteId), deps.repos.canvas.nivelDe(agenteId)]);
  const temTarefas = quadro !== null;
  const temCanvas = canvas !== null;
  const ordem = ordemQueVale(guardada, paginasPadrao({ temTarefas, temCanvas, apps }));
  return { agenteId, ordem, apps: apps.map((a) => paraDto(a, deps.agora())), temTarefas, temCanvas, cabeMais: cabeMaisUmApp({ apps: apps.length }), limite: LIMITE_DE_APPS };
}

/** O app do bot pelo id, pela página (`app:<id>`) ou pelo nome (sem acento nem caixa; removido, o mais recente). */
async function acharApp(deps: Deps, agenteId: string, ref: string, o: { removido?: boolean } = {}): Promise<AppDoBot | null> {
  const r = ref.trim();
  const id = appDaPagina(r) ?? r;
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const a = await deps.repos.appsDoBot.buscar(id, o);
    return a && a.agenteId === agenteId ? a : null;
  }
  // Removido pelo nome (o chat: "traz o Vagas de volta"): o removido mais recente com esse nome (revisão 4 do #626).
  if (o.removido) return r ? deps.repos.appsDoBot.removidoPorNome(agenteId, r) : null;
  const chave = chaveDoNome(r);
  return (await deps.repos.appsDoBot.doAgente(agenteId)).find((a) => chaveDoNome(a.nome) === chave) ?? null;
}

/** A página pelo id ou pelo nome que a pessoa diz ("Tarefas", "Conversa", "Vagas"). */
function paginaPelaRef(p: PaginasDto, ref: string): string | null {
  const r = ref.trim();
  if (p.ordem.includes(r)) return r;
  const chave = chaveDoNome(r);
  if (chave === "conversa") return PAGINA_CONVERSA;
  if (chave === "tarefas" || chave === "quadro") return p.temTarefas ? PAGINA_TAREFAS : null;
  // Sem acesso ao Canvas, "canvas" ainda pode ser um app antigo com esse nome (revisão 5 do #649).
  if (chave === "canvas" && p.temCanvas) return PAGINA_CANVAS;
  const a = p.apps.find((x) => x.id === r || chaveDoNome(x.nome) === chave);
  return a ? idDaPaginaDoApp(a.id) : null;
}

/**
 * ADA-9, definido em 2026-11-04: "abra no quadro" pelo chat num bot sem quadro não acha a página Tarefas. Com `semQuadro` (só o gerir_apps passa),
 * a recusa diz o caminho (criar o quadro) em vez do "confira o nome", que fazia o bot procurar um app chamado Quadro.
 * A tela não passa: a ordem inteira dela segue tolerante ("o que sobra é ignorado", ADR-146 §3; revisão 1 do #648).
 */
function semQuadro(p: PaginasDto, ref: string, instrucao: string | undefined): Falha | null {
  const chave = chaveDoNome(ref.trim());
  if (instrucao === undefined || p.temTarefas || (chave !== "tarefas" && chave !== "quadro")) return null;
  return falha("nao_encontrado", "este bot ainda não tem quadro (a página Tarefas)", undefined, instrucao);
}

const eventoPaginas = (deps: Deps, autor: Autor, agenteId: string, motivo: string, conversaId?: string | null): RuntimeEvent =>
  evento(deps.escopo, { kind: "paginas_mudaram", autoria: autoriaDe(deps, autor), agora: deps.agora(), conversaId: conversaId ?? null, dados: { agenteId, motivo } });

type Comum = { agenteId: string; autor?: Autor; conversaId?: string | null };

async function preparar(deps: Deps, agenteId: string): Promise<Falha | null> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "as páginas do bot estão desligadas nos experimentos da pessoa (Quadro)");
  const a = await deps.repos.agentes.buscar(agenteId);
  if (!a || a.ownerId !== deps.escopo.pessoaId) return falha("nao_encontrado", "bot não encontrado");
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- ler

export async function listarPaginas(deps: Deps, input: { agenteId: string }): Promise<Resultado<{ paginas: PaginasDto }>> {
  const f = await preparar(deps, input.agenteId);
  if (f) return f;
  return { ok: true, paginas: await montar(deps, input.agenteId) };
}

// ------------------------------------------------------------------------------------------------------------ ordenar

export type PedidoOrdem = Comum & {
  /** A ordem inteira (a tela manda assim, depois de arrastar). */
  ordem?: readonly string[];
  /** Ou um passo só (o chat: "põe Tarefas antes da Conversa"; o teclado: Alt+←/→). */
  pagina?: string;
  posicao?: number;
  antes_de?: string;
  depois_de?: string;
  /** ADA-9, definido em 2026-11-04: a instrução ao bot quando ele pede o quadro num bot sem quadro (só o chat; a tela não manda). */
  semQuadro?: string;
};

/**
 * Reordena as páginas, a Conversa inclusive. A ordem inteira vale se for das páginas que existem (o desconhecido sai, o que
 * falta entra no fim); duas abas ao mesmo tempo, vale a última. A primeira é a home do bot.
 */
export async function ordenarPaginas(deps: Deps, input: PedidoOrdem): Promise<{ data: Resultado<{ paginas: PaginasDto }>; events: RuntimeEvent[] }> {
  const f = await preparar(deps, input.agenteId);
  if (f) return { data: f, events: [] };
  await deps.repos.appsDoBot.travar(input.agenteId);
  const atual = await montar(deps, input.agenteId);
  let nova: string[];
  if (Array.isArray(input.ordem)) {
    if (input.ordem.length > MAX_ORDEM_GUARDADA || input.ordem.some((x) => typeof x !== "string")) return { data: falha("entrada_invalida", "ordem: uma lista de ids de página"), events: [] };
    const pedeQuadro = input.ordem.map((x) => semQuadro(atual, x, input.semQuadro)).find((x) => x !== null);
    if (pedeQuadro) return { data: pedeQuadro, events: [] };
    nova = ordemPedida(input.ordem.map((x) => paginaPelaRef(atual, x) ?? x), atual.ordem);
  } else if (typeof input.pagina === "string") {
    const id = paginaPelaRef(atual, input.pagina);
    if (!id) return { data: semQuadro(atual, input.pagina, input.semQuadro) ?? falha("nao_encontrado", `a página ${input.pagina} não existe neste bot`), events: [] };
    const alvoRef = input.antes_de ?? input.depois_de;
    if (alvoRef !== undefined) {
      const alvo = paginaPelaRef(atual, alvoRef);
      if (!alvo) return { data: semQuadro(atual, alvoRef, input.semQuadro) ?? falha("nao_encontrado", `a página ${alvoRef} não existe neste bot`), events: [] };
      nova = moverRelativo(atual.ordem, id, alvo, input.antes_de !== undefined ? "antes" : "depois");
    } else if (typeof input.posicao === "number" && Number.isFinite(input.posicao)) {
      // Posição para a pessoa começa em 1 ("a primeira página").
      nova = moverPagina(atual.ordem, id, input.posicao - 1);
    } else return { data: falha("entrada_invalida", "diga para onde: posicao (1 = a primeira), antes_de ou depois_de"), events: [] };
  } else return { data: falha("entrada_invalida", "mande a ordem inteira ou a página com posicao, antes_de ou depois_de"), events: [] };
  await gravar(deps, input.agenteId, nova);
  return { data: { ok: true, paginas: { ...atual, ordem: nova } }, events: [eventoPaginas(deps, input.autor ?? { tipo: "pessoa" }, input.agenteId, "ordem", input.conversaId)] };
}

/** Grava a ordem nova (só páginas vivas) guardando o lugar dos apps removidos, para o Desfazer devolvê-los lá. */
async function gravar(deps: Deps, agenteId: string, nova: readonly string[]): Promise<void> {
  const [guardada, removidos] = await Promise.all([deps.repos.appsDoBot.ordem(agenteId), deps.repos.appsDoBot.removidos(agenteId)]);
  // Sem ordem guardada, o lugar dos removidos sai da ordem padrão com eles dentro (a de criação).
  let padrao: string[] = [];
  if (!guardada && removidos.length) {
    // Vivos e removidos numa consulta só, já na ordem de criação do banco: colar duas listas embaralhava os que
    // nasceram no mesmo milissegundo (o domínio desempata pela ordem recebida).
    const [todos, quadro, canvas] = await Promise.all([deps.repos.appsDoBot.todosParaOrdem(agenteId), deps.repos.quadros.doAgente(agenteId), deps.repos.canvas.nivelDe(agenteId)]);
    padrao = paginasPadrao({ temTarefas: quadro !== null, temCanvas: canvas !== null, apps: todos });
  }
  await deps.repos.appsDoBot.gravarOrdem(agenteId, ordemParaGravar(nova, guardada, removidos.map((r) => idDaPaginaDoApp(r.id)), padrao));
}

// ------------------------------------------------------------------------------------------------- remover / restaurar

export async function removerApp(deps: Deps, input: Comum & { app: string }): Promise<{ data: Resultado<{ paginas: PaginasDto; app: AppDto }>; events: RuntimeEvent[] }> {
  const f = await preparar(deps, input.agenteId);
  if (f) return { data: f, events: [] };
  const ref = input.app.trim();
  const ck = chaveDoNome(ref);
  if (ref === PAGINA_CONVERSA || ck === "conversa") return { data: falha("conversa_fica", "a Conversa não sai das páginas (dá para mudar de lugar)"), events: [] };
  if (ref === PAGINA_TAREFAS || ck === "tarefas") return { data: falha("entrada_invalida", "Tarefas é o quadro do bot: some quando o quadro é removido (gerir_quadro remover_quadro)"), events: [] };
  // Sem acesso ao Canvas, "canvas" pode ser um app antigo com esse nome, que sai normalmente (revisão 6 do #649).
  if (ref === PAGINA_CANVAS || (ck === "canvas" && (await montar(deps, input.agenteId)).temCanvas)) return { data: falha("entrada_invalida", "o Canvas é o app nativo: sai quando a pessoa tira o acesso deste bot em Apps → Canvas"), events: [] };
  // A trava do bot, como em ordenar, restaurar e no card: quem grava a ordem ou conta os apps ao mesmo tempo espera.
  await deps.repos.appsDoBot.travar(input.agenteId);
  const app = await acharApp(deps, input.agenteId, ref);
  if (!app) return { data: falha("nao_encontrado", `o app ${ref} não existe neste bot`), events: [] };
  const removido = await deps.repos.appsDoBot.remover(app.id, deps.agora());
  if (!removido) return { data: falha("nao_encontrado", "o app já foi removido"), events: [] };
  // Retenção: só o último removido de cada nome fica para o Desfazer (o restaurar pelo nome já traz só ele); os de antes
  // com o mesmo nome saem de vez. O dado de origem não está nesta linha e fica (revisão 5 do #626, ADR-146).
  await deps.repos.appsDoBot.apagarRemovidosAntigos(input.agenteId, removido.nome, removido.id);
  log("info", "nod_app_removido", { agente_id: input.agenteId });
  return { data: { ok: true, paginas: await montar(deps, input.agenteId), app: paraDto(removido, deps.agora()) }, events: [eventoPaginas(deps, input.autor ?? { tipo: "pessoa" }, input.agenteId, "remover", input.conversaId)] };
}

/** O Desfazer da remoção: volta no lugar que tinha na ordem (a ordem guardada não perde o id enquanto ele está fora). */
export async function restaurarApp(deps: Deps, input: Comum & { app: string }): Promise<{ data: Resultado<{ paginas: PaginasDto; app: AppDto }>; events: RuntimeEvent[] }> {
  const f = await preparar(deps, input.agenteId);
  if (f) return { data: f, events: [] };
  // A trava antes de contar: um card confirmado ao mesmo tempo espera (ou é esperado), e o limite vale para os dois.
  await deps.repos.appsDoBot.travar(input.agenteId);
  const app = await acharApp(deps, input.agenteId, input.app, { removido: true });
  if (!app) return { data: falha("nao_encontrado", `não há app removido com esse id ou nome neste bot: ${input.app.trim()}`), events: [] };
  const atual = await montar(deps, input.agenteId);
  if (!atual.cabeMais) return { data: falha("limite_de_apps", `o bot já tem ${LIMITE_DE_APPS - 1} apps, o limite (a ${LIMITE_DE_APPS}ª página é de Tarefas): remova um antes`), events: [] };
  const r = await deps.repos.appsDoBot.restaurar(app.id);
  if (r === "nome_repetido") return { data: falha("nome_em_uso", `outro app do bot já se chama ${app.nome}: renomeie aquele antes`), events: [] };
  if (!r) return { data: falha("nao_encontrado", "o app não estava removido"), events: [] };
  return { data: { ok: true, paginas: await montar(deps, input.agenteId), app: paraDto(r, deps.agora()) }, events: [eventoPaginas(deps, input.autor ?? { tipo: "pessoa" }, input.agenteId, "restaurar", input.conversaId)] };
}

// ------------------------------------------------------------------------------------------------------------- editar

export type CamposPedidos = {
  nome?: unknown; icone?: unknown; forma?: unknown; fonte?: unknown; fonte_ref?: unknown; regra_pede?: unknown; pede_quando?: unknown; dados?: unknown; erro_fonte?: unknown;
};

const ERRO_PEDE_QUANDO = "pede_quando: {coluna?, dias_desde? (0 a 3650), valor_acima?, valor_abaixo?}, com ao menos um";

const textoOuNull = (v: unknown, max: number): string | null | undefined | false => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? false : t;
};

/**
 * Edita o app: nome, ícone, forma, fonte, a regra do "pede você" e o retrato que o bot mantém (dados, erro_fonte). O
 * retrato gravado por um turno que leu conteúdo de fora perde as marcas `pede` (cerca 3, ADR-062): a página mostra os
 * itens, mas um texto de fora não acende o laranja sozinho.
 */
export async function editarApp(deps: Deps, input: Comum & { app: string } & CamposPedidos): Promise<{ data: Resultado<{ paginas: PaginasDto; app: AppDto; erroFonteDescartado?: true }>; events: RuntimeEvent[] }> {
  const f = await preparar(deps, input.agenteId);
  if (f) return { data: f, events: [] };
  const app = await acharApp(deps, input.agenteId, input.app);
  if (!app) return { data: falha("nao_encontrado", `o app ${input.app} não existe neste bot`), events: [] };
  const c: Parameters<typeof deps.repos.appsDoBot.salvar>[1] = {};
  if (input.nome !== undefined) {
    if (typeof input.nome !== "string") return { data: falha("entrada_invalida", "nome: texto"), events: [] };
    const v = validarNome(input.nome, await deps.repos.appsDoBot.doAgente(input.agenteId), app.id);
    if (!v.ok) return { data: v.motivo === "duplicado" ? falha("nome_em_uso", `outro app (ou página) do bot já se chama ${input.nome.trim()}`, v.sugestao) : falha("entrada_invalida", v.motivo === "vazio" ? "nome vazio" : "nome com mais de 20 caracteres"), events: [] };
    c.nome = v.nome;
  }
  if (input.icone !== undefined) {
    if (!ehIcone(input.icone)) return { data: falha("entrada_invalida", "ícone desconhecido"), events: [] };
    c.icone = input.icone;
  }
  if (input.forma !== undefined) {
    if (!ehForma(input.forma)) return { data: falha("entrada_invalida", "forma: lista, quadro, painel ou doc"), events: [] };
    c.forma = input.forma;
  }
  if (input.fonte !== undefined) {
    if (!ehFonte(input.fonte)) return { data: falha("entrada_invalida", "fonte: tarefas, conector, arquivo ou bot"), events: [] };
    c.fonte = input.fonte;
  }
  const ref = textoOuNull(input.fonte_ref, 500);
  if (ref === false) return { data: falha("entrada_invalida", "fonte_ref: até 500 caracteres"), events: [] };
  if (ref !== undefined) c.fonteRef = ref;
  // A mesma regra do criar (validarCriacao): conector e arquivo dizem qual (revisão 5 do #626).
  const fonteFinal = c.fonte ?? app.fonte;
  if ((fonteFinal === "conector" || fonteFinal === "arquivo") && !(ref !== undefined ? ref : app.fonteRef)) return { data: falha("entrada_invalida", `fonte ${fonteFinal}: diga qual em fonte_ref (o slug do conector ou o caminho do arquivo)`), events: [] };
  const regra = textoOuNull(input.regra_pede, MAX_REGRA);
  if (regra === false) return { data: falha("entrada_invalida", `regra_pede: até ${MAX_REGRA} caracteres`), events: [] };
  if (regra !== undefined) c.regraPede = regra;
  // Apagar a regra apaga as duas (QA do #626): sem texto na tela, não sobra regra estruturada acendendo o laranja.
  if (regra === null && input.pede_quando === undefined) c.pedeQuando = null;
  if (input.pede_quando !== undefined) {
    const pq = normalizarPedeQuando(input.pede_quando);
    if (pq === false) return { data: falha("entrada_invalida", ERRO_PEDE_QUANDO), events: [] };
    c.pedeQuando = pq;
    // A frase acompanha a regra nova, como no card do propor (`regra ?? descreverPedeQuando`): a do bot se veio junto,
    // senão a descrição da estruturada; a frase antiga nunca fica descrevendo a regra que saiu (QA do #626). Tirar a
    // estruturada sem frase nova tira a frase também.
    c.regraPede = regra ?? (pq ? descreverPedeQuando(pq) : null);
  }
  const erro = textoOuNull(input.erro_fonte, 300);
  if (erro === false) return { data: falha("entrada_invalida", "erro_fonte: até 300 caracteres"), events: [] };
  const deFora = input.autor?.tipo === "agente" && !input.autor.limpo;
  // A linha de erro da fonte só de turno limpo (ADR-047, revisão 5 do #626): um texto de fora não põe o app em erro nem
  // tira o "Pedir acesso de novo" do lugar. De turno sujo, descartada (o resultado diz `erroFonteDescartado`).
  const erroDescartado = erro !== undefined && deFora;
  if (erro !== undefined && !deFora) c.erroFonte = erro;
  if (input.dados !== undefined) {
    if (input.dados === null) c.dados = null;
    else {
      const r = normalizarRetrato(input.dados);
      if (!r) return { data: falha("entrada_invalida", "dados: {itens: [{titulo, detalhe?, coluna?, valor?, pede?}], texto?}"), events: [] };
      c.dados = deFora ? semPede(r) : r;
      // O retrato novo diz que a fonte respondeu: a linha de erro sai, a não ser que venha junto.
      if (erro === undefined || erroDescartado) c.erroFonte = null;
    }
  }
  if (Object.keys(c).length === 0) return { data: falha("entrada_invalida", erroDescartado ? "erro_fonte de um turno que leu conteúdo de fora não é gravado: só num turno limpo" : "nada para mudar"), events: [] };
  const r = await deps.repos.appsDoBot.salvar(app.id, c);
  if (r === "nome_repetido") return { data: falha("nome_em_uso", "outro app do bot acabou de ganhar esse nome"), events: [] };
  if (!r) return { data: falha("nao_encontrado", "o app foi removido"), events: [] };
  return { data: { ok: true, paginas: await montar(deps, input.agenteId), app: paraDto(r, deps.agora()), ...(erroDescartado ? { erroFonteDescartado: true as const } : {}) }, events: [eventoPaginas(deps, input.autor ?? { tipo: "pessoa" }, input.agenteId, "editar", input.conversaId)] };
}

const semPede = (r: RetratoDoApp): RetratoDoApp => ({ ...r, itens: r.itens.map(({ pede: _p, ...i }) => i) });

// -------------------------------------------------------------------------------------------------------------- criar

export type PedidoApp = {
  /** O bot da conversa (quem propõe). */
  agenteId: string;
  conversaId: string;
  turnoId: string;
  /** O bot que ganha o app: o id ou o nome ("cria um app de vagas para a Nina"); sem ele, o da conversa. */
  bot?: unknown;
  nome?: unknown; icone?: unknown; fonte?: unknown; fonte_ref?: unknown; forma?: unknown; regra_pede?: unknown; pede_quando?: unknown;
};

type CamposValidos = { alvo: { id: string; nome: string }; nome: string; icone: IconeDoApp; fonte: FonteDoApp; fonteRef: string | null; forma: FormaDoApp; regraPede: string | null; pedeQuando: PedeQuando | null };

/** As mesmas regras para propor e para confirmar (o nome pode ter sido tomado entre os dois). */
async function validarCriacao(deps: Deps, p: { alvoId: string; nome: unknown; icone?: unknown; fonte?: unknown; fonte_ref?: unknown; forma?: unknown; regra_pede?: unknown; pede_quando?: unknown }): Promise<Falha | CamposValidos> {
  const f = await preparar(deps, p.alvoId);
  if (f) return f;
  const alvo = await deps.repos.agentes.buscar(p.alvoId);
  if (!alvo) return falha("nao_encontrado", "bot não encontrado");
  if (typeof p.nome !== "string") return falha("entrada_invalida", "nome: texto de 1 a 20 caracteres");
  const atual = await montar(deps, p.alvoId);
  if (!atual.cabeMais) return falha("limite_de_apps", `${alvo.nome} já tem ${LIMITE_DE_APPS - 1} apps, o limite (a ${LIMITE_DE_APPS}ª página é de Tarefas): sugira remover um antes`);
  const v = validarNome(p.nome, atual.apps);
  if (!v.ok) return v.motivo === "duplicado" ? falha("nome_em_uso", `${alvo.nome} já tem um app (ou página) chamado ${p.nome.trim()}`, v.sugestao) : falha("entrada_invalida", v.motivo === "vazio" ? "nome vazio" : "nome com mais de 20 caracteres");
  const forma = p.forma === undefined ? "lista" : p.forma;
  if (!ehForma(forma)) return falha("entrada_invalida", "forma: lista, quadro, painel ou doc");
  const fonte = p.fonte === undefined ? "bot" : p.fonte;
  if (!ehFonte(fonte)) return falha("entrada_invalida", "fonte: tarefas, conector, arquivo ou bot");
  const icone = p.icone === undefined || p.icone === null ? iconePadrao(forma) : p.icone;
  if (!ehIcone(icone)) return falha("entrada_invalida", "ícone desconhecido");
  const fonteRef = textoOuNull(p.fonte_ref, 500);
  if (fonteRef === false) return falha("entrada_invalida", "fonte_ref: até 500 caracteres");
  if ((fonte === "conector" || fonte === "arquivo") && !fonteRef) return falha("entrada_invalida", `fonte ${fonte}: diga qual em fonte_ref (o slug do conector ou o caminho do arquivo)`);
  const regra = textoOuNull(p.regra_pede, MAX_REGRA);
  if (regra === false) return falha("entrada_invalida", `regra_pede: até ${MAX_REGRA} caracteres`);
  const pq = p.pede_quando === undefined ? null : normalizarPedeQuando(p.pede_quando);
  if (pq === false) return falha("entrada_invalida", ERRO_PEDE_QUANDO);
  return { alvo: { id: alvo.id, nome: alvo.nome }, nome: v.nome, icone, fonte, fonteRef: fonteRef ?? null, forma, regraPede: regra ?? (pq ? descreverPedeQuando(pq) : null), pedeQuando: pq };
}

/**
 * O bot propõe um app (gerir_apps propor): valida tudo como o Confirmar validaria e abre o card Criar/Ajustar na conversa.
 * Nada nasce até a pessoa confirmar. O ajuste é pela conversa: o bot propõe de novo o MESMO app (mesmo bot, mesmo nome
 * sem acento nem caixa), e só o card pendente dele sai; cards de outros apps na conversa seguem confirmáveis (revisão 3
 * do #626). `fechados` lista só os que de fato saíram por este pedido (o card que o Criar já levou não conta).
 */
export async function proporApp(deps: Deps, p: PedidoApp): Promise<{ data: Resultado<{ propostaId: string; payload: PayloadPropostaApp; fechados: { propostaId: string; nome: string }[] }>; events: RuntimeEvent[] }> {
  let alvoId = p.agenteId;
  if (p.bot !== undefined && p.bot !== null) {
    if (typeof p.bot !== "string") return { data: falha("entrada_invalida", "bot: o id ou o nome"), events: [] };
    const b = await botDaPessoa(deps, p.bot);
    if (!b) return { data: falha("nao_encontrado", `a pessoa não tem um bot chamado ${p.bot}`), events: [] };
    alvoId = b.id;
  }
  const v = await validarCriacao(deps, { alvoId, nome: p.nome, icone: p.icone, fonte: p.fonte, fonte_ref: p.fonte_ref, forma: p.forma, regra_pede: p.regra_pede, pede_quando: p.pede_quando });
  if ("ok" in v) return { data: v, events: [] };
  const agora = deps.agora();
  const autoria = autoriaDoAgente(deps.escopo, p.agenteId);
  const events: RuntimeEvent[] = [];
  const fechados: { propostaId: string; nome: string }[] = [];
  // O ajuste: o card anterior do mesmo app (mesmo bot, mesmo nome) nesta conversa, ainda aberto, sai.
  const chave = chaveDoNome(v.nome);
  const travadas: { id: string; nome: string }[] = [];
  let algumCandidato = false;
  for (const antiga of await deps.repos.propostas.pendentesDaConversa(p.conversaId)) {
    if (antiga.payload.kind !== "app" || antiga.payload.alvoId !== v.alvo.id || chaveDoNome(antiga.payload.nome) !== chave) continue;
    algumCandidato = true;
    // A mesma ordem de trava do decidirApp (proposta, depois decisão): travar a decisão antes cruzava com o Criar do mesmo
    // card e dava 40P01 (revisão 4 do #626). A leitura acima não trava: o Criar (ou o Recusar) pode ter ganhado entre ela e
    // a trava, e aí o card não sai nem entra em `fechados`.
    const travada = await deps.repos.propostas.buscarParaAtualizar(antiga.id);
    if (travada && travada.estado === "pendente") travadas.push({ id: antiga.id, nome: antiga.payload.nome });
  }
  // A validação acima leu antes das travas: o Criar que esperamos pode ter feito o app com este nome (ou fechado a
  // conta do limite). Revalida depois delas e, em conflito, nada fecha (revisão 5 do #626).
  if (algumCandidato) {
    const atual = await montar(deps, v.alvo.id);
    if (!atual.cabeMais) return { data: falha("limite_de_apps", `${v.alvo.nome} já tem ${LIMITE_DE_APPS - 1} apps, o limite (a ${LIMITE_DE_APPS}ª página é de Tarefas): sugira remover um antes`), events: [] };
    const nv = validarNome(v.nome, atual.apps);
    if (!nv.ok) {
      const existente = atual.apps.find((a) => chaveDoNome(a.nome) === chave);
      return { data: falha("nome_em_uso", `${v.alvo.nome} já tem o app ${existente?.nome ?? v.nome} (o card anterior acabou de ser confirmado)`, undefined, `O app já existe: para ajustá-lo, chame {op: "editar", app: "${existente?.id ?? v.nome}"} com a mudança, em vez de propor de novo.`), events: [] };
    }
  }
  for (const antiga of travadas) {
    // O card substituído fecha por regra, não como se a pessoa o tivesse recusado (decidida_por fica nulo, ADR-042).
    const fechada = await deps.repos.decisoes.fecharPorRegra(antiga.id, { regra: REGRA_APP_SUBSTITUIDO, regraVersao: 1, agora });
    if (!(await deps.repos.propostas.decidir(antiga.id, "recusada"))) continue;
    fechados.push({ propostaId: antiga.id, nome: antiga.nome });
    if (fechada) events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria: { ...autoria, decidido_por: REGRA_APP_SUBSTITUIDO, regra_versao: 1 }, agora, conversaId: p.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: "app", regra: REGRA_APP_SUBSTITUIDO } }));
  }
  const payload: PayloadPropostaApp = {
    kind: "app", alvoId: v.alvo.id, alvoNome: v.alvo.nome, nome: v.nome, icone: v.icone, fonte: v.fonte, fonteRef: v.fonteRef, forma: v.forma, quemVe: "so_eu", regraPede: v.regraPede, ...(v.pedeQuando ? { pedeQuando: v.pedeQuando } : {}), turnoId: p.turnoId,
  };
  const proposta = await deps.repos.propostas.criar({ conversaId: p.conversaId, agenteId: p.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const frase = `Criar o app ${v.nome} em ${v.alvo.nome}`;
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "app", agenteId: p.agenteId, conversaId: p.conversaId, turnoId: p.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase });
  events.push(evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { proposta_id: proposta.id, kind: "app" } }));
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { decisao_id: decisao.id, tipo: "app" } }));
  return { data: { ok: true, propostaId: proposta.id, payload, fechados }, events };
}

/**
 * O card decidido (POST decisoes/:id/decidir). Recusar fecha; confirmar revalida (o nome ou o limite podem ter mudado) e
 * cria o app como último da ordem. Card que não vale mais: fecha como recusado, avisa na conversa e devolve `obsoleta`
 * sem lançar (a rota responde 409 depois do commit, o molde da NOD-159), com o `motivo` da lista fechada quando há um
 * (revisão 6 do #626: a web diz a frase dele, não o vermelho genérico).
 */
export const decidirApp: CasoDeUso<{ decisaoId: string; recusar: boolean }, { criado: AppDto | null; obsoleta?: true; motivo?: MotivoRecusaApp }> = async (deps, input) => {
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.decisaoId);
  if (!proposta || proposta.payload.kind !== "app") throw new ErroDeDominio("nao_encontrado", { cause: "proposta de app" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const payload = proposta.payload;
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  let criado: AppDto | null = null;
  let texto: string;
  if (input.recusar) {
    texto = `App ${payload.nome} não criado.`;
  } else {
    // A trava do bot antes de contar (o Desfazer e outro card confirmado ao mesmo tempo esperam esta transação).
    await deps.repos.appsDoBot.travar(payload.alvoId);
    const v = await validarCriacao(deps, { alvoId: payload.alvoId, nome: payload.nome, icone: payload.icone, fonte: payload.fonte, fonte_ref: payload.fonteRef, forma: payload.forma, regra_pede: payload.regraPede, pede_quando: payload.pedeQuando ?? undefined });
    const novo = "ok" in v ? null : await deps.repos.appsDoBot.criar({ agenteId: v.alvo.id, nome: v.nome, icone: v.icone, fonte: v.fonte, fonteRef: v.fonteRef, forma: v.forma, quemVe: "so_eu", regraPede: v.regraPede, pedeQuando: v.pedeQuando });
    if (!novo) {
      const motivo = "ok" in v ? v.detalhe : "outro app acabou de ganhar esse nome";
      const fechada = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
      if (!fechada) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
      await deps.repos.propostas.decidir(proposta.id, "recusada");
      await registrar(deps, proposta.conversaId, `O app ${payload.nome} não foi criado: ${motivo}. Peça de novo se ainda quiser.`, events);
      events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: "app", recusada: true } }));
      // Sem Falha, o criar voltou null: outro app ganhou o nome entre a validação e o INSERT (o índice único).
      const recusa = "ok" in v ? ((MOTIVOS_RECUSA_APP as readonly string[]).includes(v.erro) ? (v.erro as MotivoRecusaApp) : undefined) : "nome_em_uso";
      return { data: { criado: null, obsoleta: true, ...(recusa ? { motivo: recusa } : {}) }, events };
    }
    criado = paraDto(novo, agora);
    // Entra como a última página. Com ordem guardada, ela é normalizada antes (a que vale já põe o novo no fim) e só os
    // removidos cedem lugar no teto de 20: nenhuma página viva, nem a Conversa, é cortada. Sem ordem guardada, a padrão
    // já o põe no fim.
    if (await deps.repos.appsDoBot.ordem(novo.agenteId)) await gravar(deps, novo.agenteId, (await montar(deps, novo.agenteId)).ordem);
    texto = `App ${novo.nome} criado em ${payload.alvoNome}: é a última página da pílula.`;
    events.push(eventoPaginas(deps, { tipo: "pessoa" }, novo.agenteId, "criar", proposta.conversaId));
  }
  const decidida = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
  await deps.repos.propostas.atualizarPayload(proposta.id, { ...payload, appId: criado?.id ?? null });
  await deps.repos.propostas.decidir(proposta.id, input.recusar ? "recusada" : "confirmada");
  await registrar(deps, proposta.conversaId, texto, events);
  events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: decidida.turnoId, dados: { decisao_id: decidida.id, tipo: "app", recusada: input.recusar } }));
  log("info", "nod_app_decidido", { criado: criado !== null });
  return { data: { criado }, events };
};

async function registrar(deps: Deps, conversaId: string, texto: string, events: RuntimeEvent[]): Promise<void> {
  const autoria = autoriaPessoa(deps.escopo);
  const msg = await deps.repos.mensagens.criar({ conversaId, autoria, kind: "sistema", assunto: "aprovacao.recibo", texto, confianca: "confiavel" });
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
}
