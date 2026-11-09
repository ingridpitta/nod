import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANAIS_REMOVER } from "../../../../src/contracts/remover-computador.ts";

/**
 * ADA-245 (jornada D): a ponte do Windows para o "Remover o nod deste computador". O main.ts é cola com o Electron (sem
 * teste de execução aqui); a limpeza é a de motor/desinstalar.ts (tests/unit/motor/desinstalar.test.ts). Aqui, as
 * garantias da cola: o que a ponte expõe, as guardas, o modo "app" e o que acontece depois.
 */
const main = readFileSync(new URL("../../../../desktop/windows/main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../../../../desktop/windows/preload-web-windows.ts", import.meta.url), "utf8");
const corpo = (canal: keyof typeof CANAIS_REMOVER) => {
  const i = main.indexOf(`ipcMain.handle(CANAIS_REMOVER.${canal},`);
  expect(i, canal).toBeGreaterThan(0);
  return main.slice(i, main.indexOf("\n    });", i));
};

describe("ADA-245: remover o nod deste computador no app do Windows", () => {
  it("a ponte expõe removerDaqui (só os dois booleanos) e fecharAposRemover; o estaMaquina é o da ADA-243", () => {
    expect(preload).toContain("estaMaquina: () => ipcRenderer.invoke(CANAIS_DESKTOP.estaMaquina)");
    expect(preload).not.toContain("CANAIS_REMOVER.estaMaquina");
    expect(preload).toContain("removerDaqui: (opcoes: OpcoesRemover) => ipcRenderer.invoke(CANAIS_REMOVER.removerDaqui, { manterIas: opcoes?.manterIas === true, manterConexao: opcoes?.manterConexao === true }),");
    expect(preload).toContain("fecharAposRemover: () => ipcRenderer.invoke(CANAIS_REMOVER.fecharAposRemover),");
  });

  it("removerDaqui valida as opções e roda a limpeza do motor no modo 'app', marcando que o motor saiu", () => {
    const r = corpo("removerDaqui");
    expect(r).toContain("const o = lerOpcoesRemover(opcoes);");
    expect(r).toContain('if (!o) throw new Error("entrada_invalida");');
    expect(r).toContain('desinstalar(o, depsDeVerdade({ modo: "app", pastaDaConexao: pastaMotor() }))');
    expect(r.indexOf("removido = true")).toBeLessThan(r.indexOf("desinstalar(o,"));
    // Nada spawna o nod-motor de dentro da pasta que sai.
    expect(r).not.toContain("nod-motor");
  });

  it("depois de remover, o vigia não religa a tarefa e o Abrir não reinstala o motor", () => {
    expect(main).toContain("if (ocupado || removido) return;");
    expect(main).toContain("if (conexao && !removido) void lerMotor();");
  });

  it("fecharAposRemover só age depois da remoção: desinstala o app em silêncio e encerra", () => {
    const f = corpo("fecharAposRemover");
    // Revisão do PR #694: sem remoção (a ponte recusou "ocupado"/entrada), devolve false e a tela de Fim volta a
    // Computadores; antes devolvia undefined e o Fechar não fazia nada (tela presa).
    expect(f).toContain("if (!removido) return false;");
    expect(f).toMatch(/app\.quit\(\);\s*return true;/);
    expect(f).toContain('join(dirname(process.execPath), "Uninstall nod.exe")');
    expect(f).toMatch(/spawn\(desinstalador, \["\/S"\], \{ detached: true, stdio: "ignore", windowsHide: true \}\)\.unref\(\)/);
    expect(f.indexOf("saindo = true;")).toBeLessThan(f.indexOf("app.quit();"));
  });
});
