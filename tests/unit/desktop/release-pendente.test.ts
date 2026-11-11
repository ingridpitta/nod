import { describe, expect, it } from "vitest";
import { decidirAviso, PREFIXO_TITULO } from "../../../scripts/desktop/release-pendente.mjs";

/** O aviso de versão mergeada sem release do app do Mac: abre uma issue por versão e fecha quando a release sai. */
const repo = "marlonwlv/nod";
const rc8 = { tag: "desktop-v0.4.0-rc.8", rascunho: false, url: "https://github.com/marlonwlv/nod/releases/tag/desktop-v0.4.0-rc.8", publicadaEm: "2026-10-12T16:02:41Z" };
const rc7 = { tag: "desktop-v0.4.0-rc.7", rascunho: false, url: "https://github.com/marlonwlv/nod/releases/tag/desktop-v0.4.0-rc.7", publicadaEm: "2026-10-11T04:30:08Z" };
const rc9 = { tag: "desktop-v0.4.0-rc.9", rascunho: false, url: "https://github.com/marlonwlv/nod/releases/tag/desktop-v0.4.0-rc.9", publicadaEm: "2026-10-13T13:40:00Z" };
const issue = (numero: number, versao: string) => ({ numero, titulo: `${PREFIXO_TITULO} ${versao}` });

describe("release-pendente.mjs", () => {
  it("versão sem release abre a issue, com o comando e o que entra desde a última publicada", () => {
    const { abrir, fechar } = decidirAviso({ versao: "0.4.0-rc.9", repo, releases: [rc7, rc8], issuesAbertas: [] });
    expect(fechar).toEqual([]);
    expect(abrir?.titulo).toBe("Release do app do Mac pendente: 0.4.0-rc.9");
    expect(abrir?.corpo).toContain("git tag v0.4.0-rc.9 <sha-da-main> && git push origin v0.4.0-rc.9");
    expect(abrir?.corpo).toContain("https://github.com/marlonwlv/nod/blob/main/.github/workflows/desktop-release.yml");
    expect(abrir?.corpo).not.toContain("release:mac");
    expect(abrir?.corpo).toContain("https://github.com/marlonwlv/nod/compare/desktop-v0.4.0-rc.8...main");
  });

  it("a issue da mesma versão já aberta não duplica", () => {
    expect(decidirAviso({ versao: "0.4.0-rc.9", repo, releases: [rc8], issuesAbertas: [issue(310, "0.4.0-rc.9")] })).toEqual({ abrir: null, fechar: [] });
  });

  it("release publicada fecha a issue com o link", () => {
    const { abrir, fechar } = decidirAviso({ versao: "0.4.0-rc.9", repo, releases: [rc8, rc9], issuesAbertas: [issue(310, "0.4.0-rc.9")] });
    expect(abrir).toBeNull();
    expect(fechar).toEqual([{ numero: 310, comentario: `Publicada: ${rc9.url}` }]);
  });

  it("a release assinada pelo CI (tag v*) também conta como publicada", () => {
    const assinada = { tag: "v0.4.0", rascunho: false, url: "https://github.com/marlonwlv/nod/releases/tag/v0.4.0", publicadaEm: "2026-10-20T10:00:00Z" };
    expect(decidirAviso({ versao: "0.4.0", repo, releases: [rc9, assinada], issuesAbertas: [] })).toEqual({ abrir: null, fechar: [] });
  });

  it("rascunho não conta como publicada, e a issue aponta o rascunho", () => {
    const rascunho = { ...rc9, rascunho: true, url: "https://github.com/marlonwlv/nod/releases/tag/untagged-1", publicadaEm: null };
    const { abrir } = decidirAviso({ versao: "0.4.0-rc.9", repo, releases: [rc8, rascunho], issuesAbertas: [] });
    expect(abrir?.corpo).toContain("Já existe um rascunho dessa versão: https://github.com/marlonwlv/nod/releases/tag/untagged-1");
  });

  it("a versão subiu de novo sem release: fecha a issue antiga e abre a nova", () => {
    const { abrir, fechar } = decidirAviso({ versao: "0.4.0-rc.10", repo, releases: [rc8], issuesAbertas: [issue(310, "0.4.0-rc.9")] });
    expect(abrir?.titulo).toBe("Release do app do Mac pendente: 0.4.0-rc.10");
    expect(fechar).toEqual([{ numero: 310, comentario: "Substituída pela 0.4.0-rc.10: a versão subiu antes desta release sair." }]);
  });

  it("issues que não são do aviso ficam de fora", () => {
    const outra = { numero: 99, titulo: "Release do servidor quebrou" };
    expect(decidirAviso({ versao: "0.4.0-rc.9", repo, releases: [rc9], issuesAbertas: [outra] })).toEqual({ abrir: null, fechar: [] });
  });
});
