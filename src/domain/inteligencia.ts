import { ESFORCOS_AGENTE, type Agente, type EsforcoAgente } from "../contracts/agente.ts";
import { HARNESS_LEGADO, HARNESSES, type IdHarness, type PreferenciaHarness } from "../contracts/harness.ts";
import { MODOS_INTELIGENCIA, RACIOCINIOS, type EscolhaDaIa, type EscolhasIa, type IaDaPessoa, type IasDaPessoa, type InteligenciaBot, type LimiteDaIa, type LimitesIa } from "../contracts/inteligencia.ts";
import { CAUSA_LIMITE, type Inventario } from "../contracts/inventario.ts";
import { ErroDeDominio } from "./erro.ts";
import { iaAceitaModelo, iaDoModelo } from "./ia-do-modelo.ts";

/**
 * A inteligência de cada bot (definido em 2026-10-10, emenda da ADR-036; plano "IAs: conexão, troca e escolha de
 * modelo", PR 2). Puro: `agora` por parâmetro. Quem decide a IA do turno é `resolverHarness` (domain/harness.ts), com a
 * ordem e os limites que vêm daqui; a fila usa `iasParaOAutomatico`; o limite usa `proximaIaNoLimite` e `prazoDoLimite`.
 */

/** definido em 2026-10-10 (decisão do Marlon): o raciocínio do "Recomendado" nas duas IAs. */
export const RACIOCINIO_RECOMENDADO: EsforcoAgente = "medium";
/**
 * definido em 2026-10-10: o Codex diz "usage limit" sem horário (nenhuma amostra com hora até aqui) e o Claude Code pode
 * não mandar o `rate_limit`: a IA sai da ordem por 1 h e depois volta a ser tentada. Um turno que dá certo nela antes
 * disso a tira do limite na hora (assentar-turno.ts).
 */
export const PRAZO_LIMITE_SEM_HORARIO_MS = 60 * 60_000;
/** O prazo que o fornecedor diz só vale até 8 dias à frente (a janela semanal do Claude é de 7). */
export const PRAZO_LIMITE_MAXIMO_MS = 8 * 24 * 60 * 60_000;

const INTEGRADAS: readonly IdHarness[] = HARNESSES.filter((h) => h.integrado).map((h) => h.id);
/**
 * definido em 2026-10-10: Claude primeiro, depois o Codex — a ordem de quem nunca arrastou, que é a do catálogo
 * (HARNESSES; NOD-207: lida dele, sem repetir os ids).
 */
export const ORDEM_IAS_PADRAO: readonly IdHarness[] = INTEGRADAS;
const ehIntegrada = (v: unknown): v is IdHarness => typeof v === "string" && (INTEGRADAS as readonly string[]).includes(v);

/** O "Recomendado" da IA (Opus / GPT-5.6 Sol, raciocínio médio); null para IA sem catálogo. */
export function recomendadoDa(ia: IdHarness): { modelo: string; raciocinio: EsforcoAgente } | null {
  const h = HARNESSES.find((x) => x.id === ia);
  return h && "recomendado" in h ? h.recomendado : null;
}

/** A ordem inteira: só IAs integradas, sem repetição, e as que faltam no fim, na ordem do catálogo. */
export function ordemCompleta(ordem: readonly unknown[] | null | undefined): IdHarness[] {
  const vistas: IdHarness[] = [];
  for (const id of ordem ?? []) if (ehIntegrada(id) && !vistas.includes(id)) vistas.push(id);
  return [...vistas, ...INTEGRADAS.filter((id) => !vistas.includes(id))];
}

/**
 * A ordem que vale para o bot: a dele, senão a da pessoa, senão a padrão. `preferido` (o harness padrão do interruptor no
 * modo local) só entra quando nenhuma das duas foi escolhida: no Mac com o servidor local continua valendo o de antes.
 */
export function ordemEfetiva(p: { doBot?: readonly IdHarness[] | null; daPessoa?: readonly IdHarness[] | null; preferido?: IdHarness | null }): IdHarness[] {
  if (p.doBot) return ordemCompleta(p.doBot);
  if (p.daPessoa) return ordemCompleta(p.daPessoa);
  return ordemCompleta(p.preferido ? [p.preferido, ...ORDEM_IAS_PADRAO] : ORDEM_IAS_PADRAO);
}

/** As IAs com o limite em vigor agora (o prazo vencido não conta: a IA volta a ser tentada). */
export function iasNoLimite(limites: LimitesIa | null | undefined, agora: number): IdHarness[] {
  return (Object.entries(limites ?? {}) as [IdHarness, { renovaEm: number } | undefined][]).filter(([, l]) => l !== undefined && l.renovaEm > agora).map(([id]) => id);
}

