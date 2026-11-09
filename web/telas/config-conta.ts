import { nesteAparelho } from "../lib/aparelho.ts";
import { ehCelular } from "../lib/celular.ts";
import { ICONE } from "../lib/icones.ts";
import { grupoConfig, linhaConfig } from "../lib/linha-config.ts";
import { esc } from "../lib/render.ts";
import { iniciaisDeQuem } from "./menu-conta.ts";

/**
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): Configurações › Conta, a primeira seção. Quem você é (o perfil)
 * e como você entra (e-mail, senha, sessões, outro computador), seus dados e, por último, Sair e Excluir conta. As rotas
 * são as de antes: com NOD_MINHA_CONTA, perfil, e-mail, exportar e excluir abrem a página de Minha conta (NOD-346) dentro
 * da seção, com "‹ Conta" para voltar; senha, sessões, outro computador e Sair abrem o cartão da conta na conversa do Nod
 * (NOD-345), como o menu fazia. Sem contas no servidor, só a identificação.
 */
export type DadosConta = {
  /** Servidor com contas (NOD-345); false = só a identificação. */
  contas: boolean;
  /** Minha conta ligada (NOD-346): perfil, exportar e excluir. */
  minhaConta: boolean;
  nome: string | null;
  email: string | null;
  /** A conta tem senha (sem ela, entra pelo Google ou por código). */
  senha: boolean;
  /** Conta de antes das contas (entrou pelo Google da lista): sem senha nem pareamento. */
  legado: boolean;
  /** A exclusão já programada (Minha conta diz). */
  excluirEm?: string | null;
};

const pagina = (aba: string, passo = "") => ({ aba, ...(passo ? { passo } : {}) });

export function renderConta(d: DadosConta, celular = ehCelular()): string {
  const quem = d.nome ?? d.email ?? "Você";
  const av = `<span class="mc-av mc-av-g" aria-hidden="true">${esc(iniciaisDeQuem(d.nome, d.email))}</span>`;
  const cab = `<h2>Conta</h2><p class="intro">Quem você é no nod e como você entra.</p>`;
  const perfil = linhaConfig({
    titulo: quem,
    detalhe: d.minhaConta ? "Nome, foto e o Sobre mim que seus bots leem" : d.nome && d.email ? d.email : "",
    icone: av,
    classe: "cfg-perfil",
    ...(d.minhaConta ? { controle: { tipo: "link" as const, acao: "cfg-conta-pagina", dados: pagina("perfil") } } : {}),
  });
  if (!d.contas) return `<section class="espaco-secao cfg-secao cfg-conta">${cab}${grupoConfig(null, [perfil])}</section>`;
  // Espaço provisório: ainda não há conta; o convite fica no lugar de "Como você entra".
  if (d.email === null) {
    return `<section class="espaco-secao cfg-secao cfg-conta">${cab}${grupoConfig(null, [perfil])}${grupoConfig("Como você entra", [
      linhaConfig({ titulo: "Criar conta ou entrar", detalhe: `Seu espaço está só ${nesteAparelho(celular)}`, icone: ICONE.pessoa, controle: { tipo: "link", acao: "cfg-conta", dados: { conta: "inicio" } } }),
    ])}</section>`;
  }
  const entra: string[] = [
    linhaConfig({
      titulo: "E-mail",
      detalhe: d.email,
      status: { texto: "Verificado", tom: "ok" },
      ...(d.minhaConta && !d.legado ? { controle: { tipo: "link" as const, acao: "cfg-conta-pagina", dados: pagina("acesso", "email") } } : {}),
    }),
  ];
  if (!d.legado) {
    entra.push(linhaConfig({
      titulo: "Senha",
      detalhe: d.senha ? "Trocar a senha de entrada" : "Você entra pelo Google ou por um código no e-mail",
      ...(d.senha ? { status: { texto: "Definida", tom: "ok" as const } } : {}),
      ...(d.senha ? { controle: { tipo: "link" as const, acao: "cfg-conta", dados: { conta: "senha" } } } : {}),
    }));
  }
  entra.push(linhaConfig({ titulo: "Sessões", detalhe: "Onde sua conta está aberta agora", controle: { tipo: "link", acao: "cfg-conta", dados: { conta: "sessoes" } } }));
  if (!d.legado) {
    entra.push(linhaConfig({
      titulo: "Conectar outro computador",
      detalhe: "Abre sua conta em outro computador com um código. Para um bot trabalhar lá, use Máquinas.",
      controle: { tipo: "link", acao: "cfg-conta", dados: { conta: "parear-gerar" } },
    }));
  }
  const dados = d.minhaConta
    ? grupoConfig("Seus dados", [linhaConfig({
      titulo: "Exportar meus dados",
      detalhe: "Uma cópia de conversas, bots, memórias e rotinas. Senhas e chaves nunca entram.",
      controle: { tipo: "link", acao: "cfg-conta-pagina", dados: pagina("dados") },
    })])
    : "";
  const fim = [
    linhaConfig({ titulo: "Sair", detalhe: `Encerra a sessão ${nesteAparelho(celular)}; seus bots continuam trabalhando`, icone: ICONE.sair, controle: { tipo: "link", acao: "cfg-conta", dados: { conta: "sair" } } }),
    ...(d.minhaConta && !d.legado
      ? [linhaConfig({
        titulo: "Excluir conta",
        detalhe: d.excluirEm ? `Exclusão programada para ${d.excluirEm}` : "Você tem 30 dias para desfazer; depois, tudo é apagado",
        icone: ICONE.lixo,
        perigo: true,
        controle: { tipo: "link", acao: "cfg-conta-pagina", dados: pagina("dados", "excluir") },
      })]
      : []),
  ];
  return `<section class="espaco-secao cfg-secao cfg-conta">${cab}${grupoConfig(null, [perfil])}${grupoConfig("Como você entra", entra)}${dados}${grupoConfig(null, fim)}</section>`;
}

/** A página de Minha conta dentro da seção, com o caminho de volta para a lista. */
export function renderContaPagina(minhaConta: string): string {
  return `<section class="espaco-secao cfg-secao cfg-conta cfg-conta-pagina">
    <button type="button" class="cfg-voltar" data-act="cfg-conta-voltar">${ICONE.voltar}<span>Conta</span></button>
    ${minhaConta}
  </section>`;
}
