import type { AlvoAviso, NodDesktop } from "../../src/contracts/desktop.ts";

/**
 * NOD-136: o link `nod://` que abriu o app do Mac. Ele espera na fila do processo principal (desktop/deep-link.ts) até a
 * página ter sessão, frota e salas, e então é aberto pelo mesmo caminho do clique no aviso (`abrirAlvoDoAviso`: conversa
 * de outra pessoa ou inexistente vira Sua vez). Sem DOM: testável no vitest (tests/unit/web/deep-link.test.ts).
 *
 * A página puxa em dois momentos: quando a primeira leitura da frota e a das salas de cada sessão chegaram (o link veio
 * antes: app frio, tela de conexão, login) e a cada aviso `aoDeepLink` (o link veio com a página pronta). As salas
 * contam porque `abrirAlvoDoAviso` procura a conversa nelas também: puxar só com a frota mandaria o link de uma sala para
 * Sua vez (revisão do Codex). Sem os métodos na ponte (app antigo ou navegador), nada.
 */
export type LeituraDoDeepLink = "frota" | "salas";

export type PuxadorDeepLink = {
  /**
   * O repasse das leituras de uma passada do `reidratar`, preso à sessão em que ela começou: a leitura da sessão
   * anterior que chega depois de `novaSessao` não conta (as salas contam mesmo quando falham sem ser por rede: o
   * servidor não as tem).
   */
  leitor(): (q: LeituraDoDeepLink) => void;
  /** Outra sessão começou: o link volta a esperar a frota e as salas dela, e o pull em voo da anterior não abre. */
  novaSessao(): void;
};

export function criarPuxadorDeepLink(mac: NodDesktop | undefined, temSessao: () => boolean, abrir: (alvo: AlvoAviso) => void): PuxadorDeepLink {
  const pendente = mac?.deepLinkPendente?.bind(mac);
  if (!mac?.aoDeepLink || !pendente) return { leitor: () => () => undefined, novaSessao: () => undefined };
  const lidas = new Set<LeituraDoDeepLink>();
  let geracao = 0;
  let conferido = false;
  const pronta = (): boolean => temSessao() && lidas.has("frota") && lidas.has("salas");
  const puxar = (): void => {
    if (!pronta()) return;
    conferido = true;
    const desta = geracao;
    // Falha da ponte (ex.: origem_invalida durante uma navegação) não conta como conferido: a próxima leitura tenta.
    void pendente().then(
      (alvo) => { if (alvo && desta === geracao) abrir(alvo); },
      () => { if (desta === geracao) conferido = false; },
    );
  };
  mac.aoDeepLink(puxar);
  return {
    leitor: () => {
      const desta = geracao;
      return (q) => {
        if (desta !== geracao) return;
        lidas.add(q);
        if (!conferido) puxar();
      };
    },
    novaSessao: () => {
      geracao++;
      lidas.clear();
      conferido = false;
    },
  };
}

/**
 * Para onde vai o alvo do aviso ou do link (`abrirAlvoDoAviso`): a conversa de um bot da pessoa, a de uma sala em que ela
 * está, ou Sua vez quando a conversa é de outra pessoa, não existe ou ainda não chegou.
 */
export type DestinoDoAlvo =
  | { tipo: "computador-do-bot"; primeiroUso: boolean }
  | { tipo: "conversa"; conversaId: string; agenteId: string }
  | { tipo: "sala"; salaId: string; conversaId: string }
  | { tipo: "sua-vez" };

export function destinoDoAlvo(
  alvo: AlvoAviso,
  contexto: {
    pessoaId: string;
    agentes: readonly { id: string; conversaId: string; ownerId: string }[];
    salas: readonly { sala: { id: string; conversaId: string } }[];
  },
): DestinoDoAlvo {
  if (alvo.tipo === "computador-do-bot") return { tipo: "computador-do-bot", primeiroUso: !!alvo.primeiroUso };
  if (alvo.tipo !== "conversa") return { tipo: "sua-vez" };
  const agente = contexto.agentes.find((a) => a.conversaId === alvo.conversaId && a.ownerId === contexto.pessoaId);
  if (agente) return { tipo: "conversa", conversaId: agente.conversaId, agenteId: agente.id };
  const sala = contexto.salas.find((s) => s.sala.conversaId === alvo.conversaId);
  if (sala) return { tipo: "sala", salaId: sala.sala.id, conversaId: sala.sala.conversaId };
  return { tipo: "sua-vez" };
}

/**
 * A leitura de `q` conta para o link? A frota e as salas que chegaram, sim. As salas que falharam sem ser por rede
 * (servidor sem a rota, erro do servidor) também: a sessão não as terá, e o link não espera mais por elas. Falha de
 * rede não conta: a leitura volta quando a rede voltar.
 */
export function leituraConta(q: string, resultado: { acao: string } | { erroDeRede: boolean }): LeituraDoDeepLink | null {
  if ("acao" in resultado) return resultado.acao === "hidratar-frota" ? "frota" : resultado.acao === "hidratar-salas" ? "salas" : null;
  return q === "salas" && !resultado.erroDeRede ? "salas" : null;
}
