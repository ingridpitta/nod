import type { ColunaDto, ColunaQuadro, GrupoColuna, IdColuna, StatusTarefa } from "../contracts/quadro.ts";
import { GRUPOS_COLUNA, LIMITES_QUADRO, STATUS_TAREFA } from "../contracts/quadro.ts";

/**
 * As colunas do quadro, puras (definido em 2026-11-01, NOD-448). A pessoa cria, renomeia, reordena e remove colunas; o
 * GRUPO de cada uma dá o comportamento (ADR-140). As 7 colunas padrão têm ids reservados e o comportamento de sempre;
 * a coluna da pessoa (`c-<slug>`) se comporta pelo grupo. O status da tarefa é o id da coluna, menos `voce`.
 *
 * ADR-162 (definido em 2026-11-10, fluxo Multica): "Precisa de você" não é mais coluna. O status `voce` ficou como a marca
 * de "esperando a pessoa": a tarefa aparece na coluna de onde veio (`voltarPara`, `colunaNaTela`) com o sinal discreto.
 */

export type ErroColuna = { erro: string };

const NOMES_PADRAO: Readonly<Record<StatusTarefa, string>> = {
  backlog: "Backlog", afazer: "A fazer", fazendo: "Fazendo", revisao: "Em revisão", bloqueado: "Bloqueado", voce: "Esperando você",
  feito: "Feito", cancelado: "Cancelado",
};

export const GRUPO_PADRAO: Readonly<Record<StatusTarefa, GrupoColuna>> = {
  backlog: "nao_iniciado", afazer: "nao_iniciado",
  fazendo: "iniciado", revisao: "iniciado", bloqueado: "iniciado", voce: "iniciado",
  feito: "feito", cancelado: "fechado",
};

/** ADR-162: o status que marca a tarefa esperando a pessoa (não é coluna; era "Precisa de você"). */
export const ESPERA_PESSOA = "voce" as const;
/** ADR-162: como o histórico nomeia a espera da pessoa (os movimentos de antes e os de agora para `voce`). */
export const NOME_DA_ESPERA = NOMES_PADRAO.voce;

/** As colunas de todo quadro que nunca mexeu nas dele (`quadros.colunas` null). ADR-162: sem "Precisa de você". */
export const COLUNAS_PADRAO: readonly ColunaQuadro[] = STATUS_TAREFA.filter((id) => id !== ESPERA_PESSOA).map((id) => ({ id, nome: NOMES_PADRAO[id], grupo: GRUPO_PADRAO[id] }));

/** Não move nem sai (decisão do Gil): "Cancelado", a última do fechado. */
export const COLUNAS_FIXAS: ReadonlySet<string> = new Set(["cancelado"]);

const ID_COLUNA = /^[a-z0-9-]{1,48}$/;

export const ehReservada = (id: string): id is StatusTarefa => (STATUS_TAREFA as readonly string[]).includes(id);
export const ehGrupo = (v: unknown): v is GrupoColuna => typeof v === "string" && (GRUPOS_COLUNA as readonly string[]).includes(v);

/**
 * As colunas de verdade do quadro (as padrão quando ele não tem as dele). ADR-162: a "Precisa de você" gravada num
 * quadro de antes sai na leitura (sem migração que mova linhas).
 */
export function colunasDe(q: { colunas: readonly ColunaQuadro[] | null } | null | undefined): ColunaQuadro[] {
  return (q?.colunas ?? COLUNAS_PADRAO).filter((c) => c.id !== ESPERA_PESSOA).map((c) => ({ ...c }));
}

/** ADR-162: a tarefa espera a pessoa (perguntou, ou um freio a deixou com ela). Bloqueado é coluna e fica à parte. */
export const esperandoPessoa = (t: { status: IdColuna }): boolean => t.status === ESPERA_PESSOA;

/**
 * ADR-162: a coluna em que a tarefa aparece. A que espera a pessoa fica na coluna de onde veio (`voltarPara`); sem ela (ou
 * se a coluna saiu), na de andamento, senão na de espera.
 */
export function colunaNaTela(colunas: readonly ColunaQuadro[], t: { status: IdColuna; voltarPara: IdColuna | null }): IdColuna {
  if (!esperandoPessoa(t)) return t.status;
  if (t.voltarPara && t.voltarPara !== ESPERA_PESSOA && colunas.some((c) => c.id === t.voltarPara)) return t.voltarPara;
  return colunaDeAndamento(colunas) ?? colunaDeEspera(colunas);
}

