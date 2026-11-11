/**
 * NOD-448 (definido em 2026-11-01, ADR-140): o que a tela precisa saber das colunas, sem DOM. O servidor valida tudo de
 * novo (src/domain/colunas.ts); aqui é só para a tela não oferecer o que vai ser recusado e dizer o porquê na hora.
 *
 * Decisões do Gil: grupos em ordem fixa e mover só dentro do grupo (1); Cancelado renomeia, mas não sai nem muda de
 * lugar (2); coluna nova no fim do grupo, Feito e Fechado nascem recolhidas (5); as da pessoa têm o ícone cinza (8).
 * ADR-162: "Precisa de você" não é mais coluna (a tarefa que espera a pessoa fica na coluna dela, com o sinal discreto).
 */
import type { ColunaDto, GrupoColuna } from "../../src/contracts/quadro.ts";
import { NOME_DO_STATUS, STATUS, type Status } from "./quadro.ts";

/** Espelho de LIMITES_QUADRO.coluna/.colunas (a web só importa tipos de src, ADR-018; o teste confere). */
export const LIMITE_NOME_COLUNA = 40;
export const LIMITE_COLUNAS = 30;
/** ADR-142: o "O que essa etapa faz" (espelha LIMITES_QUADRO.instrucoes). */
export const LIMITE_INSTRUCOES = 500;

/** ADR-142 (espelha aceitaPassagem do domínio): só não iniciado e iniciado, fora Bloqueado e Cancelado. */
export const aceitaPassagem = (c: Pick<ColunaDto, "id" | "grupo">): boolean =>
  (c.grupo === "nao_iniciado" || c.grupo === "iniciado") && c.id !== "voce" && c.id !== "bloqueado" && c.id !== "cancelado";

/**
 * ADR-142 (espelha acionaNaColuna do domínio; o teste confere): onde a passagem aciona o novo responsável ao entrar.
 * A fazer aciona apesar de ser Não iniciado (ADR-140/NOD-442); as outras de Não iniciado só passam, sem acionar.
 */
export const acionaNaColuna = (c: Pick<ColunaDto, "id" | "grupo">): boolean =>
  c.id === "afazer" || (c.grupo === "iniciado" && c.id !== "voce" && c.id !== "bloqueado");

/**
 * O card que entra aqui faz o responsável da coluna começar (coluna com responsável que aciona). Definido em 2026-11-10 (o
 * handoff do Multica): entrar já é a passagem, sem "Confirmar · Não iniciar ainda"; a rede é o Desfazer do recibo, e quem
 * quer estacionar a tarefa a deixa no Backlog.
 */
export const comecaAoEntrar = (c: Pick<ColunaDto, "id" | "grupo" | "responsavel">): boolean => !!c.responsavel && acionaNaColuna(c);

/** O recibo do card movido: "começa" só quando aciona; numa coluna com responsável que não aciona, "passa para". */
export function reciboDeMover(titulo: string, c: Pick<ColunaDto, "id" | "grupo" | "nome" | "responsavel" | "responsavelNome">): string {
  const quem = c.responsavelNome ?? "o responsável";
  if (comecaAoEntrar(c)) return `${titulo} foi para ${c.nome}; ${quem} começa`;
  if (c.responsavel) return `${titulo} foi para ${c.nome}; passa para ${quem}`;
  return `${titulo} foi para ${c.nome}`;
}

/** Por que o card não vai para esta coluna pelo Mover para… (null = vai). ADR-162: toda coluna recebe (não há mais a da pergunta). */
export function porqueNaoRecebeCard(_c: Pick<ColunaDto, "id">, _nomeDoBot = "o bot"): string | null {
  return null;
}

/** Quem pode receber a passagem (ADR-142): os bots da pessoa, fora os excluídos e o Nod (ADR-081, o servidor recusa). */
export function agentesDaPassagem(agentes: readonly { id: string; nome: string; excluidoEm?: unknown; papel?: string | null }[]): { id: string; nome: string }[] {
  return agentes.filter((a) => !a.excluidoEm && a.papel !== "nod").map((a) => ({ id: a.id, nome: a.nome }));
}

