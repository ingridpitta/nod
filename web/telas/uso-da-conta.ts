import type { ContaIa, CotaDaContaDto } from "../../src/contracts/contas-ia.ts";
import type { JanelaDoPlano } from "../../src/contracts/uso-do-plano.ts";
import { esc, hora } from "../lib/render.ts";
import { PROVEDOR } from "./cartao-ia.ts";

/**
 * NOD-12 (definido em 2026-10-22, protótipo do Gil no PR #414, ADR-036 emendada): o uso do plano de cada conta em Seu
 * espaço › Provedores de IA. Duas barras, 5 h e Semana, com o "% usado" (a mesma leitura do anel do seletor e do `/usage`
 * do CLI) e quando renova; embaixo, há quanto tempo foi medido e, perto do limite, o que acontece quando chegar lá.
 * Faixas visuais: < 80% neutra, 80–89% número escuro sem cor, ≥ 90% âmbar, 100% âmbar com "no limite". Nunca vermelho
 * (esgotar é aviso, não erro). Puro: só lê a conta, a lista (a fila) e o relógio.
 */

/** A partir daqui o número fica escuro, sem cor (= `LIMIAR_PERTO` do domínio; o teste de conformidade confere). */
export const PERTO_USO = 0.8;
/** A partir daqui a barra, o anel e o número ficam âmbar (= `LIMIAR_ALERTA` do domínio; um limiar visual só). */
export const ALERTA_USO = 0.9;
/** Leitura mais velha que isto "pode ter mudado". */
export const LEITURA_VELHA_MS = 6 * 3_600_000;

export type FaixaDaJanela = "normal" | "perto" | "alerta" | "limite";

export function faixaDaJanela(utilizacao: number): FaixaDaJanela {
  return utilizacao >= 1 ? "limite" : utilizacao >= ALERTA_USO ? "alerta" : utilizacao >= PERTO_USO ? "perto" : "normal";
}

/** O percentual na tela: 0,995 é 99% (só o limite atingido é 100%); nunca negativo nem acima de 100. */
export function pctUsado(utilizacao: number): number {
  return utilizacao >= 1 ? 100 : Math.max(0, Math.min(99, Math.floor(utilizacao * 100)));
}

const mesmoDia = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const diaMes = (t: number) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };

/** "18:40" no mesmo dia; "26/10 às 09:00" noutro. */
export function quandoNaTela(t: number, agora: number): string {
  return mesmoDia(t, agora) ? hora(t) : `${diaMes(t)} às ${hora(t)}`;
}

/** "às 18:40" no mesmo dia; "em 26/10 às 09:00" noutro. */
function quandoRenova(t: number, agora: number): string {
  return mesmoDia(t, agora) ? `às ${hora(t)}` : `em ${diaMes(t)} às ${hora(t)}`;
}

