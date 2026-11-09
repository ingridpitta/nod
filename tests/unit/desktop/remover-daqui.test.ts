import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removerDaquiNoMac, TEXTO_NAO_SAIU_NO_MAC, type DepsRemoverDaqui } from "../../../desktop/remover-daqui.ts";
import { CANAIS_REMOVER, JARGAO_PROIBIDO_REMOVER } from "../../../src/contracts/remover-computador.ts";

const BASE = "/Users/ana/Library/Application Support/nod/ferramentas";

function montar(o: { existem?: string[]; apagarFalha?: string[]; logoutOk?: boolean; desligarFalha?: boolean } = {}) {
  const passos: string[] = [];
  const existem = new Set((o.existem ?? []).map((ia) => join(BASE, ia)));
  const d: DepsRemoverDaqui = {
    baseDasIas: BASE,
    existe: async (c) => existem.has(c),
    apagar: async (c) => {
      passos.push(`apagar ${c.slice(BASE.length + 1)}`);
      if ((o.apagarFalha ?? []).some((ia) => c === join(BASE, ia))) throw new Error("EPERM");
    },
    sairDasContas: async () => { passos.push("sair"); return o.logoutOk ?? true; },
    desligar: async () => { passos.push("desligar"); if (o.desligarFalha) throw new Error("x"); },
    parar: async () => { passos.push("parar"); },
  };
  return { d, passos };
}

describe("ADA-245: remover o nod deste Mac (remover-daqui.ts)", () => {
  it("tudo: sai das contas ANTES de apagar as IAs (o logout usa o binário), desliga e só apaga as IAs do app", async () => {
    const { d, passos } = montar({ existem: ["claude-cli", "codex-cli"] });
    const r = await removerDaquiNoMac({ manterIas: false, manterConexao: false }, d);
    expect(passos).toEqual(["sair", "desligar", "apagar claude-cli", "apagar codex-cli"]);
    expect(r.itens.map((i) => [i.id, i.estado])).toEqual([["parou", "feito"], ["ias", "feito"], ["conta", "feito"]]);
    expect(r.itens[1]!.texto).toBe("Claude e ChatGPT instalados pelo nod foram removidos");
    expect(r.itens[2]!.texto).toBe("Este computador saiu da sua conta");
  });

  it("'Continuar ligado' e sem a caixa das IAs: para o nod deste Mac (revisão do PR #694), mas não sai das contas, não apaga a conexão nem as IAs", async () => {
    const { d, passos } = montar({ existem: ["claude-cli"] });
    const r = await removerDaquiNoMac({ manterIas: true, manterConexao: true }, d);
    expect(passos).toEqual(["parar"]);
    expect(r.itens.map((i) => [i.id, i.estado])).toEqual([["parou", "feito"], ["ias", "mantido"], ["conta", "mantido"]]);
  });

  it("IAs que o app não instalou ficam; só a que ele instalou sai", async () => {
    const vazio = montar();
    expect((await removerDaquiNoMac({ manterIas: false, manterConexao: true }, vazio.d)).itens).toEqual([
      { id: "parou", estado: "feito", texto: "Parou de rodar neste computador" },
      { id: "ias", estado: "feito", texto: "Não havia IAs instaladas pelo nod neste computador" },
      { id: "conta", estado: "mantido", texto: "Continua ligado à sua conta" },
    ]);
    expect(vazio.passos).toEqual(["parar"]);
    const so = montar({ existem: ["codex-cli"] });
    const r = await removerDaquiNoMac({ manterIas: false, manterConexao: true }, so.d);
    // Parar ANTES de apagar: um turno em curso não segura nem recria o binário que sai.
    expect(so.passos).toEqual(["parar", "apagar codex-cli"]);
    expect(r.itens[1]!.texto).toBe("ChatGPT instalado pelo nod foi removido");
  });

  it("falhas viram itens 'falhou' com o que fazer, e a remoção segue", async () => {
    const { d } = montar({ existem: ["claude-cli", "codex-cli"], apagarFalha: ["claude-cli"], logoutOk: false });
    const r = await removerDaquiNoMac({ manterIas: false, manterConexao: false }, d);
    expect(r.itens.find((i) => i.id === "ias")).toEqual({ id: "ias", estado: "falhou", texto: `Não deu para remover Claude. Apague à mão em ${BASE}` });
    expect(r.itens.find((i) => i.id === "conta")).toEqual({ id: "conta", estado: "falhou", texto: TEXTO_NAO_SAIU_NO_MAC });
    const semDesligar = montar({ desligarFalha: true });
    const r2 = await removerDaquiNoMac({ manterIas: true, manterConexao: false }, semDesligar.d);
    expect(r2.itens.map((i) => [i.id, i.estado])).toEqual([["ias", "mantido"], ["conta", "falhou"]]);
  });

  it("nenhum texto tem jargão", async () => {
    const casos = [montar({ existem: ["claude-cli"], apagarFalha: ["claude-cli"], logoutOk: false }), montar({ existem: ["codex-cli"] }), montar({ desligarFalha: true })];
    for (const { d } of casos) {
      for (const o of [{ manterIas: false, manterConexao: false }, { manterIas: true, manterConexao: true }]) {
        for (const i of (await removerDaquiNoMac(o, d)).itens) expect(i.texto).not.toMatch(JARGAO_PROIBIDO_REMOVER);
      }
    }
  });

  it("a ponte do Mac expõe removerDaqui (sem fecharAposRemover; o estaMaquina é o da ADA-243) e o main valida remetente e opções", () => {
    const preload = readFileSync("desktop/preload-web.ts", "utf8");
    expect(preload).toContain("ipcRenderer.invoke(CANAIS_DESKTOP.estaMaquina)");
    expect(preload).not.toContain("CANAIS_REMOVER.estaMaquina");
    expect(preload).toContain("ipcRenderer.invoke(CANAIS_REMOVER.removerDaqui,");
    expect(preload).not.toMatch(/^\s+fecharAposRemover:/m);
    const main = readFileSync("desktop/main.ts", "utf8");
    for (const canal of ["removerDaqui"] as const) {
      const i = main.indexOf(`ipcMain.handle(CANAIS_REMOVER.${canal},`);
      expect(i, canal).toBeGreaterThan(0);
      expect(main.slice(i, i + 300)).toContain("validarRemetenteWeb(e)");
    }
    expect(main).toContain("lerOpcoesRemover(opcoes)");
    expect(main).not.toContain("CANAIS_REMOVER.fecharAposRemover");
    expect(CANAIS_REMOVER.removerDaqui).toBe("nod:remover:daqui");
  });
});