/**
 * A IA do Automático: a primeira PRONTA da ordem que não esteja no limite. Com todas as prontas no limite, a primeira
 * pronta: o prazo é uma estimativa (no Codex, 1 h sem horário), e o próprio CLI diz se o limite continua — o turno não
 * fica preso. Pronta fora da ordem (IA nova) entra no fim. null = nenhuma pronta.
 */
export function iaDoAutomatico(p: { ordem: readonly IdHarness[]; prontos: readonly IdHarness[]; noLimite?: readonly IdHarness[] }): IdHarness | null {
  const candidatas = [...p.ordem, ...p.prontos.filter((id) => !p.ordem.includes(id))].filter((id) => p.prontos.includes(id));
  return candidatas.find((id) => !(p.noLimite ?? []).includes(id)) ?? candidatas[0] ?? null;
}

/**
 * Para a fila (despacho): as IAs desta máquina que podem pegar um turno do Automático. A IA no limite fica de fora
 * enquanto a pessoa tiver outra pronta fora do limite em alguma máquina viva; sem nenhuma, vale a regra de
 * `iaDoAutomatico` (todas as prontas). Assim o turno repetido no limite não volta para a máquina que só tem a IA parada.
 */
export function iasParaOAutomatico(p: { prontosMaquina: readonly string[]; prontosPessoa: readonly string[]; noLimite: readonly string[] }): string[] {
  const foraDaPessoa = p.prontosPessoa.filter((id) => !p.noLimite.includes(id));
  if (foraDaPessoa.length === 0) return [...p.prontosMaquina];
  return p.prontosMaquina.filter((id) => !p.noLimite.includes(id));
}

/** No limite: a próxima IA da ordem, pronta e fora do limite, que não seja a que parou. null = não há para onde ir. */
export function proximaIaNoLimite(p: { ordem: readonly IdHarness[]; prontos: readonly IdHarness[]; noLimite: readonly IdHarness[]; atual: IdHarness }): IdHarness | null {
  return [...p.ordem, ...p.prontos.filter((id) => !p.ordem.includes(id))].find((id) => id !== p.atual && p.prontos.includes(id) && !p.noLimite.includes(id)) ?? null;
}

/**
 * definido em 2026-10-15 (NOD-268, decisão da PM; o Marlon pode vetar): uma fala da pessoa é reenviada sozinha no máximo
 * UMA vez — troca de IA no limite, troca de conta, conta ausente, conta sem acesso. Passou do teto, o turno espera a hora
 * em que o limite sai (`acordar_em`) com uma linha só na conversa, em vez de girar de máquina em máquina.
 */
export const TETO_REENVIOS = 1;

export function podeReenviar(turno: { reenvios: number }): boolean {
  return turno.reenvios < TETO_REENVIOS;
}

/**
 * NOD-268: o Automático com TODAS as IAs prontas na máquina no limite não roda a primeira (antes, iaDoAutomatico): a fala
 * espera a renovação mais próxima. Devolve essa hora; null = há IA fora do limite (ou nenhuma pronta: o despacho recusa
 * como antes). `iaDoAutomatico` continua com o fallback: é o que a tela usa para mostrar o plano.
 */
export function esperaDoAutomatico(p: { prontos: readonly string[]; limites: LimitesIa | null | undefined; agora: number }): number | null {
  if (p.prontos.length === 0) return null;
  let menor: number | null = null;
  for (const ia of p.prontos) {
    const l = p.limites?.[ia as IdHarness];
    if (!l || l.renovaEm <= p.agora) return null;
    menor = menor === null ? l.renovaEm : Math.min(menor, l.renovaEm);
  }
  return menor;
}

/** NOD-268: o alarme (não é freio) — mais de 3 turnos da mesma fala em menos de 5 min. */
export const LACO_TURNOS = 3;
export const LACO_JANELA_MS = 5 * 60_000;

export function reenvioEmLaco(criadosEm: readonly number[], agora: number): boolean {
  return criadosEm.filter((t) => agora - t < LACO_JANELA_MS).length > LACO_TURNOS;
}

/** Até quando a IA fica no limite: o que o fornecedor disse (no futuro, até 8 dias), senão 1 h. */
export function prazoDoLimite(voltaEm: number | null | undefined, agora: number): number {
  return typeof voltaEm === "number" && Number.isFinite(voltaEm) && voltaEm > agora && voltaEm <= agora + PRAZO_LIMITE_MAXIMO_MS ? voltaEm : agora + PRAZO_LIMITE_SEM_HORARIO_MS;
}

