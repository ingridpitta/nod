/**
 * ADA-245 (jornada D do onboarding): remover o nod deste computador. Mora fora de desktop.ts e contas-ia.ts pelo gatilho
 * de 200 linhas da EMENDA 26. Três peças com o mesmo vocabulário:
 *  - o servidor (`GET /maquinas/:id/remover/previa`, `POST /maquinas/:id/remover`, ação `maquinas.remover`): os bots de
 *    lá passam para o próximo computador padrão (ou esperam), e o computador sai da conta, a não ser que fique ligado;
 *  - a ponte do app (`window.nodDesktop.removerDaqui`): o que se apaga NESTE computador (Windows: `nod-motor desinstalar`;
 *    Mac: as IAs que o app instalou e as contas), com um item por coisa feita, para a tela de Fim conferir;
 *  - a puxada do motor (`remover` junto de `desconectar`): o computador ligado que foi removido por outro lugar (outra
 *    tela, o chat) roda a mesma limpeza sozinho.
 */

/** As duas opções do diálogo. `manterIas` = a caixa "Tirar também…" DESLIGADA; `manterConexao` = "Continuar ligado". */
export type OpcoesRemover = { manterIas: boolean; manterConexao: boolean };

/** Quem assume os bots: o computador que vira (ou já é) o padrão; null = ninguém, eles esperam um computador. */
export type AssumeBots = { id: string; nome: string } | null;

/** O que o diálogo precisa para escrever o texto de verdade (web/telas/maquinas.ts, textoDeRemover). */
export type PreviaRemoverDto = {
  id: string;
  nome: string;
  plataforma: string | null;
  online: boolean;
  /** É o computador padrão da pessoa hoje. */
  ehPadrao: boolean;
  /** Os nomes dos bots que rodam aqui (os presos a ele e, se ele é o padrão, os que seguem o padrão). */
  bots: string[];
  assume: AssumeBots;
};

/**
 * A resposta do POST e o resultado da ação. `aguardandoComputador`: estava ligado e vai se limpar na próxima puxada.
 * `saiuDaConta`: a chave foi revogada (false com manterConexao).
 */
export type ResultadoRemoverDto = { ok: true; nome: string; bots: string[]; assume: AssumeBots; saiuDaConta: boolean; aguardandoComputador: boolean };

/** O pedido de limpeza que viaja na puxada do motor (src/contracts/contas-ia.ts). */
export type PedidoRemoverNaPuxada = OpcoesRemover;

/** Um passo do que o app fez neste computador; `mantido` = a pessoa pediu para ficar. */
export type ItemRemocao = { id: "parou" | "programa" | "ias" | "conta"; texto: string; estado: "feito" | "falhou" | "mantido" };
export type ResultadoRemoverDaqui = { itens: ItemRemocao[] };

/**
 * Os métodos na ponte (NodDesktop e a ponte do Windows). Opcionais: o app instalado antes da ADA-245 não tem, e a web
 * confere antes de oferecer "Remover o nod deste computador".
 *  - qual é "este computador" vem da ponte `estaMaquina` da ADA-243 (desktop-esta-maquina.ts), a mesma da jornada B;
 *  - removerDaqui: a limpeza local, ANTES do POST no servidor (com a conexão ainda valendo, para o logout das contas);
 *    o POST vai depois com `daqui: true`. Resolve com os itens para a tela de Fim;
 *  - fecharAposRemover: o "Fechar" da tela de Fim. No Windows encerra o app (e tira o próprio app de Aplicativos);
 *    no Mac não existe, e a tela volta para Computadores. Resolve true quando encerra; false quando a limpeza não rodou
 *    aqui (a tela volta para Computadores em vez de ficar presa; revisão do PR #694).
 */
export type PonteRemoverDesktop = {
  removerDaqui?(opcoes: OpcoesRemover): Promise<ResultadoRemoverDaqui>;
  fecharAposRemover?(): Promise<boolean>;
};

/** Os canais IPC da ponte (como CANAIS_DESKTOP, que mora em desktop.ts no teto de 200 linhas). */
export const CANAIS_REMOVER = { removerDaqui: "nod:remover:daqui", fecharAposRemover: "nod:remover:fechar" } as const;

/** As palavras que não aparecem nas três telas (critério 7 da spec). */
export const JARGAO_PROIBIDO_REMOVER = /motor|m[áa]quina|chave|parear/i;
