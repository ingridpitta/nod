import { describe, expect, it } from "vitest";
import { aparaUrl, lerLink, linkComNome, nomeDoLink, partesDoEndereco } from "../../../web/lib/links.ts";

const nome = (url: string, agora?: Date) => nomeDoLink(lerLink(url)!, agora);
const dois = (n: number) => String(n).padStart(2, "0");

/** ADR-053, conforme o canvas "Links nas mensagens" (L3 e L5). */
describe("o que vira link", () => {
  it("só http e https, e nunca com usuário e senha no endereço", () => {
    expect(lerLink("https://zoom.us/pricing")?.hostname).toBe("zoom.us");
    expect(lerLink("http://intranet.acme.local/presencas")).not.toBeNull();
    expect(lerLink("javascript:alert(1)")).toBeNull();
    expect(lerLink("file:///Users/marlon/nod/Ada/checklist.html")).toBeNull();
    expect(lerLink("mailto:ada@acme.com.br")).toBeNull();
    expect(lerLink("https://github.com@github-login.co/entrar")).toBeNull();
    expect(lerLink("isso não é endereço")).toBeNull();
  });

  it("a pontuação da frase fica fora do link; o parêntese do próprio endereço fica dentro", () => {
    expect(aparaUrl("https://zoom.us/pricing).")).toBe("https://zoom.us/pricing");
    expect(aparaUrl("https://zoom.us/pricing,")).toBe("https://zoom.us/pricing");
    expect(aparaUrl("https://pt.wikipedia.org/wiki/Zoom_(software)")).toBe("https://pt.wikipedia.org/wiki/Zoom_(software)");
  });
});

describe("o nome curto de cada link", () => {
  it("Slack: a hora sai do próprio link; de outro dia, a data", () => {
    const ts = 1790624332;
    const d = new Date(ts * 1000);
    const url = `https://acme-workspace.slack.com/archives/D068V6P6R5X/p${ts}178009`;
    expect(nome(url, new Date((ts + 60) * 1000))).toEqual({ icone: "slack", rotulo: `Slack · mensagem das ${dois(d.getHours())}:${dois(d.getMinutes())}`, app: true });
    expect(nome(url, new Date((ts + 3 * 86400) * 1000)).rotulo).toBe(`Slack · mensagem de ${dois(d.getDate())}/${dois(d.getMonth() + 1)}`);
    expect(nome("https://acme-workspace.slack.com/archives/C04ABCD1234").rotulo).toBe("Slack · canal");
    expect(nome("https://acme-workspace.slack.com/archives/D068V6P6R5X").rotulo).toBe("Slack · conversa");
  });

  it("ClickUp, GitHub, Google, Linear pelo que o endereço diz", () => {
    expect(nome("https://app.clickup.com/t/86b4x2qd")).toEqual({ icone: "clickup", rotulo: "ClickUp · tarefa 86b4x2qd", app: true });
    expect(nome("https://app.clickup.com/t/9011234567/ABC-123").rotulo).toBe("ClickUp · tarefa ABC-123");
    expect(nome("https://github.com/acme/backoffice/pull/466").rotulo).toBe("backoffice #466");
    expect(nome("https://github.com/acme/backoffice/issues/470").rotulo).toBe("backoffice #470");
    expect(nome("https://github.com/marlonwlv/nod/commit/23b25df0a1b2c3").rotulo).toBe("nod · 23b25df");
    expect(nome("https://github.com/acme-edtech/acme").rotulo).toBe("acme-edtech/acme");
    expect(nome("https://docs.google.com/document/d/1Xk9pQ/edit")).toEqual({ icone: "google", rotulo: "Google Docs · documento", app: true });
    expect(nome("https://linear.app/acme/issue/nod-123/links-clicaveis").rotulo).toBe("NOD-123");
    expect(nome("https://app.notion.com/p/Presencas-1a2b3c").rotulo).toBe("Notion · página");
    expect(nome("https://www.notion.so/acme/Presencas-1a2b3c").rotulo).toBe("Notion · página");
    expect(nome("https://notion.com.golpe.site/p/x").icone).toBe("web");
  });

  it("site comum: domínio sem www, o começo do caminho e … quando algo ficou de fora", () => {
    expect(nome("https://www.gov.br/mec")).toEqual({ icone: "web", rotulo: "gov.br/mec", app: false });
    expect(nome("https://zoom.us/pricing").rotulo).toBe("zoom.us/pricing");
    expect(nome("https://support.zoom.com/hc/pt/article?id=zm_kb&sysparm_article=KB0060429").rotulo).toBe("support.zoom.com/hc/pt/article…");
    expect(nome("https://developers.zoom.us/docs/api/meetings/#tag/reports").rotulo).toBe("developers.zoom.us/docs/api/meetings…");
    expect(nome("https://developers.zoom.us/docs/internal-apps/s2s-oauth/").rotulo).toBe("developers.zoom.us/docs/internal-apps…");
  });

  it("o domínio nunca é cortado, mesmo longo", () => {
    const host = "um-dominio-muito-comprido-de-verdade.exemplo.com.br";
    expect(nome(`https://${host}/caminho/qualquer`).rotulo).toBe(`${host}…`);
  });

  it("sem https: cadeado aberto; endereço do Mac: computador", () => {
    expect(nome("http://intranet.acme.local/presencas")).toEqual({ icone: "inseguro", rotulo: "intranet.acme.local/presencas", app: false });
    expect(nome("http://acme.slack.com/archives/C1").icone).toBe("inseguro");
    expect(nome("http://localhost:5274")).toEqual({ icone: "local", rotulo: "localhost:5274", app: false });
  });

  it("caractere invisível no caminho não disfarça o nome", () => {
    const rlo = encodeURIComponent(String.fromCodePoint(0x202e));
    expect(nome(`https://exemplo.com/${rlo}fdp.exe`).rotulo).toBe("exemplo.com/fdp.exe");
  });
});

