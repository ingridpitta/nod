import type { Estado } from "../estado/reducer.ts";
import { renderDetalhes } from "../telas/detalhes.ts";
import { renderPerfilCelular } from "../telas/perfil-celular.ts";
import { ehCelular } from "./celular.ts";
import { lembrar } from "./lembrar.ts";
import { lembrancaDaMidia } from "./midia.ts";
import { preservandoCampo, reaplicarAviso } from "./gaveta-identidade.ts";
import { regiao, regiaoMudaria } from "./regioes.ts";

/**
 * Definido em 2026-10-12 (GFK-2027): texto não salvo fica no DOM; a Inteligência tem o rascunho no reducer e
 * acompanha cada mudança, mesmo suja. Os botões e a rolagem desse nível continuam no lugar após redesenhar.
 */
let ponteiroNaGaveta = false;
let adiado: { estado: Estado; gavetaSuja: string | null } | null = null;
// Revisão da NOD-349: com o botão do ponteiro apertado dentro da gaveta, o redesenho espera o clique terminar; senão o
// botão sob o dedo (uma aba, Ajustes, o avatar) é trocado entre o pointerdown e o click, e o clique se perde.
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (ev) => { ponteiroNaGaveta = Boolean((ev.target as Element | null)?.closest?.("#detalhes")); }, true);
  const soltar = (): void => {
    if (!ponteiroNaGaveta) return;
    ponteiroNaGaveta = false;
    setTimeout(() => { const a = adiado; adiado = null; if (a) atualizarGaveta(a.estado, a.gavetaSuja); }, 0);
  };
  document.addEventListener("pointerup", soltar, true);
  document.addEventListener("pointercancel", soltar, true);
}

export function atualizarGaveta(estado: Estado, gavetaSuja: string | null): void {
  if (ponteiroNaGaveta) { adiado = { estado, gavetaSuja }; return; }
  adiado = null;
  const inteligencia = estado.gaveta?.nivel.tipo === "inteligencia";
  if (!inteligencia && gavetaSuja === JSON.stringify(estado.gaveta)) return;
  const ativo = document.activeElement;
  // ADR-125 (NOD-349): com o foco no nome ou no subtítulo, o resto da gaveta redesenha, mas o campo é o mesmo nó (o que a
  // pessoa digita, o cursor e o foco ficam). Revisão 2: antes o frame inteiro era pulado e a gaveta congelava.
  const campo = typeof (ativo as Element | null)?.matches === "function" && ativo!.matches("#detalhes .gvn-nome, #detalhes .gvn-sub") ? (ativo as HTMLInputElement) : null;
  // NOD-326: a Biblioteca lê a lembrança da mídia (o que saiu da pasta, este Mac), que mora fora do estado.
  // NOD-382: no celular, o perfil do bot no estilo do iOS; o desktop segue com a gaveta de sempre.
  const celular = ehCelular();
  const html = lembrar("detalhes", estado, [lembrancaDaMidia.sumiram.size, lembrancaDaMidia.esteMac, celular], celular ? renderPerfilCelular : renderDetalhes);
  if (!regiaoMudaria("detalhes", html)) return;
  if (campo) {
    const seletor = `[data-campo="${CSS.escape(campo.dataset.campo ?? "")}"][data-id="${CSS.escape(campo.dataset.id ?? "")}"]`;
    // O campo não volta (outro bot, outro nível): o blur salva antes, para o texto digitado não sumir com o nó.
    if (!html.includes(`data-campo="${campo.dataset.campo ?? ""}" data-id="${campo.dataset.id ?? ""}"`)) {
      // Revisão 3: o foco não segue para o campo de mesmo id do outro bot (o que se digitasse o renomearia).
      campo.blur();
      regiao("detalhes", html);
      reaplicarAviso();
      return;
    }
    const inicio = campo.selectionStart;
    const fim = campo.selectionEnd;
    const antigoSalvo = campo.dataset.salvo;
    preservandoCampo(() => {
      regiao("detalhes", html);
      const novo = document.querySelector<HTMLInputElement>(`#detalhes ${seletor}`);
      if (!novo) return;
      // Sem edição em curso, o valor que mudou fora (outro aparelho) entra; com edição, o que a pessoa digita fica.
      if (novo.dataset.salvo !== undefined) {
        if (campo.value === antigoSalvo) campo.value = novo.dataset.salvo;
        campo.dataset.salvo = novo.dataset.salvo;
      }
      novo.replaceWith(campo);
      campo.focus({ preventScroll: true });
      if (inicio !== null && fim !== null) campo.setSelectionRange?.(inicio, fim);
    });
    reaplicarAviso();
    return;
  }

  let foco: string | null = null;
  // ADR-125 (e revisão da NOD-349): o foco continua no mesmo controle depois do redesenho — a aba e o rádio (as setas
  // trocam a aba e a forma) e qualquer botão ou campo da gaveta, como o que acabou de receber o Tab ao sair do nome.
  const el = ativo as HTMLElement | null;
  if (el && typeof el.closest === "function" && el.closest("#detalhes") && el.attributes) {
    const dados = [...el.attributes].filter((a) => a.name.startsWith("data-") && a.name !== "data-salvo").map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join("");
    if (el.id) foco = `#${CSS.escape(el.id)}`;
    else if (dados) foco = `${(el.tagName ?? "").toLowerCase()}${dados}`;
  }
  if (inteligencia && ativo instanceof HTMLButtonElement && ativo.closest('#detalhes [data-form="inteligencia"]')) {
    if (ativo.dataset.act) {
      foco = `button${[...ativo.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join("")}`;
    } else if (ativo.hasAttribute("data-alca-ordem")) {
      const ia = ativo.closest<HTMLElement>("[data-ordem-item]")?.dataset.ordemItem;
      if (ia) foco = `[data-ordem-item="${CSS.escape(ia)}"] button[data-alca-ordem]`;
    }
  }
  const corpo = inteligencia ? document.querySelector<HTMLElement>("#detalhes .gv-corpo") : null;
  const rolagem = corpo?.scrollTop ?? 0;
  regiao("detalhes", html);
  reaplicarAviso();
  if (corpo) {
    const novo = document.querySelector<HTMLElement>("#detalhes .gv-corpo");
    if (novo) novo.scrollTop = rolagem;
  }
  if (foco) document.querySelector<HTMLElement>(`#detalhes ${foco}`)?.focus({ preventScroll: true });
}