export const GRUPOS: readonly GrupoColuna[] = ["nao_iniciado", "iniciado", "feito", "fechado"];
export const NOME_DO_GRUPO: Readonly<Record<GrupoColuna, string>> = { nao_iniciado: "Não iniciado", iniciado: "Andamento", feito: "Feito", fechado: "Fechado" };
/** O que o grupo faz, numa linha (o topo do menu e a escolha da coluna nova). */
export const FRASE_DO_GRUPO: Readonly<Record<GrupoColuna, string>> = {
  nao_iniciado: "Não aciona ninguém",
  iniciado: "Entrar aciona o responsável",
  feito: "Conta no progresso",
  fechado: "Sai da conta",
};

/**
 * Espelho de colunaDeEspera (src/domain/colunas.ts; tests/unit/web/freios.test.ts confere): a coluna de onde a tarefa sai
 * quando o responsável começa. A fazer, se houver; senão a primeira de Não iniciado; senão a primeira do andamento.
 */
export function colunaDeEspera(cs: readonly Pick<ColunaDto, "id" | "grupo">[]): string {
  if (cs.some((c) => c.id === "afazer")) return "afazer";
  return cs.find((c) => c.grupo === "nao_iniciado")?.id ?? cs.find((c) => c.grupo === "iniciado" && c.id !== "voce")?.id ?? cs[0]!.id;
}

/**
 * O que ESTA coluna faz (o topo do menu): a do grupo, com as exceções das padrão que o motor trata à parte
 * (`deveComecar`): A fazer aciona apesar de ser Não iniciado; Revisão e Bloqueado não acionam.
 */
export function fraseDaColuna(c: Pick<ColunaDto, "id" | "grupo"> & Partial<Pick<ColunaDto, "responsavel" | "responsavelNome">>): string {
  if (c.responsavel && aceitaPassagem(c)) {
    const quem = c.responsavelNome ?? "o responsável";
    return acionaNaColuna(c) ? `Entrar passa para ${quem} e aciona` : `Entrar passa para ${quem}, sem acionar`;
  }
  if (c.id === "afazer") return "Entrar aciona o responsável";
  if (c.id === "revisao") return "Trocar o responsável aciona";
  if (c.id === "bloqueado") return "Não aciona ninguém";
  return FRASE_DO_GRUPO[c.grupo];
}

/** Espelho de colunasDto(COLUNAS_PADRAO) do servidor (o teste confere): o quadro de um servidor antigo vem sem `colunas`. */
const ORDEM_PADRAO: readonly Status[] = ["backlog", "afazer", "fazendo", "revisao", "bloqueado", "feito", "cancelado"];
const GRUPO_PADRAO: Readonly<Record<Status, GrupoColuna>> = {
  backlog: "nao_iniciado", afazer: "nao_iniciado", fazendo: "iniciado", revisao: "iniciado", bloqueado: "iniciado", voce: "iniciado", feito: "feito", cancelado: "fechado",
};
export const COLUNAS_PADRAO_DA_WEB: readonly ColunaDto[] = ORDEM_PADRAO.map((id) => ({
  id, nome: NOME_DO_STATUS[id], grupo: GRUPO_PADRAO[id], fixa: id === "cancelado", daPessoa: false,
  recolhida: id === "backlog" || id === "feito" || id === "cancelado",
}));

/** O quadro sempre com colunas: sem elas (servidor de antes da NOD-448, no meio do deploy), as padrão. */
export function comColunas<Q extends { colunas?: ColunaDto[] | null }>(q: Q): Q & { colunas: ColunaDto[] } {
  return Array.isArray(q.colunas) && q.colunas.length ? (q as Q & { colunas: ColunaDto[] }) : { ...q, colunas: COLUNAS_PADRAO_DA_WEB.map((c) => ({ ...c })) };
}

/** O ícone de uma coluna: a padrão tem o dela; a da pessoa usa a forma do grupo (e fica cinza, pela classe). */
export function iconeDaColuna(c: Pick<ColunaDto, "id" | "grupo">): Status {
  if ((STATUS as readonly string[]).includes(c.id)) return c.id as Status;
  return c.grupo === "nao_iniciado" ? "afazer" : c.grupo === "iniciado" ? "fazendo" : c.grupo === "feito" ? "feito" : "cancelado";
}

