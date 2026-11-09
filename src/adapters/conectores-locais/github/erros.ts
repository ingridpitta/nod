import type { JeitoGithub } from "../../../contracts/github.ts";

/**
 * Falhas que a pessoa (e o modelo) conseguem resolver, cada uma com a frase do que fazer. Vira
 * resultado de ferramenta com isError — nunca erro JSON-RPC, que o cliente trataria como queda do
 * conector e respawnaria à toa. `falha` é o resto: sem detalhe do provedor, que pode ecoar o token.
 */
export type CodigoErroGithub = "gh_ausente" | "sem_login" | "sem_permissao" | "nao_encontrado" | "movido" | "limite" | "falha";

export class ErroGithub extends Error {
  readonly codigo: CodigoErroGithub;
  readonly jeito: JeitoGithub;
  constructor(codigo: CodigoErroGithub, jeito: JeitoGithub) {
    super(codigo);
    this.name = "ErroGithub";
    this.codigo = codigo;
    this.jeito = jeito;
  }
}

export function mensagemErroGithub(e: ErroGithub): string {
  switch (e.codigo) {
    case "gh_ausente":
      return "O GitHub CLI (gh) não está instalado nesta máquina. Instale o gh e rode `gh auth login` nesta máquina, ou conecte o GitHub por outro jeito no Marketplace.";
    case "sem_login":
      return e.jeito === "gh"
        ? "O gh desta máquina não está logado: rode `gh auth login` nesta máquina e tente de novo."
        : e.jeito === "app"
          ? "O GitHub recusou a credencial do GitHub App da organização: confira o app id, a instalação e a chave privada."
          : e.jeito === "token"
            ? "O GitHub recusou o token pessoal: gere outro e cole no campo avançado do GitHub no Marketplace."
            : "O Composio recusou o login do GitHub: refaça a conexão no Marketplace.";
    case "sem_permissao":
      return "Sem permissão neste repositório: a conta conectada não tem esse acesso (ou o token não tem o escopo). Não tente outro caminho; diga à pessoa qual acesso falta.";
    case "nao_encontrado":
      return "Repositório, pull request, issue ou arquivo não encontrado. Se o repositório é privado, a conta conectada pode não ter acesso a ele.";
    case "movido":
      return "O repositório foi renomeado ou transferido: confira o dono/nome atual no GitHub e chame de novo com ele.";
    case "limite":
      return "O GitHub limitou as chamadas desta conta por agora (rate limit). Tente mais tarde.";
    case "falha":
      return "O GitHub não respondeu como esperado. Tente de novo em instantes.";
  }
}

/** Status HTTP da API do GitHub → código; usado pelo backend REST e pelo `gh api` (que imprime "(HTTP 404)"). */
export function codigoDoStatus(status: number, semCota = false): CodigoErroGithub {
  if (status === 401) return "sem_login";
  if (status === 403 || status === 429) return semCota || status === 429 ? "limite" : "sem_permissao";
  if (status === 404 || status === 410) return "nao_encontrado";
  if (status === 301 || status === 302 || status === 307 || status === 308) return "movido";
  return "falha";
}