describe("link com nome", () => {
  it("app: ícone e o nome na frase; site comum: o domínio ao lado", () => {
    const slack = linkComNome("resposta dela", lerLink("https://acme-workspace.slack.com/archives/D068V6P6R5X/p1790624332178009")!);
    expect(slack).toContain('class="lk"');
    expect(slack).toContain("lk-ic-slack");
    expect(slack).toContain(">resposta dela</a>");
    expect(slack).not.toContain("lk-dominio");
    const site = linkComNome("relatório de participantes", lerLink("https://developers.zoom.us/docs/api/meetings/")!);
    expect(site).toContain('<span class="lk-dominio">developers.zoom.us</span>');
  });

  it("nome que parece endereço dá lugar ao destino real", () => {
    const html = linkComNome("github.com/acme/backoffice", lerLink("https://github-login.co/entrar")!);
    expect(html).toContain('class="lk-chip"');
    expect(html).toContain("github-login.co/entrar");
    expect(html).not.toContain("github.com/acme/backoffice");
    expect(linkComNome("https://github.com", lerLink("https://outro.site/")!)).not.toContain("github.com");
  });

  it("o nome é texto: HTML no nome não vira elemento", () => {
    expect(linkComNome('<img src=x onerror="alert(1)">', lerLink("https://exemplo.com/")!)).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("a dica do link", () => {
  it("mostra o endereço inteiro, com o que vem depois do ?", () => {
    expect(partesDoEndereco("https://support.zoom.com/hc/pt/article?id=zm_kb&sysparm_article=KB0060429")).toEqual({ host: "support.zoom.com", resto: "/hc/pt/article?id=zm_kb&sysparm_article=KB0060429", seguro: true });
    expect(partesDoEndereco("http://localhost:5274/")).toEqual({ host: "localhost:5274", resto: "", seguro: false });
    expect(partesDoEndereco("javascript:alert(1)")).toBeNull();
  });
});