/** Por que esta coluna não sai (null = sai). O texto é o que o menu mostra no item desabilitado. */
export function porqueNaoRemove(cs: readonly ColunaDto[], id: string, _nomeDoBot = "o bot"): string | null {
  const c = cs.find((x) => x.id === id);
  if (!c) return "Esta coluna não existe mais.";
  if (c.fixa) return "Esta coluna fica no quadro. Dá para renomear.";
  if (c.grupo === "feito" && cs.filter((x) => x.grupo === "feito").length <= 1) return "Precisa haver uma coluna de feito.";
  // Espelho de validarColunas: sobra Fazendo ou uma do andamento da pessoa (a coluna onde o trabalho anda).
  const anda = (x: ColunaDto) => x.id === "fazendo" || (x.grupo === "iniciado" && !(STATUS as readonly string[]).includes(x.id));
  if (anda(c) && cs.filter(anda).length <= 1) return "Precisa haver uma coluna onde o trabalho anda.";
  return null;
}

export type Lado = "esquerda" | "direita";
export type PassoDeMover = { ok: true; antes_de?: string; depois_de?: string } | { ok: false; porque: string };

/** Um passo para o lado (Alt ← / Alt →, o menu, a folha do celular): só dentro do grupo, sem passar pelas fixas. */
export function passoDeMover(cs: readonly ColunaDto[], id: string, lado: Lado): PassoDeMover {
  const i = cs.findIndex((x) => x.id === id);
  const c = cs[i];
  if (!c) return { ok: false, porque: "Esta coluna não existe mais." };
  if (c.fixa) return { ok: false, porque: "Esta coluna fica no lugar" };
  const viz = cs[lado === "esquerda" ? i - 1 : i + 1];
  if (!viz || viz.grupo !== c.grupo) return { ok: false, porque: `Só entre colunas de ${NOME_DO_GRUPO[c.grupo]}` };
  if (viz.fixa) return { ok: false, porque: `${viz.nome} fica no lugar` };
  return lado === "esquerda" ? { ok: true, antes_de: viz.id } : { ok: true, depois_de: viz.id };
}

/** Soltar `id` no lugar de `alvo` (o arrasto): antes ou depois dele, conforme o lado de onde veio. Null = fora do grupo. */
export function soltarEm(cs: readonly ColunaDto[], id: string, alvo: string): { antes_de?: string; depois_de?: string } | null {
  if (id === alvo) return null;
  const i = cs.findIndex((x) => x.id === id);
  const j = cs.findIndex((x) => x.id === alvo);
  const c = cs[i];
  const a = cs[j];
  if (!c || !a || c.fixa || a.fixa || c.grupo !== a.grupo) return null;
  return i < j ? { depois_de: alvo } : { antes_de: alvo };
}

/** Para onde vão as tarefas de uma coluna que sai: todas menos ela; o padrão é a vizinha do mesmo grupo. */
export function destinosAoRemover(cs: readonly ColunaDto[], id: string): { opcoes: ColunaDto[]; padrao: string | null } {
  const opcoes = cs.filter((x) => x.id !== id && x.id !== "voce");
  const i = cs.findIndex((x) => x.id === id);
  const c = cs[i];
  const doGrupo = (x: ColunaDto | undefined) => !!x && !!c && x.grupo === c.grupo && x.id !== "voce" && x.id !== id;
  const viz = doGrupo(cs[i - 1]) ? cs[i - 1] : doGrupo(cs[i + 1]) ? cs[i + 1] : opcoes.find((x) => c && x.grupo === c.grupo) ?? opcoes[0];
  return { opcoes, padrao: viz?.id ?? null };
}

/** O nome já usado, sem acento nem caixa (a mesma régua do servidor). */
// O espelho do normalizarNome do servidor (src/domain/colunas.ts): sem marcas, minúsculas pt-BR, espaços simples.
const norma = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
/** Outra coluna com o mesmo nome, ou cujo id reservado é esse nome ("Fazendo" já é de Fazendo), como o servidor recusa. */
export function nomeRepetido(cs: readonly ColunaDto[], nome: string, menos?: string): ColunaDto | null {
  const n = norma(nome);
  const chave = n.replace(/\s+/g, "");
  return cs.find((x) => x.id !== menos && (norma(x.nome) === n || (!x.id.startsWith("c-") && x.id === chave))) ?? null;
}

/**
 * As tiras recolhidas de Feito e Fechado no fim do quadro, que ficam presas à direita enquanto o resto rola (NOD-429,
 * decisão do Marlon na NOD-448): o índice da primeira, ou `cs.length` quando o fim não tem tira.
 */