/**
 * NOD-280 (definido em 2026-10-15): até quando a CONTA fica no limite. O fornecedor disse uma hora no futuro: ela, mas nunca
 * além de 8 dias (a janela semanal do Claude é de 7; antes, a ponte aceitava 31 dias e a conta ficava presa um mês sem
 * botão). Sem hora (ou no passado): 1 h. Diferente de `prazoDoLimite` (da IA), a hora longa demais é cortada no teto, não
 * trocada por 1 h — o fornecedor disse que demora.
 */
export function prazoDoLimiteDaConta(ate: number | null | undefined, agora: number): number {
  if (typeof ate !== "number" || !Number.isFinite(ate) || ate <= agora) return agora + PRAZO_LIMITE_SEM_HORARIO_MS;
  return Math.min(ate, agora + PRAZO_LIMITE_MAXIMO_MS);
}

/** Os níveis que o modelo aceita (catálogo). Modelo fora do catálogo (um `claude-…` pelo id, o `fable`) = todos. */
export function raciociniosDoModelo(ia: IdHarness, modelo: string): readonly EsforcoAgente[] {
  const h = HARNESSES.find((x) => x.id === ia);
  if (!h || !h.integrado) return [];
  const m = h.modelos.find((x) => x.id === modelo);
  return m && "raciocinios" in m ? m.raciocinios : ESFORCOS_AGENTE;
}

/** O raciocínio que vai ao CLI: o pedido, se o modelo aceita; senão o médio; senão o mais alto que o modelo aceita. */
export function raciocinioValido(ia: IdHarness, modelo: string, pedido?: EsforcoAgente | null): EsforcoAgente | undefined {
  const niveis = raciociniosDoModelo(ia, modelo);
  if (niveis.length === 0) return undefined;
  const r = pedido ?? RACIOCINIO_RECOMENDADO;
  return niveis.includes(r) ? r : niveis.includes(RACIOCINIO_RECOMENDADO) ? RACIOCINIO_RECOMENDADO : niveis.at(-1);
}

/**
 * O modelo e o raciocínio desta IA para o bot. `modeloDoTurno` diferente de "auto" vence (o modelo do bot fixo, gravado
 * no turno quando ele nasceu); "auto" = a escolha do bot para a IA, senão o recomendado.
 */
export function modeloERaciocinio(ia: IdHarness, escolhas: EscolhasIa | undefined, modeloDoTurno = "auto"): { modelo: string; raciocinio?: EsforcoAgente } {
  const escolha = escolhas?.[ia];
  const recomendado = recomendadoDa(ia);
  const modelo = modeloDoTurno !== "auto" ? modeloDoTurno : escolha?.modelo ?? recomendado?.modelo ?? "auto";
  const raciocinio = raciocinioValido(ia, modelo, escolha?.raciocinio);
  return { modelo, ...(raciocinio ? { raciocinio } : {}) };
}

// ── O agente: a inteligência gravada e os campos derivados (harness/modelo/esforco) ────────────────────────────────

export const INTELIGENCIA_PADRAO: InteligenciaBot = { modo: "auto", fixa: null, ordem: null, escolhas: {} };

/** O que o repositório grava em harness/modelo/esforco: é o que o turno copia e o que o código anterior lê. */
export function derivadosDa(i: InteligenciaBot): { harness: PreferenciaHarness; modelo: string; esforco: EsforcoAgente | null } {
  const esforco = i.escolhas[HARNESS_LEGADO]?.raciocinio ?? null;
  if (i.modo === "auto" || !i.fixa) return { harness: "auto", modelo: "auto", esforco };
  return { harness: i.fixa, modelo: i.escolhas[i.fixa]?.modelo ?? "auto", esforco };
}

function comEscolha(escolhas: EscolhasIa, ia: IdHarness, muda: (e: EscolhaDaIa) => EscolhaDaIa): EscolhasIa {
  const nova = muda({ ...escolhas[ia] });
  const limpa: EscolhaDaIa = { ...(nova.modelo ? { modelo: nova.modelo } : {}), ...(nova.raciocinio ? { raciocinio: nova.raciocinio } : {}) };
  const resto = { ...escolhas };
  delete resto[ia];
  return Object.keys(limpa).length > 0 ? { ...resto, [ia]: limpa } : resto;
}

