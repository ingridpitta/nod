import type { EstaMaquina } from "../../src/contracts/desktop-esta-maquina.ts";
import type { IaDesktop } from "../../src/contracts/desktop.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { htmlPassoIa, iaAqui } from "./oi-de-novo-passo.ts";
import { htmlTelaB, mostrarTelaB, type PadraoDaTelaB } from "./onde-trabalham.ts";

export { mostrarEsteComputador } from "./oi-de-novo-passo.ts";

/**
 * "Oi de novo · este computador" (definido em 2026-11-07, ADA-243, jornada B; atrás de NOD_ONBOARDING_TEXTO=1). Quem já
 * concluiu o onboarding e abre o app num computador novo vê, uma vez POR MÁQUINA (o "já vi" local da A, ADR-157 §4), o
 * estado real da IA DESTE computador (2a pronta · 2b instalada sem login · 2c nada) e, com a IA pronta, a tela B (onde os
 * bots trabalham). A conversa com o Nod não recomeça (o onboarding da pessoa segue concluído no servidor).
 *
 * A jornada A (ADA-242) ainda não tem a tela "Este computador" na web; isto é o mínimo compatível: um diálogo próprio,
 * fora das regiões que o render refaz, como o "Conectar este Mac?" (parear-mac.ts).
 */

export type DepsOiDeNovo = {
  nome: string;
  estaMaquina: EstaMaquina;
  /** A máquina desta instalação no estado atual (relida por `relerMaquinas`). */
  maquinaAqui(): MaquinaDto | undefined;
  padrao(): PadraoDaTelaB;
  ias?: { entrar(ia: IaDesktop): Promise<unknown>; instalar(ia: IaDesktop): Promise<unknown> };
  relerMaquinas(): Promise<void>;
  /** O mesmo PUT /maquinas/padrao do seletor; depois invalida maquinas e frota. */
  definirPadrao(id: string): Promise<void>;
  marcarVisto(): Promise<void>;
  esperarMs?: number;
};

/** Abre o diálogo. "Já vi" é gravado ao fechar, por qualquer caminho (a tela não volta nesta máquina). */
export function abrirOiDeNovo(d: DepsOiDeNovo): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "bot-dialogo";
  dialog.setAttribute("aria-labelledby", "b-titulo");
  document.body.append(dialog);
  let fechado = false;
  dialog.addEventListener("close", () => { fechado = true; void d.marcarVisto().catch(() => undefined); dialog.remove(); }, { once: true });
  const erro = (t: string) => { const p = dialog.querySelector("[data-estado]"); if (p) p.textContent = t; };

  const telaB = () => {
    const padrao = d.padrao();
    if (!mostrarTelaB({ estaMaquinaId: d.estaMaquina.id, padrao, iaProntaAqui: iaAqui(d.maquinaAqui()).tipo === "pronta" })) return dialog.close();
    dialog.innerHTML = htmlTelaB({ padrao, estaMaquinaNome: d.estaMaquina.nome });
    dialog.querySelector("[data-b=manter]")?.addEventListener("click", () => dialog.close());
    const aqui = dialog.querySelector<HTMLButtonElement>("[data-b=aqui]");
    aqui?.addEventListener("click", async () => {
      aqui.disabled = true;
      try {
        await d.definirPadrao(d.estaMaquina.id);
        dialog.close();
      } catch {
        aqui.disabled = false;
        erro("Não deu para mudar agora. Tente de novo ou escolha em Configurações › Computadores.");
      }
    });
  };

  const esperarPronta = async () => {
    const passo = d.esperarMs ?? 3_000;
    for (let i = 0; i < 60 && !fechado; i++) {
      await new Promise((r) => setTimeout(r, passo));
      await d.relerMaquinas().catch(() => undefined);
      if (iaAqui(d.maquinaAqui()).tipo === "pronta") return passoIa(false);
    }
    if (!fechado) passoIa(false);
  };

  const passoIa = (esperando: boolean) => {
    const ia = iaAqui(d.maquinaAqui());
    dialog.innerHTML = htmlPassoIa({ nome: d.nome, estaMaquinaNome: d.estaMaquina.nome, ia, esperando });
    dialog.querySelector("[data-ia-acao=agora-nao]")?.addEventListener("click", () => dialog.close());
    const pri = dialog.querySelector<HTMLButtonElement>("[data-ia-acao]:not([data-ia-acao=agora-nao])");
    pri?.addEventListener("click", async () => {
      if (ia.tipo === "pronta") return telaB();
      if (!d.ias) return erro("Abra Configurações › Computadores para conectar a IA neste computador.");
      pri.disabled = true;
      try {
        await (ia.tipo === "sem_login" ? d.ias.entrar(ia.ia) : d.ias.instalar(ia.ia));
        passoIa(true);
        void esperarPronta();
      } catch {
        pri.disabled = false;
        erro("Não deu para abrir agora. Tente de novo.");
      }
    });
  };

  passoIa(false);
  dialog.showModal();
  return dialog;
}