/** Para comparar nomes: sem acento, sem caixa, espaços juntos. "Finalização" = "finalizacao". */
export function normalizarNome(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

export function grupoDe(colunas: readonly ColunaQuadro[], id: IdColuna): GrupoColuna | null {
  return colunas.find((c) => c.id === id)?.grupo ?? (ehReservada(id) ? GRUPO_PADRAO[id] : null);
}

/**
 * O papel da coluna no motor: o id reservado é o próprio papel; a coluna da pessoa faz o papel do grupo (não iniciado
 * espera como o Backlog, iniciado anda como Fazendo, feito conta como Feito, fechado sai da conta como Cancelado).
 */
export function papelDe(colunas: readonly ColunaQuadro[], id: IdColuna): StatusTarefa {
  if (ehReservada(id)) return id;
  const g = grupoDe(colunas, id);
  if (g === "iniciado") return "fazendo";
  if (g === "feito") return "feito";
  if (g === "fechado") return "cancelado";
  return "backlog";
}

/** A coluna onde o trabalho anda: Fazendo, senão a primeira de andamento da pessoa; null se não houver. */
export function colunaDeAndamento(colunas: readonly ColunaQuadro[]): IdColuna | null {
  if (colunas.some((c) => c.id === "fazendo")) return "fazendo";
  return colunas.find((c) => c.grupo === "iniciado" && !ehReservada(c.id))?.id ?? null;
}

/** Onde a tarefa espera (nova sem coluna, segurada, devolvida): A fazer, senão a 1ª não iniciada, senão a 1ª do andamento. */
export function colunaDeEspera(colunas: readonly ColunaQuadro[]): IdColuna {
  if (colunas.some((c) => c.id === "afazer")) return "afazer";
  return colunas.find((c) => c.grupo === "nao_iniciado")?.id ?? colunas.find((c) => c.grupo === "iniciado")?.id ?? colunas[0]!.id;
}

const primeiraDo = (colunas: readonly ColunaQuadro[], g: GrupoColuna) => colunas.find((c) => c.grupo === g)?.id ?? null;

/**
 * NOD-416: onde a tarefa nova nasce quando ninguém diz a coluna: a 1ª de Não iniciado que não aciona ninguém pela regra
 * da main (`acionaNaColuna`: A fazer é pulada mesmo que a pessoa a tenha posto antes do Backlog) e sem passagem
 * (`responsavelDe`: a espera com responsável passaria a tarefa a outro bot). Sem nenhuma assim, a 1ª de Não iniciado que
 * não aciona, e por fim a de espera; quem cria a marca para não acionar (revisão 2 do PR #623). Começar é pedir:
 * `status afazer`. revisto em 2026-11-02 (revisão 7 do PR #623): antes usava um predicado próprio (`acionaAoEntrar`).
 */
export function colunaDeEntrada(colunas: readonly ColunaQuadro[]): IdColuna {
  const espera = colunas.filter((c) => c.grupo === "nao_iniciado" && !acionaNaColuna(colunas, c.id));
  return (espera.find((c) => !c.responsavel) ?? espera[0])?.id ?? colunaDeEspera(colunas);
}

/** NOD-416: a coluna padrão de um grupo (a tarefa que muda de quadro cai nela quando o destino não tem a mesma coluna). */
export function colunaPadraoDoGrupo(colunas: readonly ColunaQuadro[], g: GrupoColuna): IdColuna {
  if (g === "nao_iniciado") return colunaDeEntrada(colunas);
  if (g === "iniciado") return colunaDeAndamento(colunas) ?? primeiraDo(colunas, "iniciado") ?? colunaDeEntrada(colunas);
  if (g === "feito") return primeiraDo(colunas, "feito") ?? colunaDeEntrada(colunas);
  return "cancelado";
}

/**
 * Revisão 7 do PR #623: a coluna do grupo `g` em que a tarefa de `agenteId` pode cair sem a passagem de outro bot
 * (`responsavelDe` vazio ou o próprio responsável). A padrão do grupo primeiro; senão a 1ª assim; senão a padrão.
 */
export function colunaDoGrupoSemPassagem(colunas: readonly ColunaQuadro[], g: GrupoColuna, agenteId: string | null): IdColuna {
  const livre = (id: IdColuna) => { const r = responsavelDe(colunas, id); return r === null || r === agenteId; };
  const padrao = colunaPadraoDoGrupo(colunas, g);
  if (livre(padrao)) return padrao;
  // Em Não iniciado, sem a que aciona (A fazer): a tarefa que esperava não passa a "pode começar" só por mudar de quadro.
  return colunas.find((c) => c.grupo === g && c.id !== "bloqueado" && livre(c.id) && (g !== "nao_iniciado" || !acionaNaColuna(colunas, c.id)))?.id ?? padrao;
}

/** Os apelidos que o bot já usa ("status feito") valem mesmo depois que a pessoa troca as colunas. */
function porApelido(colunas: readonly ColunaQuadro[], chave: string): IdColuna | null {
  switch (chave) {
    // "afazer" = "pode começar" (o bot o usa para acionar): sem a coluna A fazer, é a de andamento do quadro, que aciona
    // quem entra vindo da espera (revisão 4 do PR #615; antes caía em Pedido e ninguém começava).
    case "afazer": case "a fazer": case "todo": return colunas.some((c) => c.id === "afazer") ? "afazer" : colunaDeAndamento(colunas) ?? colunaDeEspera(colunas);
    case "fazendo": case "andamento": case "em andamento": case "iniciado": return colunaDeAndamento(colunas) ?? primeiraDo(colunas, "iniciado");
    case "backlog": case "nao iniciado": case "nao_iniciado": return primeiraDo(colunas, "nao_iniciado") ?? colunaDeEspera(colunas);
    case "feito": case "concluido": case "pronto": case "done": return primeiraDo(colunas, "feito");
    case "cancelado": case "fechado": return "cancelado";
    case "revisao": case "em revisao": return colunas.some((c) => c.id === "revisao") ? "revisao" : colunaDeAndamento(colunas);
    default: return null;
  }
}

/** A lista que o bot lê quando erra o nome: `pedido "Pedido" (nao_iniciado), …`. */
export function listaDeColunas(colunas: readonly ColunaQuadro[]): string {
  return colunas.map((c) => `${c.id} "${c.nome}" (${c.grupo})`).join(", ");
}

/** A coluna por id, nome (sem acento nem caixa) ou apelido do padrão. */
export function resolverColuna(colunas: readonly ColunaQuadro[], ref: string): IdColuna | ErroColuna {
  const r = ref.trim();
  const porId = colunas.find((c) => c.id === r.toLowerCase());
  if (porId) return porId.id;
  const chave = normalizarNome(r);
  const porNome = colunas.find((c) => normalizarNome(c.nome) === chave);
  if (porNome) return porNome.id;
  const apelido = porApelido(colunas, chave);
  if (apelido && colunas.some((c) => c.id === apelido)) return apelido;
  return { erro: `coluna "${r}" não existe neste quadro. Colunas: ${listaDeColunas(colunas)}` };
}

/**
 * O status de uma tarefa: a coluna, ou `voce` (ADR-162: não é coluna; o parse segue aceitando o status antigo, que vira
 * o "perguntar" — a tarefa fica na coluna e espera a pessoa).
 */
export function resolverStatus(colunas: readonly ColunaQuadro[], ref: string): IdColuna | ErroColuna {
  if (["voce", "precisa de voce", "esperando voce"].includes(normalizarNome(ref))) return ESPERA_PESSOA;
  return resolverColuna(colunas, ref);
}

/** `c-<slug>` único: o id não muda quando a pessoa renomeia (as tarefas apontam para ele). */
export function idNovo(nome: string, usados: Iterable<string>): string {
  const ja = new Set(usados);
  const base = `c-${normalizarNome(nome).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "coluna"}`.replace(/-+$/, "");
  if (!ja.has(base)) return base;
  for (let n = 2; ; n++) if (!ja.has(`${base}-${n}`)) return `${base}-${n}`;
}

function nomeValido(nome: unknown): string | ErroColuna {
  if (typeof nome !== "string" || nome.trim() === "") return { erro: "nome da coluna vazio" };
  const n = nome.trim().replace(/\s+/g, " ");
  if (n.length > LIMITES_QUADRO.coluna) return { erro: `nome da coluna passa de ${LIMITES_QUADRO.coluna} caracteres` };
  return n;
}

/**
 * As regras do conjunto (o que a tela e a conversa não conseguem quebrar): de 1 a 30 colunas, ids e nomes únicos, grupos
 * na ordem fixa, o grupo das padrão não muda, "Cancelado" última do fechado, ao menos uma em Feito e uma onde o trabalho
 * espera ou anda. ADR-162: "Precisa de você" não é coluna (o id `voce` fica de fora).
 */
export function validarColunas(colunas: readonly ColunaQuadro[]): ErroColuna | null {
  if (colunas.length === 0) return { erro: "o quadro precisa de colunas" };
  if (colunas.length > LIMITES_QUADRO.colunas) return { erro: `o quadro passa de ${LIMITES_QUADRO.colunas} colunas` };
  const ids = new Set<string>();
  const nomes = new Map<string, string>();
  let grupoAntes = 0;
  for (const c of colunas) {
    if (!ID_COLUNA.test(c.id)) return { erro: `id de coluna inválido: ${c.id}` };
    if (!ehReservada(c.id) && !c.id.startsWith("c-")) return { erro: `id de coluna inválido: ${c.id}` };
    if (c.id === ESPERA_PESSOA) return { erro: "\"Precisa de você\" não é mais coluna: a tarefa que espera a pessoa fica na coluna dela" };
    if (ids.has(c.id)) return { erro: `coluna repetida: ${c.id}` };
    ids.add(c.id);
    if (!ehGrupo(c.grupo)) return { erro: `grupo inválido: ${String(c.grupo)} (use nao_iniciado, iniciado, feito ou fechado)` };
    if (ehReservada(c.id) && GRUPO_PADRAO[c.id] !== c.grupo) return { erro: `o grupo de "${c.nome}" não muda` };
    if (c.prazoMin !== undefined) {
      if (!Number.isInteger(c.prazoMin) || c.prazoMin < 1 || c.prazoMin > LIMITES_QUADRO.prazoMin) return { erro: `prazo de "${c.nome}" inválido (minutos, de 1 a ${LIMITES_QUADRO.prazoMin}, ou seja, ${FAIXA_DO_PRAZO})` };
      if (!podeTerPrazo({ id: c.id, grupo: c.grupo })) return { erro: `prazo só vale numa coluna onde o trabalho anda, não em "${c.nome}"` };
    }
    const n = nomeValido(c.nome);
    if (typeof n !== "string") return n;
    const chave = normalizarNome(n);
    if (nomes.has(chave)) return { erro: `Já existe uma coluna ${nomes.get(chave)}` };
    nomes.set(chave, n);
    const ep = erroDaPassagem(c);
    if (ep) return ep;
    const et = erroDaTrava(c);
    if (et) return et;
    const g = GRUPOS_COLUNA.indexOf(c.grupo);
    if (g < grupoAntes) return { erro: "os grupos ficam na ordem: não iniciado, iniciado, feito, fechado" };
    grupoAntes = g;
  }
  // O nome de uma coluna não pode ser o id reservado de OUTRA ("Feito" renomeada para "Fazendo" confundiria o bot).
  for (const c of colunas) {
    const chave = normalizarNome(c.nome).replace(/\s+/g, "");
    if (ehReservada(chave) && chave !== c.id && ids.has(chave)) return { erro: `Já existe uma coluna ${nomes.get(normalizarNome(colunas.find((x) => x.id === chave)!.nome))}` };
  }
  const fechado = colunas.filter((c) => c.grupo === "fechado");
  if (fechado.at(-1)?.id !== "cancelado") return { erro: "\"Cancelado\" fica no quadro, por último no fechado" };
  if (!colunas.some((c) => c.grupo === "feito")) return { erro: "o quadro precisa de ao menos uma coluna em Feito" };
  if (!colunas.some((c) => c.grupo === "nao_iniciado" || c.grupo === "iniciado")) return { erro: "o quadro precisa de ao menos uma coluna onde o trabalho espera ou anda" };
  // Sem Fazendo nem uma coluna de andamento da pessoa, a tarefa "começava" e ficava parada em A fazer (revisão do PR #615).
  if (colunaDeAndamento(colunas) === null) return { erro: "o quadro precisa de uma coluna onde o trabalho anda: Fazendo ou uma sua em Andamento" };
  return null;
}

/** O intervalo [ini, fim) do grupo na lista, sem as fixas (onde uma coluna do grupo pode ficar). */
function faixaMovel(colunas: readonly ColunaQuadro[], g: GrupoColuna): [number, number] {
  let ini = colunas.findIndex((c) => GRUPOS_COLUNA.indexOf(c.grupo) >= GRUPOS_COLUNA.indexOf(g));
  if (ini < 0) ini = colunas.length;
  let fim = ini;
  while (fim < colunas.length && colunas[fim]!.grupo === g && !COLUNAS_FIXAS.has(colunas[fim]!.id)) fim++;
  return [ini, fim];
}

export type Mudanca = { colunas: ColunaQuadro[]; ajustada: boolean };

/**
 * A coluna exige a pessoa ("só uma pessoa tira daqui", NOD-419)? Estrutural: lê `trava.soPessoa` se a coluna tiver,
 * sem depender do tipo da trava (a NOD-419 traz o tipo).
 */
export type ComTrava = Pick<Partial<ColunaQuadro>, "trava">;
export function exigePessoa(coluna: Partial<ColunaQuadro> | undefined): boolean {
  return coluna?.trava?.soPessoa === true;
}

/**
 * NOD-420: o prazo só vale onde o trabalho anda; esperar a pessoa (Bloqueado e a coluna "só a pessoa
 * tira daqui") já chama a pessoa, e ninguém além dela tira a tarefa de lá (revisão 4 do PR #624: o prazo ali seria
 * cobrar o responsável por algo que ele não pode fazer). A coluna que ganha a trava depois de ter prazo guarda o número,
 * mas ele fica dormente: `validarColunas` só olha o grupo (ligar a trava não falha por causa do prazo), o varredor
 * (`atrasosDePrazo`) e a tela ignoram; tirada a trava, o prazo volta a valer.
 */
export function podeTerPrazo(c: Pick<ColunaQuadro, "id" | "grupo"> & ComTrava): boolean {
  return c.grupo === "iniciado" && c.id !== "bloqueado" && !exigePessoa(c);
}

/** Coluna nova: no fim do grupo, ou logo depois de `depois_de` se ela for do mesmo grupo. */
export function criarColuna(atuais: readonly ColunaQuadro[], op: { nome: string; grupo: GrupoColuna; depois_de?: string; prazo_min?: number | null }): (Mudanca & { id: string }) | ErroColuna {
  if (!ehGrupo(op.grupo)) return { erro: "coluna nova precisa de grupo: nao_iniciado, iniciado, feito ou fechado" };
  const nome = nomeValido(op.nome);
  if (typeof nome !== "string") return nome;
  const colunas = atuais.map((c) => ({ ...c }));
  const id = idNovo(nome, colunas.map((c) => c.id));
  const [ini, fim] = faixaMovel(colunas, op.grupo);
  let pos = fim;
  let ajustada = false;
  if (op.depois_de !== undefined) {
    const ref = resolverColuna(colunas, op.depois_de);
    if (typeof ref !== "string") return ref;
    const i = colunas.findIndex((c) => c.id === ref);
    if (i >= ini && i < fim) pos = i + 1;
    else ajustada = true;
  }
  colunas.splice(pos, 0, { id, nome, grupo: op.grupo, ...(typeof op.prazo_min === "number" ? { prazoMin: op.prazo_min } : {}) });
  const e = validarColunas(colunas);
  return e ?? { colunas, id, ajustada };
}

export function renomearColuna(atuais: readonly ColunaQuadro[], op: { coluna: string; nome?: string; prazo_min?: number | null }): (Mudanca & { id: string; antes: string }) | ErroColuna {
  const id = resolverColuna(atuais, op.coluna);
  if (typeof id !== "string") return id;
  const nome = op.nome === undefined ? undefined : nomeValido(op.nome);
  if (nome !== undefined && typeof nome !== "string") return nome;
  const colunas = atuais.map((c) => ({ ...c }));
  const c = colunas.find((x) => x.id === id)!;
  const antes = c.nome;
  if (nome !== undefined) c.nome = nome;
  // NOD-420: null tira o prazo; ausente não mexe. Pôr prazo onde só a pessoa tira a tarefa não vale (revisão 4 do PR #624).
  if (op.prazo_min === null) delete c.prazoMin;
  else if (op.prazo_min !== undefined) {
    if (exigePessoa(c)) return { erro: `só a pessoa tira a tarefa de "${c.nome}": essa coluna não tem prazo` };
    c.prazoMin = op.prazo_min;
  }
  const e = validarColunas(colunas);
  return e ?? { colunas, id, antes, ajustada: false };
}

/** Só entre colunas do mesmo grupo: fora dele, vai para a posição válida mais próxima (`ajustada`). */
export function moverColuna(atuais: readonly ColunaQuadro[], op: { coluna: string; antes_de?: string; depois_de?: string }): (Mudanca & { id: string }) | ErroColuna {
  const id = resolverColuna(atuais, op.coluna);
  if (typeof id !== "string") return id;
  if (COLUNAS_FIXAS.has(id)) return { erro: `"${atuais.find((c) => c.id === id)!.nome}" não muda de lugar` };
  if ((op.antes_de === undefined) === (op.depois_de === undefined)) return { erro: "diga antes_de ou depois_de (um dos dois)" };
  const ref = resolverColuna(atuais, (op.antes_de ?? op.depois_de)!);
  if (typeof ref !== "string") return ref;
  if (ref === id) return { colunas: atuais.map((c) => ({ ...c })), id, ajustada: false };
  const colunas = atuais.map((c) => ({ ...c }));
  const [col] = colunas.splice(colunas.findIndex((c) => c.id === id), 1);
  const iRef = colunas.findIndex((c) => c.id === ref);
  const alvo = op.antes_de !== undefined ? iRef : iRef + 1;
  const [ini, fim] = faixaMovel(colunas, col!.grupo);
  const pos = Math.min(Math.max(alvo, ini), fim);
  colunas.splice(pos, 0, col!);
  const e = validarColunas(colunas);
  return e ?? { colunas, id, ajustada: pos !== alvo };
}

/**
 * Remove a coluna. Com tarefas, precisa do destino (nenhuma se perde); o destino não pode ser ela nem a espera da pessoa
 * (ADR-162: não é coluna). Mover as tarefas não aciona ninguém (decisão do Gil).
 */
export function removerColuna(atuais: readonly ColunaQuadro[], op: { coluna: string; destino?: string }, tarefas: readonly { status: IdColuna }[]): (Mudanca & { id: string; nome: string; destino: IdColuna | null; movidas: number }) | ErroColuna {
  const id = resolverColuna(atuais, op.coluna);
  if (typeof id !== "string") return id;
  const nome = atuais.find((c) => c.id === id)!.nome;
  if (COLUNAS_FIXAS.has(id)) return { erro: `"${nome}" não sai do quadro (dá para renomear)` };
  const colunas = atuais.filter((c) => c.id !== id).map((c) => ({ ...c }));
  const movidas = tarefas.filter((t) => t.status === id).length;
  let destino: IdColuna | null = null;
  if (op.destino !== undefined) {
    const d = resolverColuna(atuais, op.destino);
    if (typeof d !== "string") return d;
    if (d === id) return { erro: "o destino não pode ser a própria coluna" };
    if (d === ESPERA_PESSOA) return { erro: "\"Precisa de você\" não é coluna: escolha outra" };
    destino = d;
  }
  if (movidas > 0 && destino === null) {
    return { erro: `coluna_com_tarefas: "${nome}" tem ${movidas} ${movidas === 1 ? "tarefa" : "tarefas"}; diga o destino. Destinos: ${listaDeColunas(colunas)}` };
  }
  const e = validarColunas(colunas);
  return e ?? { colunas, id, nome, destino: movidas > 0 ? destino : null, movidas, ajustada: false };
}

/** O destino padrão de quem estava numa coluna que saiu: a primeira do mesmo grupo, senão onde o trabalho espera. */
function destinoPadrao(colunas: readonly ColunaQuadro[], g: GrupoColuna | null): IdColuna {
  if (g === "iniciado") return colunaDeAndamento(colunas) ?? primeiraDo(colunas, "iniciado") ?? colunaDeEspera(colunas);
  if (g === "feito") return primeiraDo(colunas, "feito")!;
  if (g === "fechado") return "cancelado";
  return primeiraDo(colunas, "nao_iniciado") ?? colunaDeEspera(colunas);
}

/**
 * Troca o conjunto inteiro (a conversa: "use estas colunas"). A coluna com id (ou com o mesmo nome e grupo) continua;
 * as que saem levam as tarefas para `destinos` ou para a primeira do mesmo grupo. "Cancelado" entra sozinha se faltar, e a lista fica na ordem dos grupos (`ajustada`).
 */
export function substituirColunas(
  atuais: readonly ColunaQuadro[],
  op: { colunas: readonly { id?: string; nome: string; grupo: GrupoColuna }[]; destinos?: readonly { de: string; para: string }[] },
  tarefas: readonly { id: string; status: IdColuna }[],
): (Mudanca & { movidas: { tarefa: string; de: IdColuna; para: IdColuna }[]; saem: IdColuna[]; entram: IdColuna[] }) | ErroColuna {
  if (!Array.isArray(op.colunas) || op.colunas.length === 0) return { erro: "colunas vazio" };
  if (op.colunas.length > LIMITES_QUADRO.colunas) return { erro: `mais de ${LIMITES_QUADRO.colunas} colunas` };
  const novas: ColunaQuadro[] = [];
  const usados = new Set(atuais.map((c) => c.id));
  const tomados = new Set<string>();
  // ADR-162: "Precisa de você" não é mais coluna; quem ainda a manda (o bot de antes, a lista copiada) não é recusado: ela sai.
  let semEspera = false;
  for (const x of op.colunas) {
    if (x.id === ESPERA_PESSOA || (x.id === undefined && typeof x.nome === "string" && normalizarNome(x.nome) === "precisa de voce")) { semEspera = true; continue; }
    if (!ehGrupo(x.grupo)) return { erro: `coluna "${String(x.nome)}" precisa de grupo: nao_iniciado, iniciado, feito ou fechado` };
    const nome = nomeValido(x.nome);
    if (typeof nome !== "string") return nome;
    let id: string | undefined;
    if (x.id !== undefined) {
      const a = atuais.find((c) => c.id === x.id);
      if (!a) return { erro: `coluna "${x.id}" não existe neste quadro. Colunas: ${listaDeColunas(atuais)}` };
      if (a.grupo !== x.grupo) return { erro: `o grupo de "${a.nome}" não muda` };
      id = a.id;
    } else {
      const a = atuais.find((c) => !tomados.has(c.id) && c.grupo === x.grupo && (normalizarNome(c.nome) === normalizarNome(nome) || (ehReservada(c.id) && c.id === normalizarNome(nome).replace(/\s+/g, ""))));
      id = a?.id ?? idNovo(nome, usados);
    }
    if (tomados.has(id)) return { erro: `coluna repetida: ${nome}` };
    tomados.add(id);
    usados.add(id);
    // A passagem (ADR-142) e o prazo (NOD-420) seguem com a coluna que continua; a que nasce agora vem sem. Revisão 3 do
    // PR #622: a passagem só se a coluna aceita passagem no grupo novo (uma passagem gravada onde não vale não derruba a
    // troca do conjunto). O prazo só fica se ela continua onde o trabalho anda.
    // A trava (NOD-419) é lida à parte e segue sempre: trocar o grupo não a apaga (revisão 2 do PR #629).
    const atual = atuais.find((c) => c.id === id);
    const { responsavel, instrucoes, proxima, volta } = aceitaPassagem({ id, grupo: x.grupo }) ? atual ?? {} : {};
    const trava = atual?.trava;
    const prazoMin = atual?.prazoMin;
    const comPrazo = prazoMin !== undefined && podeTerPrazo({ id, grupo: x.grupo, ...(trava ? { trava } : {}) });
    novas.push({ id, nome, grupo: x.grupo, ...(responsavel ? { responsavel } : {}), ...(instrucoes ? { instrucoes } : {}), ...(proxima ? { proxima } : {}), ...(volta ? { volta } : {}), ...(comPrazo ? { prazoMin } : {}), ...(trava ? { trava } : {}) });
  }
  let ajustada = semEspera;
  for (const fixa of ["cancelado"] as const) {
    if (!tomados.has(fixa)) { novas.push(atuais.find((c) => c.id === fixa) ?? COLUNAS_PADRAO.find((c) => c.id === fixa)!); ajustada = true; }
  }
  // Na ordem dos grupos, e as fixas por último no grupo delas (sort estável).
  const peso = (c: ColunaQuadro) => GRUPOS_COLUNA.indexOf(c.grupo) * 2 + (COLUNAS_FIXAS.has(c.id) ? 1 : 0);
  const ordenadas = [...novas].sort((a, b) => peso(a) - peso(b));
  if (ordenadas.some((c, i) => c !== novas[i])) ajustada = true;
  const e = validarColunas(ordenadas);
  if (e) return e;
  const ficam = new Set(ordenadas.map((c) => c.id));
  const saem = atuais.filter((c) => !ficam.has(c.id)).map((c) => c.id);
  const entram = ordenadas.filter((c) => !atuais.some((a) => a.id === c.id)).map((c) => c.id);
  const para = new Map<IdColuna, IdColuna>();
  for (const d of op.destinos ?? []) {
    const de = resolverColuna(atuais, d.de);
    if (typeof de !== "string") return de;
    const alvo = resolverColuna(ordenadas, d.para);
    if (typeof alvo !== "string") return alvo;
    if (alvo === ESPERA_PESSOA) return { erro: "\"Precisa de você\" não é coluna: escolha outra" };
    para.set(de, alvo);
  }
  const movidas: { tarefa: string; de: IdColuna; para: IdColuna }[] = [];
  for (const t of tarefas) {
    // ADR-162: a que espera a pessoa não está numa coluna e segue esperando (o `voltarPara` que saiu é limpo no lote).
    if (ficam.has(t.status) || t.status === ESPERA_PESSOA) continue;
    const alvo = para.get(t.status) ?? destinoPadrao(ordenadas, grupoDe(atuais, t.status));
    movidas.push({ tarefa: t.id, de: t.status, para: alvo });
  }
  return { colunas: ordenadas, ajustada, movidas, saem, entram };
}

/** Recolhida ao abrir (a NOD-429): Backlog e as de Feito e Fechado nascem numa tira com a contagem. */
export function nasceRecolhida(c: ColunaQuadro): boolean {
  return c.id === "backlog" || c.grupo === "feito" || c.grupo === "fechado";
}

export function colunasDto(colunas: readonly ColunaQuadro[]): ColunaDto[] {
  return colunas.map((c) => ({ ...c, fixa: COLUNAS_FIXAS.has(c.id), daPessoa: !ehReservada(c.id), recolhida: nasceRecolhida(c) }));
}

/** NOD-420: o prazo em palavras ("30 min", "2 h", "1 h 30 min", "3 dias"). */
export function prazoLegivelMin(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return min === 1440 ? "1 dia" : `${min / 1440} dias`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A faixa do prazo em palavras ("de 1 min a 30 dias"): o que a tela e o bot dizem à pessoa (QA do PR #624). */
export const FAIXA_DO_PRAZO = `de 1 min a ${prazoLegivelMin(LIMITES_QUADRO.prazoMin)}`;

/** Iguais às padrão? (a gravação guarda null, e o quadro de antes segue "sem mudança"). */
export function saoPadrao(colunas: readonly ColunaQuadro[]): boolean {
  return colunas.length === COLUNAS_PADRAO.length && colunas.every((c, i) => {
    const p = COLUNAS_PADRAO[i]!;
    return c.id === p.id && c.nome === p.nome && c.grupo === p.grupo && !c.responsavel && !c.instrucoes && !c.proxima && !c.volta && c.prazoMin === undefined && !c.trava;
  });
}

/*
 * Passagem por coluna (definido em 2026-11-02, ADR-142, revê a ADR-140): a coluna pode ter um responsável — o bot que
 * pega a tarefa ao entrar nela e começa na hora — e "o que essa etapa faz". Sem responsável, o de antes continua.
 * Bloqueado e Cancelado são esperas, e Feito/Fechado não andam: nunca têm responsável.
 */
export function aceitaPassagem(c: Pick<ColunaQuadro, "id" | "grupo">): boolean {
  return (c.grupo === "nao_iniciado" || c.grupo === "iniciado") && !COLUNAS_FIXAS.has(c.id) && c.id !== "bloqueado";
}

function erroDaPassagem(c: ColunaQuadro): ErroColuna | null {
  if (c.responsavel != null && (typeof c.responsavel !== "string" || c.responsavel === "")) return { erro: `responsável inválido em "${c.nome}"` };
  if (c.responsavel && !aceitaPassagem(c)) return { erro: `"${c.nome}" não tem responsável: só as colunas onde o trabalho espera ou anda (fora Bloqueado)` };
  if (c.instrucoes != null && (typeof c.instrucoes !== "string" || c.instrucoes.length > LIMITES_QUADRO.instrucoes)) return { erro: `o que a etapa "${c.nome}" faz passa de ${LIMITES_QUADRO.instrucoes} caracteres` };
  // 2026-11-10: as saídas da etapa são ids de coluna (a que saiu depois fica sem efeito: o padrão vale, em proximaColuna).
  for (const s of [c.proxima, c.volta]) if (s != null && (typeof s !== "string" || s === c.id || !ID_COLUNA.test(s))) return { erro: `saída da etapa "${c.nome}" inválida` };
  if ((c.proxima || c.volta) && !aceitaPassagem(c)) return { erro: `"${c.nome}" não tem saídas de etapa: só as colunas onde o trabalho espera ou anda (fora Bloqueado)` };
  return null;
}

/** A trava (NOD-419): `saiPara` é uma lista de ids de coluna; `soPessoa`, booleano. Destino que sumiu não vale (o domínio filtra). */
function erroDaTrava(c: ColunaQuadro): ErroColuna | null {
  const t = c.trava;
  if (t === undefined) return null;
  if (typeof t !== "object" || t === null) return { erro: `trava inválida em "${c.nome}"` };
  if (t.soPessoa !== undefined && typeof t.soPessoa !== "boolean") return { erro: `trava inválida em "${c.nome}"` };
  if (t.saiPara !== undefined && (!Array.isArray(t.saiPara) || t.saiPara.length > LIMITES_QUADRO.colunas || t.saiPara.some((x) => typeof x !== "string" || x === c.id))) return { erro: `trava inválida em "${c.nome}"` };
  return null;
}

/**
 * A passagem aciona nesta coluna? (revisão 2 do PR #622) A fazer e as do andamento, sim: o responsável da coluna começa ao
 * entrar. Nas outras de Não iniciado (Backlog, as da pessoa) a passagem só troca o responsável e a tarefa espera ali. A web
 * espelha esta regra (web/lib/colunas.ts, o teste confere) para só dizer "começa" onde algo começa de verdade (desde
 * 2026-11-10 sem confirmação: entrar já é a passagem).
 */
export function acionaNaColuna(colunas: readonly ColunaQuadro[], id: IdColuna): boolean {
  // Revisão 4: a espera da pessoa (ADR-162) e Bloqueado esperam, como no `andando` do quadro (lá ninguém começa).
  return id === "afazer" || (grupoDe(colunas, id) === "iniciado" && id !== "voce" && id !== "bloqueado");
}

/** Quem pega a tarefa ao entrar na coluna (null = o responsável continua). */
export function responsavelDe(colunas: readonly ColunaQuadro[], id: IdColuna): string | null {
  return colunas.find((c) => c.id === id)?.responsavel ?? null;
}

/** Pode ser a "etapa concluída" de outra coluna: existe e não é espera (Bloqueado, Cancelado). */
const destinoDeProxima = (colunas: readonly ColunaQuadro[], id: IdColuna | null | undefined, de: IdColuna): IdColuna | null =>
  id && id !== de && id !== "bloqueado" && id !== "cancelado" && colunas.some((c) => c.id === id) ? id : null;
/** Pode ser a "precisa de ajustes" de outra coluna: existe, não é espera e ainda anda (Não iniciado ou Andamento). */
const destinoDeVolta = (colunas: readonly ColunaQuadro[], id: IdColuna | null | undefined, de: IdColuna): IdColuna | null => {
  const c = id && id !== de ? colunas.find((x) => x.id === id) : undefined;
  return c && aceitaPassagem(c) ? c.id : null;
};

/**
 * A saída "etapa concluída" (o `terminei`; definido em 2026-11-10, o NextStatus do Multica): a `proxima` configurada na
 * coluna; sem ela (ou se a coluna saiu), a seguinte na ordem, pulando as esperas (Bloqueado, Cancelado).
 */
export function proximaColuna(colunas: readonly ColunaQuadro[], id: IdColuna): IdColuna | null {
  const i = colunas.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const explicita = destinoDeProxima(colunas, colunas[i]!.proxima, id);
  if (explicita) return explicita;
  return colunas.slice(i + 1).find((c) => c.id !== "bloqueado" && c.id !== "cancelado")?.id ?? null;
}

/**
 * A saída "precisa de ajustes" (o `devolver`; definido em 2026-11-10, o BackStatusKey do Multica): a `volta` configurada
 * na coluna; sem ela, a etapa anterior que tem responsável (quem fez o que esta etapa recebeu). null = não há para onde.
 */
export function colunaDeVolta(colunas: readonly ColunaQuadro[], id: IdColuna): IdColuna | null {
  const i = colunas.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const explicita = destinoDeVolta(colunas, colunas[i]!.volta, id);
  if (explicita) return explicita;
  for (let j = i - 1; j >= 0; j--) if (colunas[j]!.responsavel && aceitaPassagem(colunas[j]!)) return colunas[j]!.id;
  return null;
}

/**
 * A etapa em que a tarefa está (definido em 2026-11-10): a própria coluna, se tem responsável ou "o que essa etapa faz".
 * A fazer começa e leva a tarefa ao andamento (ADR-140): na coluna de andamento sem etapa própria, a tarefa do responsável
 * de A fazer segue na etapa A fazer. null = sem etapa (o quadro sem passagem).
 */
export function etapaDaColuna(colunas: readonly ColunaQuadro[], status: IdColuna, agenteId: string | null): IdColuna | null {
  const c = colunas.find((x) => x.id === status);
  if (c && (c.responsavel || c.instrucoes)) return c.id;
  const afazer = colunas.find((x) => x.id === "afazer");
  if (c && status === colunaDeAndamento(colunas) && afazer && (afazer.responsavel ? afazer.responsavel === agenteId : !!afazer.instrucoes)) return "afazer";
  return null;
}

/** "Etapa concluída" da tarefa: a `proxima` da etapa (se configurada); senão a seguinte à coluna em que ela está. */
export function proximaDaEtapa(colunas: readonly ColunaQuadro[], status: IdColuna, agenteId: string | null): IdColuna | null {
  const etapa = etapaDaColuna(colunas, status, agenteId);
  if (etapa && etapa !== status) {
    const explicita = destinoDeProxima(colunas, colunas.find((c) => c.id === etapa)?.proxima, status);
    if (explicita && explicita !== etapa) return explicita;
  }
  return proximaColuna(colunas, status);
}

/**
 * Definido em 2026-11-10 (lição MUL-8231, o `handlerlessSpan` do Multica): numa coluna sem responsável, a tarefa segue com
 * quem está até a próxima etapa que tem responsável (ou até o Feito). O turno diz isso ao bot, senão ele para no meio
 * esperando alguém pegar. null = a coluna tem responsável, ou não há para onde seguir.
 */
export function ateEtapa(colunas: readonly ColunaQuadro[], status: IdColuna, agenteId: string | null): IdColuna | null {
  const c = colunas.find((x) => x.id === status);
  if (!c || c.responsavel) return null;
  const vistos = new Set<IdColuna>([status]);
  for (let id = proximaDaEtapa(colunas, status, agenteId); id && !vistos.has(id); id = proximaColuna(colunas, id)) {
    const x = colunas.find((k) => k.id === id);
    if (!x) return null;
    if (x.responsavel || x.grupo === "feito") return id;
    vistos.add(id);
  }
  return null;
}

/** "Precisa de ajustes" da tarefa: a volta da etapa em que ela está (null = não há para onde devolver). */
export function voltaDaEtapa(colunas: readonly ColunaQuadro[], status: IdColuna, agenteId: string | null): IdColuna | null {
  const etapa = etapaDaColuna(colunas, status, agenteId) ?? status;
  const v = colunaDeVolta(colunas, etapa);
  return v && v !== status ? v : null;
}

/** Liga, troca ou tira a passagem de uma coluna. `responsavel` já é o id do bot (o lote resolve o nome). */
export function definirPassagem(
  atuais: readonly ColunaQuadro[],
  op: { coluna: string; responsavel?: string | null; instrucoes?: string | null; proxima?: string | null; volta?: string | null },
  /** Os ids do Nod (ADR-081: não pega tarefa do quadro), que nunca é responsável de coluna. */
  nods: ReadonlySet<string> = new Set(),
): (Mudanca & { id: string; nome: string }) | ErroColuna {
  if (op.responsavel && nods.has(op.responsavel)) return { erro: "o Nod não pega tarefa do quadro: escolha outro bot" };
  const id = resolverColuna(atuais, op.coluna);
  if (typeof id !== "string") return id;
  // As saídas da etapa (2026-11-10): por id ou nome; null volta ao padrão. A própria coluna e as esperas não valem.
  const saida = (ref: string | null | undefined, tipo: "proxima" | "volta"): string | null | undefined | ErroColuna => {
    if (ref === undefined || ref === null) return ref;
    const alvo = resolverColuna(atuais, ref);
    if (typeof alvo !== "string") return alvo;
    const nomeAlvo = atuais.find((c) => c.id === alvo)?.nome ?? alvo;
    if (tipo === "proxima" ? !destinoDeProxima(atuais, alvo, id) : !destinoDeVolta(atuais, alvo, id)) {
      return { erro: tipo === "proxima" ? `"${nomeAlvo}" não serve de próxima etapa: escolha outra coluna, que não seja esta, Bloqueado ou Cancelado` : `"${nomeAlvo}" não serve de volta: escolha outra coluna onde o trabalho espera ou anda (não esta, Bloqueado, Feito ou Cancelado)` };
    }
    return alvo;
  };
  const proxima = saida(op.proxima, "proxima");
  if (proxima !== null && typeof proxima === "object") return proxima;
  const volta = saida(op.volta, "volta");
  if (volta !== null && typeof volta === "object") return volta;
  const colunas = atuais.map((c) => {
    if (c.id !== id) return { ...c };
    const { responsavel: r0, instrucoes: i0, proxima: p0, volta: v0, ...base } = c;
    const responsavel = op.responsavel === undefined ? r0 ?? null : op.responsavel;
    const instr = op.instrucoes === undefined ? i0 ?? null : op.instrucoes?.trim() || null;
    const prox = proxima === undefined ? p0 ?? null : proxima;
    const vol = volta === undefined ? v0 ?? null : volta;
    return { ...base, ...(responsavel ? { responsavel } : {}), ...(instr ? { instrucoes: instr } : {}), ...(prox ? { proxima: prox } : {}), ...(vol ? { volta: vol } : {}) };
  });
  const alvo = colunas.find((c) => c.id === id)!;
  const e = erroDaPassagem(alvo);
  if (e) return e;
  return { colunas, ajustada: false, id, nome: alvo.nome };
}
