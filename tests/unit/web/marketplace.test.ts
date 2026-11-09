import { FALHA_APP } from "../../../web/lib/conexao.ts";
import { describe, expect, it } from "vitest";
import type { Conector } from "../../../src/contracts/conector.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { renderConectores } from "../../../web/telas/conectores.ts";

const APPS = [
  { slug: "clickup", nome: "ClickUp", descricao: "Tarefas e prazos.", categoria: "Projetos", logo: null },
  { slug: "slack", nome: "Slack", descricao: "Conversas.", categoria: "Comunicação", logo: null },
  { slug: "gmail", nome: "Gmail", descricao: "E-mails.", categoria: "Comunicação", logo: null },
];
const conector = (slug: string, p: Partial<Conector> = {}): Conector => ({
  tenantId: "t", id: `c-${slug}`, ownerId: "p", visibility: "privado", nome: slug, slug, transporte: "http", comando: null, args: [], url: "https://x/mcp", env: {}, declaracao: "toca",
  habilitado: true, catalogo: [{ nome: `${slug.toUpperCase()}_LER`, descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }, { nome: `${slug.toUpperCase()}_CRIAR`, descricao: "", schema: {}, readOnlyHint: false, grupo: "criar" }],
  sondadoEm: 100, ultimaFalha: null, criadoEm: 0, ...p,
});
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Milton", titulo: "PM", descricao: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true } as never;

const base: Estado = {
  ...estadoInicial,
  agora: 10_000,
  sessao: { tenantId: "t", pessoaId: "p" },
  tela: { tipo: "conectores" },
  frota: { agentes: [agente], negacoes: [] } as never,
  marketplace: APPS,
  composioConfigurado: true,
  conectores: [conector("slack"), conector("gmail", { ultimaFalha: { motivo: "timeout_transporte", em: 200 } })],
  concessoes: { a1: [{ tenantId: "t", id: "g1", agenteId: "a1", conectorId: "c-slack", capacidade: "SLACK_LER", criadoEm: 0 } as never] },
};