function semModelos(escolhas: EscolhasIa): EscolhasIa {
  let r = escolhas;
  for (const ia of Object.keys(escolhas) as IdHarness[]) r = comEscolha(r, ia, (e) => ({ ...e, modelo: undefined }));
  return r;
}

/** O modelo é aceito pela IA (o catálogo, ou um `claude-…` pelo id no Claude)? Mesma regra de `validarInteligencia`. */
function modeloAceito(ia: IdHarness, modelo: string): boolean {
  if (modelo.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(modelo)) return false;
  return iaAceitaModelo(ia, modelo);
}

/**
 * O pedido antigo `{harness, modelo, esforco}` (a tela de Inteligência de antes, `gerir_bots`, a criação) traduzido.
 * `auto/auto` = Automático sem modelo escolhido (a ordem e os raciocínios ficam); `auto` com um modelo = a IA dona do modelo
 * fixa nele (NOD-213, iaDoModelo, como o `harnessFixado`: GPT → Codex; Claude ou desconhecido → Claude); uma IA = "Uma IA só", com o modelo (ou o recomendado, para `auto`). O esforço era só do
 * Claude na tela antiga: vira o raciocínio do Claude. Quem valida a dupla é quem chama (`validarInteligencia`).
 */
export function inteligenciaDoLegado(atual: InteligenciaBot, p: { harness: PreferenciaHarness; modelo: string; esforco?: EsforcoAgente | null }): InteligenciaBot {
  let i: InteligenciaBot;
  // "Automático" na tela antiga era "nenhum modelo escolhido": os modelos saem; os raciocínios e a ordem ficam.
  if (p.harness === "auto" && p.modelo === "auto") i = { ...atual, modo: "auto", fixa: null, escolhas: semModelos(atual.escolhas) };
  else {
    const fixa: IdHarness = p.harness === "auto" ? (iaDoModelo(p.modelo) ?? HARNESS_LEGADO) : p.harness;
    i = { ...atual, modo: "fixa", fixa, escolhas: comEscolha(atual.escolhas, fixa, (e) => ({ ...e, modelo: p.modelo === "auto" ? undefined : p.modelo })) };
  }
  if (p.esforco !== undefined) i = { ...i, escolhas: comEscolha(i.escolhas, HARNESS_LEGADO, (e) => ({ ...e, raciocinio: p.esforco ?? undefined })) };
  return i;
}

/**
 * A inteligência que vale para o agente. A gravada (0068), conferida contra `harness`/`modelo`: são eles que o turno
 * copia, e só um caminho anterior a esta mudança (um rollback do código) os grava sem ela — então eles mandam. Sem a
 * gravada (fixture, plano antigo), vem toda dos campos antigos.
 */
export function inteligenciaDoAgente(a: Pick<Agente, "harness" | "modelo" | "esforco" | "inteligencia">): InteligenciaBot {
  const harness = a.harness ?? "auto";
  const base = a.inteligencia ?? INTELIGENCIA_PADRAO;
  const d = derivadosDa(base);
  if (a.inteligencia && d.harness === harness && d.modelo === a.modelo) return a.inteligencia;
  return inteligenciaDoLegado(base, { harness, modelo: a.modelo, ...(a.inteligencia ? {} : { esforco: a.esforco ?? null }) });
}

function invalida(campo: string): never {
  throw new ErroDeDominio("entrada_invalida", { cause: campo });
}

function lerOrdem(v: unknown): IdHarness[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > 8 || !v.every(ehIntegrada) || new Set(v).size !== v.length) invalida("ordem");
  return ordemCompleta(v);
}

/** As escolhas por IA vindas da tela: só IAs integradas, modelo do catálogo e raciocínio que o modelo aceita. */
export function lerEscolhas(v: unknown): EscolhasIa {
  if (typeof v !== "object" || v === null || Array.isArray(v)) invalida("escolhas");
  const escolhas: EscolhasIa = {};
  for (const [ia, bruta] of Object.entries(v as Record<string, unknown>)) {
    if (!ehIntegrada(ia) || typeof bruta !== "object" || bruta === null || Array.isArray(bruta)) invalida("escolhas");
    const e = bruta as Record<string, unknown>;
    if (Object.keys(e).some((k) => k !== "modelo" && k !== "raciocinio")) invalida("escolhas");
    const modelo = e.modelo === undefined || e.modelo === null || e.modelo === "auto" ? undefined : e.modelo;
    if (modelo !== undefined && (typeof modelo !== "string" || !modeloAceito(ia, modelo))) invalida("modelo");
    const raciocinio = e.raciocinio === undefined || e.raciocinio === null ? undefined : ESFORCOS_AGENTE.find((x) => x === e.raciocinio);
    if (e.raciocinio !== undefined && e.raciocinio !== null && !raciocinio) invalida("raciocinio");
    const efetivo = modelo ?? recomendadoDa(ia)?.modelo ?? "auto";
    if (raciocinio && !raciociniosDoModelo(ia, efetivo).includes(raciocinio)) invalida("raciocinio");
    escolhas[ia] = { ...(modelo ? { modelo } : {}), ...(raciocinio ? { raciocinio } : {}) };
    if (Object.keys(escolhas[ia]!).length === 0) delete escolhas[ia];
  }
  return escolhas;
}

