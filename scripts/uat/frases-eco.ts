import type { PerfilComando } from "../../src/domain/comando-de-voz.ts";

/**
 * NOD-165: as 50 leituras do bot com uma frase de comando dentro, para a UAT do eco no Mac assinado. O alto-falante lê
 * cada uma, o microfone ouve, e nenhuma pode virar aprovação. São as mesmas nos dois Macs: o
 * `scripts/uat/ligacao-voz.ts --eco` as lista no formato que o catcher lê ao pé da letra e também as roda num pré-teste.
 *
 * 10 comandos × 5 moldes. Todo texto tem mais de 8 palavras (inteiro nunca é comando) e nenhum tem negação (que
 * recusaria): o que protege é a guarda de eco, não a gramática.
 */
export type FraseDeEco = { texto: string; comando: string; perfil: PerfilComando };

/**
 * Os comandos que mais custariam se o eco os disparasse: os do perfil estrito e os mais comuns do de proposta. A sessão
 * ao vivo lê só estes 10; o teste unit passa todos os de `COMANDOS_QUE_APROVAM` pelos mesmos moldes.
 */
export const COMANDOS_DE_ECO: readonly { comando: string; perfil: PerfilComando }[] = [
  { comando: "eu aprovo", perfil: "estrito" },
  { comando: "aprovado", perfil: "estrito" },
  { comando: "pode aprovar", perfil: "estrito" },
  { comando: "aprovo", perfil: "estrito" },
  { comando: "pode criar", perfil: "proposta" },
  { comando: "pode mandar", perfil: "proposta" },
  { comando: "manda ver", perfil: "proposta" },
  { comando: "pode fazer", perfil: "proposta" },
  { comando: "fechado", perfil: "proposta" },
  { comando: "isso mesmo", perfil: "proposta" },
];

export const MOLDES: readonly ((c: string) => string)[] = [
  (c) => `Para seguir com o envio do relatório, diga ${c}.`,
  (c) => `Quando a Ana respondeu, ela disse: ${c}, pode seguir.`,
  (c) => `Se a rotina das nove estiver boa, é só falar ${c} que eu cuido do resto.`,
  (c) => `O Bruno escreveu no Slack: ${c}, mas confere o valor antes.`,
  (c) => `Eu li o e-mail do cliente e a última linha diz ${c}, sem mais detalhes.`,
];

export const FRASES_DE_ECO: readonly FraseDeEco[] = MOLDES.flatMap((molde) =>
  COMANDOS_DE_ECO.map(({ comando, perfil }) => ({ texto: molde(comando), comando, perfil })),
);

/**
 * Veredito do pré-teste em laço. Só passa se TODAS as leituras aconteceram e nenhuma virou comando: com o cérebro fora
 * do ar nada é lido, nada vira comando, e "comandos: 0" sozinho seria um ✅ sem teste (QA da NOD-165).
 */
export function vereditoDoEco(o: { pedidas: number; lidas: number; comandos: number }): { passou: boolean; linhas: string[] } {
  const todasLidas = o.lidas === o.pedidas && o.pedidas > 0;
  return {
    passou: todasLidas && o.comandos === 0,
    linhas: [
      `leituras feitas: ${o.lidas}/${o.pedidas} ${todasLidas ? "✅" : "❌ o bot não leu todas: o pré-teste não vale"}`,
      `comandos: ${o.comandos} ${o.comandos === 0 ? (todasLidas ? "✅" : "(sem valor: faltaram leituras)") : "❌"}`,
    ],
  };
}

/** A linha que se cola no campo de texto da ligação para o catcher falar exatamente a frase. */
export function linhaDoCatcher(f: FraseDeEco): string {
  return `[[delta: ${f.texto}]]`;
}

/**
 * A mesma leitura pedida à IA de verdade: o app assinado não tem catcher, e um `[[delta: …]]` colado lá é só texto para
 * o modelo (QA da NOD-165). Quem confere que a leitura saiu igual é a legenda do bot na tela.
 */
export function linhaParaIa(f: FraseDeEco): string {
  return `Leia em voz alta, palavra por palavra, sem comentar nada antes nem depois: «${f.texto}»`;
}
