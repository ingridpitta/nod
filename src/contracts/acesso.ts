/**
 * Pedido de acesso JÁ NORMALIZADO pelo domínio (src/domain/pedido-acesso.ts): slug conferido,
 * capacidades do catálogo sondado, nível honesto e o que NÃO foi pedido. `conectar` = o app ainda
 * não está conectado e habilitado; a pessoa conecta antes de haver o que conceder.
 */
export type AcessoPedido = {
  conector: string;
  capacidades: string[];
  nivel: "leitura" | "escrita";
  naoPedido: string[];
  conectar?: true;
  /** definido em 2026-09-25: para que o agente quer o acesso, em uma linha ("Para listar as tarefas atrasadas"). */
  para?: string;
};

/**
 * O que `pedir_acesso` devolve ao MODELO (definido em 2026-09-24, ADR-044). Com `{proposta_id}`
 * sozinho o agente e a pessoa entendiam que o acesso já estava dado; a instrução é literal para o
 * modelo dizer que PEDIU e encerrar, em vez de anunciar uma concessão que não houve.
 */
export type ResultadoPedirAcesso =
  | {
    proposta_id: string;
    estado: "aguardando_pessoa";
    instrucao: "o acesso ainda NÃO foi concedido: diga que pediu e encerre o turno";
  }
  // ADR-059: o modo do bot concedeu na hora. A ferramenta nova só entra no catálogo do PRÓXIMO turno, que
  // já está na fila: este turno encerra e a tarefa retoma sozinha.
  | {
    proposta_id: string;
    estado: "concedido";
    instrucao: "o acesso foi concedido pela aprovação automática: encerre o turno agora; a tarefa retoma sozinha com a ferramenta nova";
  };
