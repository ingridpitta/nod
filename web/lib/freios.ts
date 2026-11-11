/**
 * NOD-419 (definido em 2026-11-02, ADR-142 emenda): o que a tela precisa dos freios da esteira, sem DOM. O servidor
 * confere tudo de novo (src/domain/freios-quadro.ts); aqui é para a tela não deixar a pessoa soltar onde vai ser
 * recusado, dizer o porquê na hora, e mostrar o eco e o histórico. A web só importa tipos de src/ (ADR-018):
 * tests/unit/web/freios.test.ts confere os espelhos contra o domínio.
 */
import type { MovimentoDto, TravaColuna } from "../../src/contracts/freios-quadro.ts";
import type { ColunaDto, TarefaDto } from "../../src/contracts/quadro.ts";

/** Quanto tempo o eco do agente ("Ada terminou · Desfazer") fica na linha 1 do card. */
export const ECO_DO_AGENTE_MS = 10 * 60_000;

/** Espelho de ESPERA (src/domain/freios-quadro.ts): pedir ajuda nunca fica travado. */
const ESPERA: ReadonlySet<string> = new Set(["voce", "bloqueado"]);

/** ADR-162: `voce` não é coluna; o movimento para a espera da pessoa diz "Esperando você" (espelho de NOME_DA_ESPERA). */
export const nomeDe = (cs: readonly { id: string; nome: string }[], id: string): string => cs.find((c) => c.id === id)?.nome ?? (id === "voce" ? "Esperando você" : id);

/** Espelho de temTrava. */
export function temTrava(t: TravaColuna | undefined): boolean {
  return !!t && (t.soPessoa === true || (t.saiPara?.length ?? 0) > 0);
}

/** Espelho de fraseDaTrava: o cadeado do cabeçalho leva esta frase no title. */
export function fraseDaTrava(cs: readonly { id: string; nome: string }[], t: TravaColuna | undefined): string | null {
  if (!temTrava(t)) return null;
  return [t!.saiPara?.length ? `só sai para ${t!.saiPara.map((id) => nomeDe(cs, id)).join(" ou ")}` : "", t!.soPessoa ? "só a pessoa tira daqui" : ""].filter(Boolean).join(" · ");
}

/**
 * A pessoa solta a tarefa de `deAgora` em `para`: a trava recusa? (o "só a pessoa" não vale para ela). null = pode; senão
 * a frase da recusa e a coluna para onde ela pode mandar (o "Mandar para…" do aviso). Espelho de origemDaTrava: a tarefa
 * que espera leva a trava da coluna de onde foi esperar (`voltarPara`, revisão do PR #629).
 */
export function recusaDaTrava(cs: readonly ColunaDto[], deAgora: string, para: string, voltarPara: string | null = null): { texto: string; destino: ColunaDto } | null {
  const de = ESPERA.has(deAgora) && voltarPara ? voltarPara : deAgora;
  if (de === para || ESPERA.has(para)) return null;
  const c = cs.find((x) => x.id === de);
  const destinos = (c?.trava?.saiPara ?? []).map((id) => cs.find((x) => x.id === id)).filter((x): x is ColunaDto => !!x);
  if (!c || destinos.length === 0 || destinos.some((x) => x.id === para)) return null;
  return { texto: `De ${c.nome} só sai para ${destinos.map((x) => x.nome).join(" ou ")}`, destino: destinos[0]! };
}

/** Quanto a recusa da trava fica no card, contado só enquanto a pessoa não está nele. */
export const RECUSA_MS = 8000;

export interface RelogioDaRecusa {
  /** A pessoa está no card (o foco ou o ponteiro): a conta para. */
  segurar(por: "foco" | "ponteiro"): void;
  /** Saiu (do foco ou do ponteiro): sem nada segurando, a conta recomeça inteira. */
  soltar(por: "foco" | "ponteiro"): void;
  parar(): void;
}

/**
 * O relógio da recusa no card (revisão 2 do PR #629, a11y): some sozinha, mas não com a pessoa lendo ou no "Mandar
 * para…" (WCAG 2.2.1): o foco ou o ponteiro no card seguram a conta, e sair dela a recomeça do zero.
 */
export function relogioDaRecusa(ms: number, expirar: () => void, ocupado: () => boolean = () => false): RelogioDaRecusa {
  const segurando = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let vivo = true;
  const parar = (): void => { if (timer) clearTimeout(timer); timer = null; };
  // Na hora de sumir, confere de novo (o foco que chegou sem o evento, como na janela sem foco do sistema): ocupado, conta outra vez.
  const contar = (): void => { parar(); timer = setTimeout(() => { timer = null; if (ocupado()) { contar(); return; } vivo = false; expirar(); }, ms); };
  contar();
  return {
    segurar(por) { if (!vivo) return; segurando.add(por); parar(); },
    soltar(por) { if (!vivo || !segurando.delete(por) || segurando.size) return; contar(); },
    parar() { vivo = false; parar(); },
  };
}

/**
 * O que a tela faz quando a pessoa solta a tarefa numa coluna (o arrasto ou o "Mover para…"): a trava recusa no próprio
 * card, com o "Mandar para…"; o resto move direto (2026-11-10: entrar na coluna com responsável já é a passagem).
 */
export type Soltura = { tipo: "recusa"; texto: string; destino: ColunaDto } | { tipo: "mover" };