/**
 * O pedido da tela nova (`PUT /agentes/:id/inteligencia`) aplicado sobre a atual: campo ausente não muda. `fixa` vale
 * no modo "Uma IA só" (sem ela, a primeira da ordem); no Automático ela é guardada como null.
 */
export function aplicarPedidoInteligencia(atual: InteligenciaBot, pedido: unknown): InteligenciaBot {
  if (typeof pedido !== "object" || pedido === null || Array.isArray(pedido)) invalida("corpo");
  const p = pedido as Record<string, unknown>;
  if (Object.keys(p).some((k) => !["modo", "fixa", "ordem", "escolhas"].includes(k))) invalida("corpo");
  const modo = p.modo === undefined ? atual.modo : MODOS_INTELIGENCIA.find((m) => m === p.modo) ?? invalida("modo");
  const ordem = p.ordem === undefined ? atual.ordem : lerOrdem(p.ordem);
  const escolhas = p.escolhas === undefined ? atual.escolhas : lerEscolhas(p.escolhas);
  if (p.fixa !== undefined && p.fixa !== null && !ehIntegrada(p.fixa)) invalida("fixa");
  const pedida = p.fixa === undefined ? atual.fixa : (p.fixa as IdHarness | null);
  const fixa = modo === "fixa" ? pedida ?? ordemEfetiva({ doBot: ordem })[0] ?? null : null;
  return { modo, fixa, ordem, escolhas };
}

/** A ordem da pessoa vinda da tela (`PUT /preferencias`): lista completa de IAs integradas, ou null (a padrão). */
export function lerOrdemDaPessoa(v: unknown): IdHarness[] | null {
  return lerOrdem(v);
}

/**
 * O inventário que a tela mostra: o anunciado pelo Mac, com o limite em vigor por cima. Só a IA pronta vira "no limite":
 * a que nem está pronta mostra o problema de base (instalar, entrar), que é o que a pessoa resolve primeiro.
 */
export function inventarioComLimite(inv: Inventario, limite: LimiteDaIa | undefined, agora: number, nome: string): Inventario {
  if (inv.estado !== "pronto" || !limite || limite.renovaEm <= agora) return inv;
  return { estado: "nao_autenticado", causa: CAUSA_LIMITE, renovaEm: limite.renovaEm, motivo: `${nome} chegou ao limite da assinatura.`, versao: inv.versao, em: inv.em };
}

/** `GET /ias`: a ordem da pessoa e cada IA na ordem, com o inventário, o limite em vigor e os modelos. */
export function iasDaPessoa(p: { ordem: IdHarness[] | null; limites: LimitesIa; inventarios: Partial<Record<IdHarness, Inventario>>; agora: number; semSonda: (ia: IdHarness) => Inventario }): IasDaPessoa {
  const ordem = ordemEfetiva({ daPessoa: p.ordem });
  const porId = new Map(HARNESSES.map((h) => [h.id as IdHarness, h]));
  const ids: IdHarness[] = [...ordem, ...HARNESSES.map((h) => h.id).filter((id) => !ordem.includes(id))];
  const ias: IaDaPessoa[] = ids.map((id) => {
    const h = porId.get(id)!;
    const limite = p.limites[id];
    const emVigor = limite && limite.renovaEm > p.agora ? limite : null;
    const recomendado = recomendadoDa(id);
    return {
      id,
      nome: h.nome,
      integrado: h.integrado,
      inventario: inventarioComLimite(p.inventarios[id] ?? p.semSonda(id), emVigor ?? undefined, p.agora, h.nome),
      limite: emVigor,
      recomendado,
      modelos: h.modelos.map((m) => ({ ...m, recomendado: m.id === recomendado?.modelo })),
    };
  });
  return { ordem, ordemPadrao: p.ordem === null, ias, raciocinios: RACIOCINIOS };
}
