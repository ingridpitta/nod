import type { AlcanceRelato, CategoriaRelato } from "../../src/contracts/relato.ts";
import type { Api } from "../lib/api.ts";
import { esc } from "../lib/render.ts";

/**
 * O rótulo que a pessoa lê. O valor gravado é a união fechada do contrato, nunca este texto.
 * O tipo do Record cobre a união inteira: categoria nova em src/contracts sem rótulo aqui não compila
 * (a web não IMPORTA o valor — ADR-018 —, então o compilador guarda a correspondência).
 */
const CATEGORIAS: Record<CategoriaRelato, string> = {
  resposta_errada: "Respondeu errado",
  nao_fez_o_pedido: "Não fez o que pedi",
  travou_ou_parou: "Travou ou parou no meio",
  lento: "Demorou demais",
  interface: "Problema na tela",
  outro: "Outra coisa",
};

/**
 * Só 'outro' pede descrição: as outras cinco categorias já dizem o que houve, e o estado técnico que
 * o servidor anexa explica o resto. 'outro' é a única que não carrega significado sozinha — sem o
 * texto, o relato chega vazio (definido em 2026-09-21).
 */
const PEDE_TEXTO: CategoriaRelato = "outro";

/** Espelho de TETO_TEXTO_RELATO: a web não importa VALOR de src/ (ADR-018), só tipo. O servidor
 *  valida de novo — este maxlength é conveniência, não regra. */
const TETO_TEXTO = 2000;

/**
 * Relatar comportamento indesejado a partir de uma mensagem (ADR-041).
 *
 * Uma etapa só: a pessoa escolhe o que houve, o campo de texto aparece com a pergunta daquela
 * escolha, e enviar fica disponível na hora — o texto é sempre opcional. O que anexar tem default
 * ("os últimos 15 minutos"), porque escolher contexto é decisão do produto, não da pessoa; quem
 * quiser mandar só a mensagem troca em um clique.
 *
 * Nenhum metadado é pedido: o servidor já tem tipado tudo que explica a falha.
 */