describe("marketplace (revisto em 2026-09-25)", () => {
  it("um estado e UMA ação por app; 'Conectar' do cartão já abre o login; o resto do cartão abre a gaveta", () => {
    const html = renderConectores(base);
    expect(html).toContain('data-act="conectar-app" data-id="clickup">Conectar</button>');
    expect(html).toContain('data-act="abrir-app" data-id="clickup"');
    expect(html).not.toContain("Verificar conexão");
    expect(html).not.toContain("Refazer conexão");
    expect(html).toContain("Milton usa");
  });

  it("app com falha mais nova que a sonda vai para 'Precisam de atenção' com 'Entrar de novo', nunca com ✓", () => {
    const html = renderConectores(base);
    expect(html).toContain("O Gmail parou de responder");
    expect(html).toContain('data-act="conectar-app" data-id="gmail">Entrar de novo');
    expect(html).toMatch(/id="app-gmail">[\s\S]*?Precisa de atenção/);
  });

  it("nada técnico na grade: chave do Composio, MCP próprio e catálogo cru ficam na tela avançada", () => {
    const html = renderConectores(base);
    expect(html).not.toContain("SLACK_LER");
    expect(html).not.toContain("configurar-composio");
    expect(html).toContain('data-act="abrir-avancado"');
    const avancado = renderConectores({ ...base, tela: { tipo: "conectores", avancado: true } });
    expect(avancado).toContain('data-form="configurar-composio"');
    expect(avancado).toContain('data-form="registrar-conector"');
    expect(avancado).toContain("SLACK_LER");
  });

  it("conectando: o cartão espera sozinho, com Cancelar", () => {
    const html = renderConectores({ ...base, conectando: { clickup: { url: "https://login/x", falhou: null } } });
    expect(html).toMatch(/id="app-clickup">[\s\S]*?Conectando[\s\S]*?Esperando você entrar no ClickUp/);
    expect(html).toContain('data-act="cancelar-conexao" data-id="clickup"');
  });

  it("NOD-208 (critério 5): sonda falhou em todas → o cartão segue com a frase e 'Tentar de novo'", () => {
    const html = renderConectores({ ...base, conectando: { clickup: { url: "https://login/x", falhou: FALHA_APP } } });
    expect(html).toMatch(/id="app-clickup">[\s\S]*?O login deu certo, mas o app não respondeu\.[\s\S]*?data-act="conectar-app" data-id="clickup">Tentar de novo/);
  });

  it("conectando sem janela monitorável (desktop, pop-up bloqueado, re-sonda): o cartão e a gaveta mantêm 'Abrir o login'", () => {
    const sem = { clickup: { url: "https://login/x", falhou: null, semJanela: true } };
    const cartao = renderConectores({ ...base, conectando: sem });
    expect(cartao).toMatch(/id="app-clickup">[\s\S]*?Esperando você entrar no ClickUp[\s\S]*?<a class="link" href="https:\/\/login\/x" target="_blank" rel="noopener noreferrer">Abrir o login /);
    const gaveta = renderConectores({ ...base, conectando: sem, tela: { tipo: "conectores", gaveta: { slug: "clickup", passo: "detalhes" } } });
    expect(gaveta).toContain("Se a janela de login não abriu, use o link. Quando terminar, isto continua sozinho.");
    expect(gaveta).toContain('href="https://login/x" target="_blank" rel="noopener noreferrer">Abrir o login ');
    expect(gaveta).not.toContain("O navegador não abriu a janela de login.");
    expect(gaveta).not.toContain("A janela de login está aberta.");
  });

  it("antes da URL (inclusive os até 20 s da re-sonda da NOD-208, sem janela nenhuma): a gaveta não diz que a janela está aberta", () => {
    const gaveta = renderConectores({ ...base, conectando: { clickup: { url: null, falhou: null } }, tela: { tipo: "conectores", gaveta: { slug: "clickup", passo: "detalhes" } } });
    expect(gaveta).toContain("Preparando o login do ClickUp.");
    expect(gaveta).not.toContain("A janela de login está aberta.");
    const comUrl = renderConectores({ ...base, conectando: { clickup: { url: "https://login/x", falhou: null } }, tela: { tipo: "conectores", gaveta: { slug: "clickup", passo: "detalhes" } } });
    expect(comUrl).toContain("A janela de login está aberta.");
  });

  it("login feito: a gaveta abre em 'Quem pode usar' com Nenhum / Ler / Ler e alterar por bot, o nível atual marcado", () => {
    const html = renderConectores({ ...base, tela: { tipo: "conectores", gaveta: { slug: "slack", passo: "quem-usa" } } });
    expect(html).toContain("Quem pode usar o Slack?");
    expect(html).toContain('class="seg ativo" data-act="nivel-bot" data-id="a1" data-conector="c-slack" data-nivel="leitura"');
    expect(html).toContain('data-nivel="escrita"');
    expect(html).toContain('data-act="fechar-gaveta">Pronto');
  });

  it("gaveta de app não conectado explica o que libera e tem o próprio Conectar", () => {
    const html = renderConectores({ ...base, tela: { tipo: "conectores", gaveta: { slug: "clickup", passo: "detalhes" } } });
    expect(html).toContain("O que os bots podem fazer");
    expect(html).toContain('data-act="conectar-app" data-id="clickup">Conectar ClickUp');
  });

  it("sem o Composio do time, a grade avisa e leva à tela avançada", () => {
    expect(renderConectores({ ...base, composioConfigurado: false })).toContain("o Composio do time precisa estar configurado");
  });
});

describe("o ‹ de volta no topo do Marketplace (definido em 2026-10-04)", () => {
  it("vindo da conversa, volta para o bot: o nome com o mascote e o Esc, como em Seu espaço", () => {
    const html = renderConectores({ ...base, tela: { tipo: "conectores", voltar: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } } });
    expect(html).toMatch(/<button type="button" class="tela-voltar" data-act="voltar-conexao" aria-keyshortcuts="Escape" title="Voltar para Milton \(Esc\)">[\s\S]*?class="icon[^"]*sm[\s\S]*?<span>Milton<\/span><\/button><kbd>esc<\/kbd>/);
    expect(html).not.toContain("Voltar para a conversa");
  });

  it("vindo de outra tela, diz o nome dela; sem origem, não há botão", () => {
    expect(renderConectores({ ...base, tela: { tipo: "conectores", voltar: { tipo: "nao-lidos" } } })).toContain("<span>Não lidos</span>");
    expect(renderConectores(base)).not.toContain('data-act="voltar-conexao"');
  });

  it("a gaveta aberta e o filtro não apagam a origem", () => {
    const html = renderConectores({ ...base, tela: { tipo: "conectores", filtro: "conectados", gaveta: { slug: "slack", passo: "detalhes" }, voltar: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } } });
    expect(html).toContain('title="Voltar para Milton (Esc)"');
  });
});