export function inicioDoFimPreso(cs: readonly { grupo: GrupoColuna; recolhida: boolean }[]): number {
  let i = cs.length;
  while (i > 0 && cs[i - 1]!.recolhida && (cs[i - 1]!.grupo === "feito" || cs[i - 1]!.grupo === "fechado")) i--;
  return i;
}

/** Sair do campo de renomear com o erro na tela: desiste se o nome segue vazio, igual ou repetido; senão, grava. */
export function saidaComErroDesiste(cs: readonly ColunaDto[], id: string, valor: string): boolean {
  const texto = valor.trim().replace(/\s+/g, " ");
  const c = cs.find((x) => x.id === id);
  return !c || !texto || texto === c.nome || nomeRepetido(cs, texto, id) !== null;
}

/**
 * O que a tela diz quando o servidor recusa uma mudança de coluna, pelo código fechado (o detalhe fica no servidor,
 * ADR-002; nunca o texto cru do erro). `manter`: a edição fica aberta com o que a pessoa digitou; senão, relê o quadro.
 * Revisão do PR #615: antes, todo erro virava "o quadro mudou".
 */
export function fraseDoErroDeColuna(codigo: string | null | undefined, onde?: "prazo"): { texto: string; manter: boolean } {
  // QA do PR #624: o 400 ao salvar o prazo é a faixa ou a coluna que não aceita prazo, não "o nome e o grupo".
  if (codigo === "entrada_invalida" && onde === "prazo") return { texto: `Não deu para salvar o prazo: use ${FAIXA_DO_PRAZO}, numa coluna onde o trabalho anda.`, manter: true };
  if (codigo === "entrada_invalida") return { texto: "Não deu para salvar assim: confira o nome e o grupo e tente de novo.", manter: true };
  if (codigo === "servidor_indisponivel" || codigo === "sem_internet") return { texto: "Sem conexão com o servidor agora. Tente de novo em instantes.", manter: true };
  return { texto: "Não deu para mudar as colunas: o quadro mudou. Relendo.", manter: false };
}

/** O que está aberto na edição das colunas (só um por vez). `naFolha`: dentro da folha do celular (fechar volta para ela). */
export type EdicaoDeColuna =
  | { tipo: "menu"; coluna: string }
  | { tipo: "renomear"; coluna: string; erro?: string; naFolha?: boolean }
  | { tipo: "nova"; depoisDe?: string; grupo?: GrupoColuna; erro?: string; naFolha?: boolean }
  | { tipo: "remover"; coluna: string; naFolha?: boolean }
  | { tipo: "ordem"; erro?: string }
  /** ADR-142: a passagem da coluna (quem começa quando a tarefa entra e o que a etapa faz). */
  | { tipo: "passagem"; coluna: string }
  /** NOD-419: o "Só sai para…" da coluna (os destinos da trava). */
  | { tipo: "trava"; coluna: string }
  /** NOD-420: o prazo (SLA) da coluna, no ⋯. */
  | { tipo: "prazo"; coluna: string; erro?: string; naFolha?: boolean }

  /**
   * ADR-142 (revisão do PR #622): o "Mover para…" do card, o caminho do teclado e do toque até o mesmo "soltar".
   * `estreito`: aberto na lista do celular (o menu só aparece na vista de onde veio).
   */
  | { tipo: "mover"; tarefa: string; estreito?: boolean };

/**
 * Revisão do QA do PR #615: o botão da coluna não tem id, então o aviso do servidor que regrava o quadro logo depois de
 * Alt+←/→ ou F2+Enter jogava o foco no body (o segundo Alt+← não fazia nada). O seletor que acha o mesmo botão no
 * quadro novo; null para quem não é botão de coluna (os com id voltam pelo id). Ids de coluna são [a-z0-9-].
 */
export function seletorDoFocoDaColuna(el: { classList: { contains(c: string): boolean }; dataset: Record<string, string | undefined>; closest(sel: string): unknown }): string | null {
  const id = el.dataset["coluna"];
  if (!id || !/^[a-z0-9-]{1,48}$/.test(id)) return null;
  if (el.classList.contains("qd-col-bt")) return `${el.closest(".qd-so-largo") ? ".qd-so-largo " : ""}.qd-col-bt[data-coluna="${id}"]`;
  // QA do PR #624 (NOD-420): depois de Salvar o prazo ou a passagem, o foco volta ao ⋯ da coluna, ao "Passar para…" ou
  // ao botão do prazo na folha; o quadro.mudou da própria mudança regrava o quadro e jogava esse foco no body.
  const act = el.dataset["act"];
  if (!act || !CONTROLES_DA_COLUNA.has(act)) return null;
  const onde = el.closest(".qd-folha") ? ".qd-folha " : el.closest(".qd-so-largo") ? ".qd-so-largo " : "";
  return `${onde}[data-act="${act}"][data-coluna="${id}"]`;
}