export function abrirReportarBug(api: Api, mensagemId: string, versaoApp: string | null, correlationId: string | null, aoEnviar?: () => void): void {
  const dialog = document.createElement("dialog");
  dialog.className = "relato-dialogo";
  dialog.setAttribute("aria-labelledby", "relato-titulo");

  const opcoes = (Object.keys(CATEGORIAS) as CategoriaRelato[])
    .map((c) => `<button type="button" class="relato-opcao" data-categoria="${esc(c)}" role="radio" aria-checked="false">${esc(CATEGORIAS[c])}</button>`)
    .join("");

  dialog.innerHTML = `<div data-painel="escolha">
      <h2 id="relato-titulo">O que aconteceu?</h2>
      <p class="relato-nota">Os detalhes técnicos vão junto — turno, modelo e o erro, se houve.</p>
      <div class="relato-opcoes" role="radiogroup" aria-labelledby="relato-titulo">${opcoes}</div>
      <div class="relato-campo" data-campo hidden>
        <textarea data-texto rows="2" maxlength="${TETO_TEXTO}" placeholder="O que aconteceu?"></textarea>
      </div>
      <div class="relato-anexo" data-anexo hidden>
        <span id="relato-anexo-rotulo">Anexar</span>
        <div class="relato-anexo-opcoes" role="radiogroup" aria-labelledby="relato-anexo-rotulo">
          <button type="button" class="relato-alcance" data-alcance="janela" role="radio" aria-checked="true">Últimos 15 min</button>
          <button type="button" class="relato-alcance" data-alcance="mensagem" role="radio" aria-checked="false">Só esta mensagem</button>
        </div>
      </div>
      <p class="relato-erro" role="alert" hidden></p>
      <div class="relato-acoes">
        <button type="button" class="bt" data-cancelar>Cancelar</button>
        <button type="button" class="bt pri" data-enviar disabled>Enviar</button>
      </div>
    </div>
    <div data-painel="pronto" hidden>
      <h2>Relato registrado.</h2>
      <p class="relato-nota">Obrigado — ele entra na fila de investigação com o estado técnico do momento.</p>
      <div class="relato-acoes"><button type="button" class="bt pri" data-fechar>Fechar</button></div>
    </div>`;

  document.body.append(dialog);
  const focoAnterior = document.activeElement;
  dialog.showModal();
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus();
  });
  // Clique no backdrop fecha, como nos demais diálogos do nod (gestao-agentes.ts).
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  const q = <T extends HTMLElement = HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  const enviar = q<HTMLButtonElement>("[data-enviar]");
  const textarea = q<HTMLTextAreaElement>("[data-texto]");
  let categoria: CategoriaRelato | null = null;
  let alcance: AlcanceRelato = "janela";
  let enviando = false;

  const marcar = (seletor: string, atributo: string, escolhido: string) => {
    for (const b of dialog.querySelectorAll<HTMLButtonElement>(seletor)) {
      b.setAttribute("aria-checked", String(b.dataset[atributo] === escolhido));
    }
  };

  dialog.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || enviando) return;

    if (b.dataset.categoria) {
      categoria = b.dataset.categoria as CategoriaRelato;
      marcar("[data-categoria]", "categoria", categoria);
      const pedeTexto = categoria === PEDE_TEXTO;
      q("[data-campo]").hidden = !pedeTexto;
      q("[data-anexo]").hidden = false;
      // 'Outra coisa' sem descrição não diz nada a quem investiga: só ela exige o texto.
      enviar.disabled = pedeTexto && textarea.value.trim() === "";
      if (pedeTexto) textarea.focus();
      return;
    }

    if (b.dataset.alcance) {
      alcance = b.dataset.alcance as AlcanceRelato;
      marcar("[data-alcance]", "alcance", alcance);
      return;
    }

    if (b.hasAttribute("data-cancelar") || b.hasAttribute("data-fechar")) {
      dialog.close();
      return;
    }

    if (b.hasAttribute("data-enviar") && categoria) {
      enviando = true;
      for (const x of dialog.querySelectorAll<HTMLButtonElement>("button")) x.disabled = true;
      enviar.textContent = "Enviando…";
      // Texto só acompanha a categoria que o pede: trocar de escolha não leva junto o que ficou digitado.
      const texto = categoria === PEDE_TEXTO ? textarea.value.trim() : "";
      void api
        .relatar({ mensagemId, categoria, alcance, ...(texto ? { texto } : {}), ...(versaoApp ? { versaoApp } : {}), ...(correlationId ? { correlationId } : {}) })
        .then(() => {
          // NOD-367: Feedback relê "Seus envios" (o frame relato.criado não invalida nada).
          aoEnviar?.();
          // Sem soltar a trava o próprio guard do handler engoliria o clique no Fechar.
          enviando = false;
          q('[data-painel="escolha"]').hidden = true;
          q('[data-painel="pronto"]').hidden = false;
          q<HTMLButtonElement>("[data-fechar]").disabled = false;
          q<HTMLButtonElement>("[data-fechar]").focus();
        })
        .catch(() => {
          // A web renderiza o código fechado, nunca texto vindo de err.message (ADR-002).
          const erro = q(".relato-erro");
          erro.textContent = "Não foi possível enviar. Tente de novo.";
          erro.hidden = false;
          enviando = false;
          enviar.textContent = "Enviar";
          for (const x of dialog.querySelectorAll<HTMLButtonElement>("button")) x.disabled = false;
          // Recompõe o predicado: habilitar tudo em bloco reabriria 'outro' sem descrição.
          enviar.disabled = categoria === PEDE_TEXTO && textarea.value.trim() === "";
        });
    }
  });

  // 'Outra coisa' só libera o envio quando há descrição.
  textarea.addEventListener("input", () => {
    if (categoria === PEDE_TEXTO && !enviando) enviar.disabled = textarea.value.trim() === "";
  });

  // Enter com Ctrl/Cmd envia direto do campo, como o composer da conversa.
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && categoria && !enviar.disabled && !enviando) enviar.click();
  });
}