export function decidirSoltura(cs: readonly ColunaDto[], t: Pick<TarefaDto, "status" | "voltarPara"> | undefined, para: ColunaDto): Soltura {
  const r = t ? recusaDaTrava(cs, t.status, para.id, t.voltarPara) : null;
  if (r) return { tipo: "recusa", ...r };
  return { tipo: "mover" };
}

/** Espelho de mudouATarefa. */
const mudou = (m: MovimentoDto): boolean => m.tipo !== "acionou" && (m.de !== m.para || m.agenteAntes !== m.agenteDepois);

/**
 * Espelho de ultimoDesfazivel: o movimento mais recente que mudou a tarefa e não foi desfeito. A tela recebe os
 * movimentos do mais novo para o mais antigo.
 */
export function ultimoDesfazivel(ms: readonly MovimentoDto[] | undefined): MovimentoDto | null {
  return (ms ?? []).find((m) => m.desfeitoEm === null && mudou(m)) ?? null;
}

/**
 * Espelho de desfazerMovimento (as recusas): por que este movimento não se desfaz agora. null = desfaz. Só o mais recente
 * que ainda vale (revisão do PR #629), e só no último estado: se a tarefa mudou depois, a pessoa move à mão.
 */
export function porqueNaoDesfaz(t: Pick<TarefaDto, "status" | "agenteId" | "movimentos">, m: MovimentoDto, cs: readonly { id: string }[]): string | null {
  if (m.desfeitoEm !== null) return "Já desfeito";
  if (!mudou(m)) return "Não mudou a tarefa de lugar nem de mão";
  if (ultimoDesfazivel(t.movimentos ?? [m])?.id !== m.id) return "Só o último movimento se desfaz";
  if (t.status !== m.para || t.agenteId !== m.agenteDepois) return "A tarefa mudou depois: mova à mão";
  if (!cs.some((c) => c.id === m.de)) return "A coluna de antes não existe mais: mova à mão";
  return null;
}

const quem = (m: MovimentoDto): string => (m.autor.tipo === "agente" ? m.autorNome ?? "Um agente" : m.autor.tipo === "pessoa" ? "Você" : "O quadro");

/** Uma linha do histórico: "Ada · Fazendo → Em revisão" (com o motivo da recusa, do laço e do freio). */
export function fraseDoMovimento(m: MovimentoDto, cs: readonly { id: string; nome: string }[]): string {
  const rota = m.de === m.para ? nomeDe(cs, m.para) : `${nomeDe(cs, m.de)} → ${nomeDe(cs, m.para)}`;
  // Revisão 3 do PR #629: o `acionou` diz quem foi acionado; sem lote, foi o comentário (ou o pedir_a_bot com a tarefa).
  if (m.tipo === "acionou") return [quem(m), `acionou ${m.agenteDepoisNome ?? "o responsável"}${m.loteId === null ? " pelo comentário" : ""}`, rota].join(" · ");
  const mao = m.agenteAntes !== m.agenteDepois && m.de === m.para ? ` · agora com ${m.agenteDepoisNome ?? "ninguém"}` : "";
  const tipo = m.tipo === "nao_e_comigo" ? "não é comigo" : m.tipo === "laco" ? "laço" : m.tipo === "freio" ? "freio" : m.tipo === "desfazer" ? "desfez" : "";
  return [quem(m), tipo, `${rota}${mao}`, m.motivo ?? ""].filter(Boolean).join(" · ");
}

/**
 * "Terminou" só quando quem estava com a tarefa a passou para a frente: a coluna de destino vem depois da de origem e
 * não é de espera (QA do PR #629: ir para Bloqueado com pergunta, ou a devolução Testar → Fazendo, diziam "terminou").
 */
function terminou(m: MovimentoDto, cs: readonly { id: string }[]): boolean {
  if (m.autor.tipo !== "agente" || m.agenteAntes !== m.autor.agenteId || m.de === m.para) return false;
  if (m.para === "voce" || m.para === "bloqueado") return false;
  const de = cs.findIndex((c) => c.id === m.de);
  const para = cs.findIndex((c) => c.id === m.para);
  return de >= 0 && para > de;
}

/**
 * O eco do agente na linha 1 do card (decisão da PM: o agente move e passa direto, com Desfazer): o último movimento
 * da tarefa, se foi de um agente, é recente e ainda se desfaz. "Ada terminou" quando quem estava com a tarefa a passou
 * adiante (`terminou`); "Movido por Ada" nos outros casos.
 */
export function ecoDoAgente(t: TarefaDto, cs: readonly { id: string }[], agora: number): { texto: string; movimento: string } | null {
  // O último que se desfaz (um "acionou" do comentário por cima não apaga o eco).
  const m = ultimoDesfazivel(t.movimentos);
  if (!m || m.autor.tipo !== "agente" || agora - m.criadoEm > ECO_DO_AGENTE_MS) return null;
  if (m.tipo !== "mover" && m.tipo !== "nao_e_comigo") return null;
  if (porqueNaoDesfaz(t, m, cs)) return null;
  const nome = m.autorNome ?? "Um agente";
  const texto = m.tipo === "nao_e_comigo" ? `${nome}: não é comigo` : terminou(m, cs) ? `${nome} terminou` : `Movido por ${nome}`;
  return { texto, movimento: m.id };
}