/** "agora há pouco", "há 12 min", "há 7 h", "há 2 dias". */
function ha(desde: number, agora: number): string {
  const min = Math.max(0, Math.floor((agora - desde) / 60_000));
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.floor(h / 24)} dias`;
}

const nomeDaConta = (c: Pick<ContaIa, "ia" | "apelido">) => `${PROVEDOR[c.ia].nome} · ${c.apelido}`;
const pronta = (c: ContaIa) => c.maquinas.some((v) => v.estado === "pronta");
const noLimite = (c: ContaIa, agora: number) => c.noLimiteAte !== null && c.noLimiteAte > agora;
/** A conta cuja leitura vigente já chegou ao limite numa das janelas. */
const esgotada = (c: ContaIa) => !!c.cota && [c.cota.cincoHoras, c.cota.semana].some((j) => j !== null && j.utilizacao >= 1);

/** A maior utilização entre as janelas ainda vigentes da leitura; null = nenhuma. */
export function maiorUso(q: CotaDaContaDto | null | undefined): number | null {
  const us = [q?.cincoHoras, q?.semana].filter((j): j is JanelaDoPlano => !!j).map((j) => j.utilizacao);
  return us.length ? Math.max(...us) : null;
}

/**
 * A conta que assume quando esta chegar ao limite (ADR-108, a fila): outra da mesma IA, ligada na fila, logada em alguma
 * máquina, fora do limite. A ordem é a da lista (a ordem de uso). null = ninguém assume; as rotinas esperam.
 */
export function proximaDaFila(c: ContaIa, contas: readonly ContaIa[], agora: number): ContaIa | null {
  return contas.find((o) => o.id !== c.id && o.ia === c.ia && o.entraNaTrocaAutomatica && pronta(o) && !noLimite(o, agora) && !esgotada(o)) ?? null;
}

type Janela = { rotulo: string; nome: string; janela: JanelaDoPlano | null; renovou: number | null };

function blocoDaJanela(j: Janela, agora: number): string {
  if (!j.janela) {
    if (j.renovou === null) return "";
    return `<div class="cu-jan f-renovado"><div class="cu-cab"><span>${esc(j.rotulo)}</span></div><p class="cu-sub">renovou ${esc(quandoRenova(j.renovou, agora))} · o número volta no próximo trabalho</p></div>`;
  }
  const faixa = faixaDaJanela(j.janela.utilizacao);
  const pct = pctUsado(j.janela.utilizacao);
  const renova = j.janela.renovaEm !== null ? `renova ${quandoRenova(j.janela.renovaEm, agora)}` : "";
  const sub = [faixa === "limite" ? "no limite" : "", renova].filter(Boolean).join(" · ");
  const falado = `${j.nome}: ${pct}% usado${sub ? `, ${sub}` : ""}`;
  return `<div class="cu-jan f-${faixa}" role="meter" aria-label="${esc(j.nome)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${esc(falado)}">`
    + `<div class="cu-cab" aria-hidden="true"><span>${esc(j.rotulo)}</span><b>${pct}%</b></div>`
    + `<div class="cu-barra" aria-hidden="true"><span style="width:${pct}%"></span></div>`
    + (sub ? `<p class="cu-sub" aria-hidden="true">${esc(sub)}</p>` : "")
    + "</div>";
}

export type ContextoDoUso = {
  agora: number;
  /** A lista inteira, na ordem de uso: de onde sai a próxima da fila. */
  contas: readonly ContaIa[];
  /** O nome da máquina na tela ("MacBook Air"); null = não se sabe. */
  nomeDaMaquina: (maquinaId: string) => string | null;
};

/**
 * O bloco de uso da linha da conta. `cota` ausente (servidor anterior à NOD-302) = nada, sem esqueleto; `null` = nenhuma
 * leitura ainda: o Claude informa no primeiro trabalho; o ChatGPT pode não informar (a leitura do app-server é melhor
 * esforço), e a tela diz isso sem prometer número.
 */
export function usoDaConta(c: ContaIa, x: ContextoDoUso): string {
  const q = c.cota;
  if (q === undefined) return "";
  const nada = c.ia === "codex-cli" ? `O ${PROVEDOR[c.ia].nome} não informou o uso desta conta` : "O uso aparece depois do primeiro trabalho com esta conta";
  if (q === null) return `<p class="cu-nada">${esc(nada)}</p>`;
  const janelas = [
    blocoDaJanela({ rotulo: "5 h", nome: "5 horas", janela: q.cincoHoras, renovou: q.renovou?.cincoHoras ?? null }, x.agora),
    blocoDaJanela({ rotulo: "Semana", nome: "Semana", janela: q.semana, renovou: q.renovou?.semana ?? null }, x.agora),
  ].join("");
  if (!janelas) return `<p class="cu-nada">${esc(nada)}</p>`;
  const velho = x.agora - q.medidoEm > LEITURA_VELHA_MS;
  // Dois Macs (ou o Mac e a VM): diz de qual máquina veio o número, que pode não ser a que a pessoa olha.
  const onde = q.maquinaId && c.maquinas.length > 1 ? x.nomeDaMaquina(q.maquinaId) ?? c.maquinas.find((m) => m.maquinaId === q.maquinaId)?.nome ?? null : null;
  const pe = `<p class="cu-pe${velho ? " velho" : ""}">medido ${esc(ha(q.medidoEm, x.agora))}${onde ? ` no ${esc(onde)}` : ""}${velho ? " · pode ter mudado" : ""}</p>`;
  const maior = maiorUso(q);
  let fila = "";
  if (maior !== null && faixaDaJanela(maior) === "alerta") {
    const prox = proximaDaFila(c, x.contas, x.agora);
    fila = prox
      ? `<p class="cu-fila">Ao chegar no limite, os trabalhos seguem em ${esc(nomeDaConta(prox))}.</p>`
      : `<p class="cu-fila">Sem outra conta do ${esc(PROVEDOR[c.ia].nome)} na fila: no limite, as rotinas esperam até renovar.</p>`;
  }
  return `<div class="cl-uso">${janelas}</div>${pe}${fila}`;
}
