import type { RespostaMutacao } from "../../src/contracts/api.ts";
import { quandoCurto } from "./relogio.ts";
import { esc } from "./render.ts";

/**
 * definido em 2026-10-16 (NOD-272, CA "Executar agora" com execução na fila): o servidor não cria um segundo
 * turno quando a rotina já tem uma execução aberta — devolve `ids.jaNaFila`. A tela pergunta antes de rodar
 * mais uma; cancelar não chama nada (devolve null). Confirmar repete o pedido com `confirmar: true`.
 */
export async function executarRotinaComConfirmacao(
  executar: (opcoes?: { confirmar?: boolean }) => Promise<RespostaMutacao>,
  confirmar: (pergunta: string) => boolean | Promise<boolean>,
  agora: () => number = Date.now,
): Promise<RespostaMutacao | null> {
  const r = await executar();
  if (!r.ids.jaNaFila) return r;
  if (!(await confirmar(perguntaJaNaFila(r.ids.jaNaFilaEm, r.ids.fusoIana, agora())))) return null;
  return executar({ confirmar: true });
}

/** definido em 2026-10-16 (revisão do Gil no #335): o título do diálogo próprio que faz a pergunta. */
export const TITULO_JA_NA_FILA = "Rodar mais uma execução?";

/**
 * revisto em 2026-10-16 (revisão do Gil no #335, B1): a execução aberta pode estar na fila OU rodando (`turnoAberto`
 * inclui `despachando`), então a pergunta diz "ainda não terminou", que vale para os dois. O dia vem com a hora
 * ("hoje 10:00", "ontem 13:00"): a janela aberta pode ser de ontem. "sem cancelar a outra": a pendente nunca é cancelada.
 */
export function perguntaJaNaFila(emMs: string | undefined, fusoIana: string | undefined, agora = Date.now()): string {
  const ms = Number(emMs);
  if (!emMs || !Number.isFinite(ms)) return "A execução anterior desta rotina ainda não terminou. Rodar mais uma agora, sem cancelar a outra?";
  let quando: string;
  try {
    quando = quandoCurto(ms, agora, fusoIana || "UTC");
  } catch {
    quando = quandoCurto(ms, agora);
  }
  return `A execução de ${quando} ainda não terminou. Rodar mais uma agora, sem cancelar a outra?`;
}

/**
 * definido em 2026-10-16 (revisão do Gil no #335, A1): a pergunta do "Testar agora" com execução aberta, no diálogo
 * próprio (window.confirm não tem título e põe o foco no OK — Enter gastaria um turno). "Rodar mais uma" é o primário,
 * sem estilo destrutivo; Cancelar recebe o foco. Esc, Cancelar e clique fora = false.
 */
export function htmlRodarMaisUma(pergunta: string): string {
  return `<h2 id="rodar-mais-uma-titulo">${esc(TITULO_JA_NA_FILA)}</h2>
    <p>${esc(pergunta)}</p>
    <div class="acoes"><button class="bt" data-nao type="button" autofocus>Cancelar</button> <button class="bt pri" data-sim type="button">Rodar mais uma</button></div>`;
}

/**
 * definido em 2026-11-11 (NOD-413): o card "Rodar agora" do chat com execução aberta quando a proposta nasceu. A mesma
 * frase do diálogo do Testar agora, para o clique em "Rodar agora" valer como "Rodar mais uma".
 */
export function avisoNaFila(naFila: { instanteAgendado: number; fusoIana: string }, agora = Date.now()): string {
  return perguntaJaNaFila(String(naFila.instanteAgendado), naFila.fusoIana, agora);
}