/** Os controles de coluna sem id que recebem o foco de volta depois de uma mudança (ver seletorDoFocoDaColuna). */
const CONTROLES_DA_COLUNA: ReadonlySet<string> = new Set(["col-menu", "col-passagem", "col-prazo", "col-renomear"]);

/** NOD-420: o prazo da coluna em palavras ("30 min", "2 h", "1 h 30 min", "3 dias"); espelha o do servidor. */
export function prazoLegivelMin(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return min === 1440 ? "1 dia" : `${min / 1440} dias`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** NOD-420: o teto do prazo (espelha LIMITES_QUADRO.prazoMin, 30 dias em minutos). */
export const LIMITE_PRAZO_MIN = 30 * 24 * 60;
/** Espelha FAIXA_DO_PRAZO do domínio ("de 1 min a 30 dias"). */
export const FAIXA_DO_PRAZO = `de 1 min a ${prazoLegivelMin(LIMITE_PRAZO_MIN)}`;

/**
 * NOD-420 (espelha podeTerPrazo do domínio): só as colunas do andamento, fora Bloqueado, Precisa de você e a coluna "só a
 * pessoa tira daqui" (NOD-419; lida estrutural, revisão 4 do PR #624). O prazo gravado numa delas fica dormente.
 */
export const podeTerPrazo = (c: Pick<ColunaDto, "id" | "grupo"> & { trava?: { soPessoa?: boolean } | null }): boolean =>
  c.grupo === "iniciado" && c.id !== "voce" && c.id !== "bloqueado" && c.trava?.soPessoa !== true;

export type UnidadeDePrazo = "min" | "h" | "dias";
const MIN_DA_UNIDADE: Readonly<Record<UnidadeDePrazo, number>> = { min: 1, h: 60, dias: 1440 };

/** O prazo do popover em minutos; null se o número não serve (vazio, zero, quebrado, acima do teto). */
export function prazoEmMin(valor: string, unidade: UnidadeDePrazo): number | null {
  const n = Number(valor.trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const min = Math.round(n * MIN_DA_UNIDADE[unidade]);
  return min >= 1 && min <= LIMITE_PRAZO_MIN ? min : null;
}

/** O prazo atual no popover: a maior unidade que o divide inteiro (90 → 90 min, 120 → 2 h, 2880 → 2 dias). */
export function prazoNoPopover(min: number | undefined): { valor: string; unidade: UnidadeDePrazo } {
  if (!min) return { valor: "", unidade: "h" };
  if (min % 1440 === 0) return { valor: String(min / 1440), unidade: "dias" };
  if (min % 60 === 0) return { valor: String(min / 60), unidade: "h" };
  return { valor: String(min), unidade: "min" };
}

/** "parada há 5 min", "parada há 3 h", "parada há 2 dias" (pelo relógio, sem segundos). */
export function paradaHa(desde: number, agora: number): string {
  const min = Math.max(0, Math.floor((agora - desde) / 60_000));
  if (min < 1) return "parada agora";
  if (min < 60) return `parada há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `parada há ${h} h`;
  const d = Math.floor(h / 24);
  return `parada há ${d === 1 ? "1 dia" : `${d} dias`}`;
}

/** NOD-420: o recibo da resposta, "Voltou para Em revisão · Beto segue" (sem Desfazer: a resposta já acionou). */
export function reciboDaResposta(q: { colunas: readonly Pick<ColunaDto, "id" | "nome">[]; tarefas: readonly { id: string; status: string; agenteNome: string | null }[] } | null, tarefaId: string): string {
  const t = q?.tarefas.find((x) => x.id === tarefaId);
  if (!t) return "Resposta enviada";
  const nome = q?.colunas.find((c) => c.id === t.status)?.nome ?? NOME_DO_STATUS[t.status as Status] ?? t.status;
  return t.agenteNome ? `Voltou para ${nome} · ${t.agenteNome} segue` : `Voltou para ${nome}`;
}
