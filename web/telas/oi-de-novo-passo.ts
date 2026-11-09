import type { IaDesktop } from "../../src/contracts/desktop.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { esc } from "../lib/render.ts";

/**
 * As partes puras de "Oi de novo · este computador" (ADA-243, jornada B): a decisão de mostrar, o estado da IA desta
 * máquina e o miolo do passo. O diálogo (com DOM) fica em oi-de-novo.ts, para os testes rodarem sem DOM.
 */

export type IaAqui = { tipo: "pronta"; ia: IaDesktop } | { tipo: "sem_login"; ia: IaDesktop } | { tipo: "nada"; ia: IaDesktop };

const NOME: Record<IaDesktop, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };
const ORDEM: readonly IaDesktop[] = ["claude-cli", "codex-cli"];

/** Pura: a IA desta máquina, pelo que o motor dela anunciou (ADR-102). Sem a máquina na lista ainda: nada. */
export function iaAqui(m: Pick<MaquinaDto, "ias"> | undefined): IaAqui {
  const ias = m?.ias ?? {};
  const pronta = ORDEM.find((ia) => ias[ia] === "pronto");
  if (pronta) return { tipo: "pronta", ia: pronta };
  const semLogin = ORDEM.find((ia) => ias[ia] === "nao_autenticado");
  if (semLogin) return { tipo: "sem_login", ia: semLogin };
  return { tipo: "nada", ia: "claude-cli" };
}

/**
 * Pura: a tela aparece? Flag ligada, app com as pontes, esta máquina conhecida E já conectada na lista (antes disso o motor
 * não anunciou as IAs e o passo diria "nada" por engano, gravando o "já vi"; revisão do PR #692), onboarding concluído e
 * sem "já vi" aqui.
 */
export function mostrarEsteComputador(o: { flag: boolean; temPonte: boolean; estaMaquina: boolean; maquinaConectada: boolean; onboardingConcluido: boolean; vistoAqui: boolean }): boolean {
  return o.flag && o.temPonte && o.estaMaquina && o.maquinaConectada && o.onboardingConcluido && !o.vistoAqui;
}

/** Pura: o miolo do passo da IA. O botão principal leva `data-ia-acao` (continuar | entrar | instalar). */
export function htmlPassoIa(o: { nome: string; estaMaquinaNome: string; ia: IaAqui; esperando?: boolean }): string {
  const cli = NOME[o.ia.ia];
  const cabeca = `<h2 id="b-titulo">Oi de novo${o.nome ? `, ${esc(o.nome)}` : ""}</h2><p class="mudo sm">este computador · ${esc(o.estaMaquinaNome)}</p>`;
  const [texto, acao, rotulo] =
    o.ia.tipo === "pronta"
      ? [`O ${cli} já está pronto neste computador. Seus bots podem trabalhar aqui.`, "continuar", "Continuar"]
      : o.ia.tipo === "sem_login"
      ? [`O ${cli} está instalado neste computador, mas sem conta conectada. Entre para os bots poderem trabalhar aqui.`, "entrar", `Entrar no ${cli}`]
      : [`Este computador ainda não tem IA. Instale o ${cli} e entre na sua conta para os bots poderem trabalhar aqui.`, "instalar", `Instalar o ${cli}`];
  const espera = o.esperando ? `<p class="mudo sm" role="status">Esperando o ${cli} ficar pronto neste computador…</p>` : "";
  return `${cabeca}<p>${texto}</p>${espera}<p data-estado class="dialogo-erro" role="status"></p>
    <div class="acoes"><button class="bt" data-ia-acao="agora-nao" type="button">Agora não</button> <button class="bt pri" data-ia-acao="${acao}" type="button"${o.esperando ? " disabled" : ""}>${rotulo}</button></div>`;
}
