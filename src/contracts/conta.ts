/**
 * NOD-345 (ADR-124): o que as rotas `/api/conta/*` devolvem à web. A sessão nunca vem no corpo (vai no cookie); `trocaApp`
 * é o código de uso único que só o app do Mac usa (troca pela chave do espaço novo).
 */
export type ContagemEspacoDto = { bots: number; conversas: number; mensagens: number; rotinas: number; artefatos: number };

export type EstadoContaDto = {
  conta: { email: string; senha: boolean; google: boolean } | null;
  escolha: { email: string; espaco: ContagemEspacoDto } | null;
  verificando: { email: string } | null;
  /** Pessoa de antes das contas (ADR-030, e-mail do login em `pessoas`), sem conta: não é provisória; tem sessões e "Sair". */
  legado?: { email: string } | null;
};

export type ComTrocaApp = { trocaApp: string | null };

export type CadastroDto = { enviado: boolean; email: string };
export type VerificarDto = { resultado: "convertida"; email: string } | { resultado: "escolher"; email: string } | { resultado: "errado"; restantes: number } | { resultado: "vencido" } | { resultado: "pelo_google"; email: string };
export type EntrarDto = ({ resultado: "entrou" } & ComTrocaApp) | { resultado: "escolher"; email: string } | { resultado: "recusado" };
export type ImportarDto = ({ resultado: "importado"; contagem: ContagemEspacoDto } & ComTrocaApp) | { resultado: "falhou" };
export type RedefinirDto = ({ resultado: "trocada" } & ComTrocaApp) | { resultado: "escolher"; email: string } | { resultado: "invalido" };
export type TrocarSenhaDto = { resultado: "trocada" | "recusado"; encerradas: number };
export type SessaoContaDto = { id: string; origem: "web" | "maquina"; aparelho: string; criadaEm: number; ultimoUsoEm: number; revogadaEm: number | null };
export type SessoesDto = { atual: string; sessoes: SessaoContaDto[] };
export type EstadoPareamentoDto = "aguardando" | "pedido" | "confirmado" | "recusado" | "usado" | "trocado";
export type PareamentoAbertoDto = { estado: EstadoPareamentoDto; aparelho: string | null; simbolos: string[] | null; expiraEm: number } | null;
export type PedirPareamentoDto = { resultado: "pedido"; simbolos: string[] } | { resultado: "invalido" };
export type EsperaPareamentoDto = { estado: "esperando" | "recusado" | "vencido" } | { estado: "escolher"; email: string } | ({ estado: "entrou" } & ComTrocaApp);
