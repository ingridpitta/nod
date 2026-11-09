import type { Api } from "../lib/api.ts";
import { projetoAtivo, textoDaPasta } from "../lib/pasta-de-trabalho.ts";
import { esc } from "../lib/render.ts";

export function abrirWorkspace(api: Api, conversaId: string): void {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Pasta de trabalho");
  dialog.innerHTML = `<form method="dialog"><button aria-label="Fechar">Fechar</button></form><h2>Pasta de trabalho</h2>
    <p>Escolha uma pasta para o agente ler e editar arquivos e executar comandos isolados. O acesso vale somente para esta conversa, inclusive ao trocar de inteligência. Os comandos não têm rede nem acesso aos serviços do seu computador.</p>
    <p data-estado role="status">Carregando…</p><div data-escolha hidden><p data-caminho></p><button data-pai>Voltar uma pasta</button><details><summary>Ir para uma pasta pelo caminho</summary><label>Caminho da pasta<input data-endereco aria-label="Caminho da pasta"></label><button data-ir>Abrir pasta</button></details><ul data-pastas></ul>
    <p>Por padrão, projetos Git usam uma cópia de trabalho separada. Você pode pedir ao agente para trabalhar diretamente na pasta original.</p>
    <p data-restricao hidden>Escolha uma pasta de projeto ou de documentos, não a pasta pessoal inteira nem as pastas internas do Nod.</p><button data-permitir>Permitir nesta pasta</button></div><button data-revogar hidden>Remover acesso (preserva arquivos)</button>`;
  dialog.style.cssText = "max-width:640px;width:90%;max-height:85vh;overflow:auto;padding:28px;border:1px solid var(--line);border-radius:18px;background:var(--surface);color:var(--ink)";
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  const q = <T extends HTMLElement = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  let pasta = "";
  let pai = "";
  let ocupado = false;
  let selecionavel = false;
  const tratar = async (fn: () => Promise<void>) => {
    if (ocupado) return;
    ocupado = true;
    for (const b of dialog.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
    try { await fn(); } catch { q("[data-estado]").textContent = "Não foi possível concluir. Confira a pasta ou tente novamente."; }
    finally { ocupado = false; for (const b of dialog.querySelectorAll<HTMLButtonElement>("button")) b.disabled = false; q<HTMLButtonElement>("[data-permitir]").disabled = !selecionavel; }
  };
  async function navegar(caminho?: string) {
    const r = await api.pastasWorkspace(conversaId, caminho);
    pasta = r.caminho; pai = r.pai; selecionavel = r.selecionavel;
    q("[data-restricao]").hidden = selecionavel;
    q("[data-caminho]").textContent = pasta;
    q("[data-pastas]").innerHTML = r.pastas.map(p => `<li><button data-pasta="${esc(p.caminho)}">${esc(p.nome)}</button></li>`).join("");
    q("[data-escolha]").hidden = false;
  }
  dialog.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.pasta) void tratar(() => navegar(b.dataset.pasta));
    if (b.hasAttribute("data-pai")) void tratar(() => navegar(pai));
    if (b.hasAttribute("data-ir")) void tratar(() => navegar(q<HTMLInputElement>("[data-endereco]").value));
    if (b.hasAttribute("data-permitir")) void tratar(async () => {
      await api.escolherWorkspace(conversaId, pasta);
      q("[data-estado]").textContent = "Pasta associada. Conte o que você quer fazer.";
      q("[data-escolha]").hidden = true; q("[data-revogar]").hidden = false;
    });
    if (b.hasAttribute("data-revogar")) void tratar(async () => {
      await api.revogarWorkspace(conversaId); q("[data-estado]").textContent = "Acesso removido. Seus arquivos foram preservados."; q("[data-revogar]").hidden = true;
    });
  });
  void tratar(async () => {
    const r = await api.workspace(conversaId);
    if (!r.disponivel) { q("[data-estado]").textContent = "Esta instalação ainda não oferece associação de pastas locais. Conectar uma inteligência não concede acesso aos arquivos do seu Mac."; return; }
    q("[data-estado]").textContent = textoDaPasta(r.vinculo);
    q("[data-revogar]").hidden = !r.vinculo;
    await navegar(projetoAtivo(r.vinculo)?.pasta);
  });
}
