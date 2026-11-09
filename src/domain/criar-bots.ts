import { MAX_BOTS_POR_PEDIDO, TETO_DESCRICAO_BOT, TETO_NOME_BOT, TETO_SECAO_BOT, TETO_TITULO_BOT, type BotNovo, type ProblemaBotNovo } from "../contracts/ferramentas-criar-bots.ts";
import { chaveDoNome, nomeReservadoAoNod } from "./nod.ts";
import { NOME_INICIAL } from "./proposta-agente.ts";

export { chaveDoNome };

/**
 * criar_bots (definido em 2026-10-13, NOD-210, ADR-104): a validação do pedido inteiro e os textos do desfecho. Puro:
 * quem chama passa os nomes dos bots que já existem e o `agora`. Qualquer problema e nada é criado — o modelo recebe a
 * lista e chama de novo com o pedido corrigido.
 */

/** O nome como fica gravado: NFKC, sem invisíveis de formato e com os espaços colapsados (a caixa a pessoa escolhe). */
function nomeLimpo(nome: string): string {
  return nome.normalize("NFKC").replace(/\p{Cf}/gu, "").trim().replace(/\s+/g, " ");
}

/** Caractere de controle (\u0000 derruba o insert no Postgres); na descrição, quebra de linha e tabulação valem. */
const CONTROLE = /\p{Cc}/u;
const CONTROLE_FORA_DE_LINHA = /[^\P{Cc}\n\r\t]/u;

export type BotNovoLimpo = { nome: string; titulo: string; descricao: string; secao: string | null };

export function validarBotsNovos(bots: readonly BotNovo[], nomesExistentes: readonly string[]): { ok: true; bots: BotNovoLimpo[] } | { ok: false; problemas: ProblemaBotNovo[] } {
  const problemas: ProblemaBotNovo[] = [];
  if (bots.length === 0) return { ok: false, problemas: [{ i: -1, motivo: "o pedido não tem nenhum bot" }] };
  if (bots.length > MAX_BOTS_POR_PEDIDO) return { ok: false, problemas: [{ i: -1, motivo: `no máximo ${MAX_BOTS_POR_PEDIDO} bots por pedido; divida em mais de uma chamada` }] };
  const existentes = new Set(nomesExistentes.map(chaveDoNome));
  const vistos = new Map<string, number>();
  const limpos: BotNovoLimpo[] = [];
  bots.forEach((b, i) => {
    const nome = nomeLimpo(typeof b.nome === "string" ? b.nome : "");
    const titulo = (typeof b.titulo === "string" ? b.titulo : "").trim();
    const descricao = (typeof b.descricao === "string" ? b.descricao : "").trim();
    const secao = typeof b.secao === "string" && b.secao.trim() !== "" ? b.secao.trim() : null;
    const chave = chaveDoNome(nome);
    if (nome === "") problemas.push({ i, motivo: "nome vazio" });
    else if (nome.length > TETO_NOME_BOT) problemas.push({ i, motivo: `nome com mais de ${TETO_NOME_BOT} caracteres` });
    else if (CONTROLE.test(nome)) problemas.push({ i, motivo: "nome com caractere de controle" });
    else if (nomeReservadoAoNod(nome)) problemas.push({ i, motivo: "\"Nod\" é o nome do bot fixo; escolha outro" });
    else if (chave === chaveDoNome(NOME_INICIAL)) problemas.push({ i, motivo: `"${NOME_INICIAL}" é o nome de quem ainda não tem perfil; escolha outro` });
    else if (existentes.has(chave)) problemas.push({ i, motivo: `já existe um bot chamado "${nome}"; escolha outro nome` });
    else if (vistos.has(chave)) problemas.push({ i, motivo: `nome repetido no pedido (igual ao item ${vistos.get(chave)})` });
    if (titulo.length > TETO_TITULO_BOT) problemas.push({ i, motivo: `título com mais de ${TETO_TITULO_BOT} caracteres` });
    else if (CONTROLE.test(titulo)) problemas.push({ i, motivo: "título com caractere de controle" });
    if (descricao === "") problemas.push({ i, motivo: "descrição vazia: diga o que o bot faz" });
    else if (descricao.length > TETO_DESCRICAO_BOT) problemas.push({ i, motivo: `descrição com mais de ${TETO_DESCRICAO_BOT} caracteres` });
    else if (CONTROLE_FORA_DE_LINHA.test(descricao)) problemas.push({ i, motivo: "descrição com caractere de controle" });
    if (secao !== null && secao.length > TETO_SECAO_BOT) problemas.push({ i, motivo: `seção com mais de ${TETO_SECAO_BOT} caracteres` });
    else if (secao !== null && CONTROLE.test(secao)) problemas.push({ i, motivo: "seção com caractere de controle" });
    if (chave !== "" && !vistos.has(chave)) vistos.set(chave, i);
    limpos.push({ nome, titulo, descricao, secao });
  });
  return problemas.length > 0 ? { ok: false, problemas } : { ok: true, bots: limpos };
}

/** "A", "A e B", "A, B e C". */
export function listaDeNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** definido em 2026-10-13: a data do "Criado por" no fuso do produto (o mesmo da frase do limite, erro-fornecedor.ts). */
const FUSO_DA_CRIACAO = "America/Sao_Paulo";

/** "12/10" no fuso do produto. */
export function dataCurta(agora: number): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO_DA_CRIACAO }).format(new Date(agora));
}

/** A linha de sistema na conversa de quem pediu: "Nina criou 2 bots a pedido de Matheus: A e B." */
export function linhaDoDesfecho(quem: string, pessoa: string, nomes: readonly string[]): string {
  const n = nomes.length;
  return `${quem} criou ${n} ${n === 1 ? "bot" : "bots"} a pedido de ${pessoa}: ${listaDeNomes(nomes)}.`;
}

/** A primeira mensagem do bot novo: quem o criou, a pedido de quem, quando, e a missão. */
export function mensagemDeNascimento(p: { nome: string; quem: string; pessoa: string; agora: number; descricao: string }): string {
  return `Criado por ${p.quem} a pedido de ${p.pessoa} em ${dataCurta(p.agora)}. ${p.nome} está pronto; envie a primeira tarefa.\n\nO que ele faz: ${p.descricao}`;
}
