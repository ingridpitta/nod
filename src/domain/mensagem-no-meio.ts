import type { EventoStream } from "../contracts/turno.ts";

/**
 * Mensagem da pessoa no meio de um turno (definido em 2026-10-07, ADR-083 §6, emenda da ADR-067). Comum a todos os
 * drivers: o laço põe a moldura antes de entregar ao adapter, e cada driver usa o rastreador para achar a resposta.
 *
 * Medido no diário (7 dias até 07/10): 38 mensagens absorvidas no meio de um turno; a resposta curta que o modelo
 * escrevia antes da ferramenta seguinte era descartada como narração (NARRACAO_MAX_CHARS) e a pessoa não via nada.
 */
export function molduraMensagemNoMeio(texto: string): string {
  return `A pessoa escreveu enquanto você trabalhava: «${texto}». Responda a ela primeiro, em poucas frases, e depois continue o trabalho.`;
}

/**
 * NOD-376: a fala que a pessoa escreve na tela de uma frente (ou task). Antes ela ia crua, como o recado do bot
 * (`mensagensSemMoldura`), e o bot a tratava como ruído: respondia só no fim, colado ao resumo. A moldura vai na própria
 * entrada do turno do recado, então vale nos dois caminhos — absorvida no meio do turno vivo (o laço não embrulha de
 * novo, o id segue em `mensagensSemMoldura`) e na frente parada ou terminada, que a fala reabre como turno próprio.
 * O recado que o bot repassa (`mandar_para_frente`) não passa por aqui.
 */
export const INICIO_FALA_NA_FRENTE = "[nod] A pessoa escreveu nesta frente: «";
const FRENTE_JA_ACABOU = "O trabalho desta frente já tinha acabado e o resumo dela já está guardado: não o refaça, não o retome nem devolva outro resumo.";
export function molduraFalaNaFrente(texto: string, o: { frenteAcabou?: boolean } = {}): string {
  // As aspas de fora («») no texto dela viram as de dentro (‹›): a fala não fecha a citação nem imita a moldura.
  const fala = texto.replaceAll("«", "‹").replaceAll("»", "›");
  // Revisão do PR #539 (A1): a frente que já tinha acabado só responde — não refaz nem retoma o trabalho sem ela pedir.
  const depois = o.frenteAcabou ? FRENTE_JA_ACABOU : "Depois continue o trabalho de onde parou.";
  return `${INICIO_FALA_NA_FRENTE}${fala}». Responda a ela primeiro, aqui na frente, em poucas frases. ${depois} A resposta fica nesta frente: não mude o pedido original, a não ser que ela peça.`;
}

/**
 * Os eventos em que o modelo passa a ler o que foi escrito na sessão (revisto em 2026-10-08, revisão do épico #188). O
 * padrão é o do CLI em stream-json: a mensagem entra na conversa no limite da ferramenta (depois do `tool_result`) ou no
 * fim da volta (`result`). Um driver cujo motor lê a mensagem em outro ponto passa as suas fronteiras.
 */
export const FRONTEIRAS_PADRAO: readonly EventoStream["tipo"][] = ["tool_result", "result"];

/**
 * O primeiro bloco de texto que o modelo escreve DEPOIS DE LER uma mensagem absorvida é a resposta a ela: sempre fala
 * gravada, de qualquer tamanho. `falados` = os blocos que o driver já mandou como fala intermediária (saem da fala final,
 * senão a pessoa leria duas vezes); `obrigatorios` = os que não puderam sair na hora (sem sink de fala) e entram na fala
 * final mesmo curtos. Os dois conjuntos guardam o próprio objeto do evento, que é o mesmo nas fatias de cada rodada.
 *
 * revisto em 2026-10-08 (revisão do épico #188, X1): escrever na sessão não é o modelo ler. O CLI só lê a mensagem na
 * fronteira seguinte; a narração que já estava saindo ("Vou revisar as três tasks.") é de antes dela. Por isso
 * `absorveu()` deixa a marca PENDENTE e quem a arma é a próxima fronteira; `armar()` é para quando o driver sabe que o
 * modelo já está com o texto (abriu uma volta com ele, ou a sessão estava parada esperando).
 */
export type FalaDoMeio = {
  /** O texto entrou na sessão, mas o modelo pode estar no meio de uma fala de antes: arma na próxima fronteira. */
  absorveu(): void;
  /** O modelo já está com o texto (uma volta nova começou com ele): a próxima fala é a resposta. */
  armar(): void;
  /**
   * Chamado com cada evento, na ordem. Devolve o texto quando este é a resposta à mensagem do meio (uma vez por
   * absorção; duas mensagens antes de qualquer texto têm uma resposta só). `falouNaHora` diz se o driver vai mandá-la
   * como fala intermediária agora.
   */
  avaliar(ev: EventoStream, falouNaHora: boolean): string | null;
  readonly falados: ReadonlySet<EventoStream>;
  readonly obrigatorios: ReadonlySet<EventoStream>;
};

export function criarFalaDoMeio(fronteiras: readonly EventoStream["tipo"][] = FRONTEIRAS_PADRAO): FalaDoMeio {
  let estado: "nada" | "pendente" | "armado" = "nada";
  const falados = new Set<EventoStream>();
  const obrigatorios = new Set<EventoStream>();
  return {
    absorveu() {
      if (estado === "nada") estado = "pendente";
    },
    armar() {
      estado = "armado";
    },
    avaliar(ev, falouNaHora) {
      if (estado === "armado" && ev.tipo === "texto_bloco" && ev.texto.trim() !== "") {
        estado = "nada";
        (falouNaHora ? falados : obrigatorios).add(ev);
        return ev.texto;
      }
      // A fronteira arma DEPOIS de avaliar: o bloco que a fecha (o texto do item, no Codex) ainda é de antes.
      if (estado === "pendente" && fronteiras.includes(ev.tipo)) estado = "armado";
      return null;
    },
    falados,
    obrigatorios,
  };
}
