import { EventEmitter } from "node:events";
import { linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ARQUIVO_LOG, ARQUIVO_LOG_ANTERIOR, criarArquivoDeLog, escreverDiagnostico, instalarOuvintesDeQueda, lerCaudaDoLog, registroDeQueda } from "../../../desktop/diagnostico.ts";
import type { CamposLog } from "../../../src/obs/log.ts";

/** Log local e diagnóstico do app do Mac (definido em 2026-10-05, NOD-138), num diretório temporário. */
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "nod-diag-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const modo = (p: string) => statSync(p).mode & 0o777;
const linha = (i: number, tam = 100) => JSON.stringify({ evento: `ev_${i}`, x: "a".repeat(tam) });

describe("criarArquivoDeLog", () => {
  it("cria nod.log com modo 0600, uma linha por chamada", () => {
    const gravar = criarArquivoDeLog({ dir: join(dir, "logs"), maxBytes: 4096 });
    gravar(linha(1)); gravar(linha(2));
    const p = join(dir, "logs", ARQUIVO_LOG);
    expect(modo(p)).toBe(0o600);
    expect(readFileSync(p, "utf8")).toBe(`${linha(1)}\n${linha(2)}\n`);
  });

  it("um nod.log existente com outro modo volta a 0600", () => {
    writeFileSync(join(dir, ARQUIVO_LOG), "velho\n", { mode: 0o644 });
    criarArquivoDeLog({ dir, maxBytes: 4096 })(linha(1));
    expect(modo(join(dir, ARQUIVO_LOG))).toBe(0o600);
  });

  it("ao passar de maxBytes gira para nod.1.log e o total fica ≤ 2 × maxBytes", () => {
    const maxBytes = 2048;
    const gravar = criarArquivoDeLog({ dir, maxBytes });
    for (let i = 0; i < 200; i++) gravar(linha(i));
    const atual = statSync(join(dir, ARQUIVO_LOG)).size;
    const anterior = statSync(join(dir, ARQUIVO_LOG_ANTERIOR)).size;
    expect(atual).toBeLessThanOrEqual(maxBytes);
    expect(anterior).toBeLessThanOrEqual(maxBytes);
    expect(anterior).toBeGreaterThan(0);
    expect(readFileSync(join(dir, ARQUIVO_LOG), "utf8").trim().split("\n").at(-1)).toBe(linha(199));
  });

  it("rotação tolera o nod.log sumido no meio (ENOENT) e uma linha maior que a geração vira aviso", () => {
    const gravar = criarArquivoDeLog({ dir, maxBytes: 300 });
    gravar(linha(1));
    rmSync(join(dir, ARQUIVO_LOG));
    expect(() => gravar(linha(2, 250))).not.toThrow();
    gravar("x".repeat(1000));
    expect(readFileSync(join(dir, ARQUIVO_LOG), "utf8")).toContain("log_linha_descartada");
  });

  it("nod.log trocado por symlink: não escreve no alvo (lança, e o log() engole)", () => {
    const alvo = join(dir, "alvo.txt");
    writeFileSync(alvo, "intacto");
    symlinkSync(alvo, join(dir, ARQUIVO_LOG));
    expect(() => criarArquivoDeLog({ dir, maxBytes: 4096 })(linha(1))).toThrow();
    expect(readFileSync(alvo, "utf8")).toBe("intacto");
  });

  it("nod.log como hardlink: não escreve", () => {
    const alvo = join(dir, "alvo.txt");
    writeFileSync(alvo, "intacto");
    linkSync(alvo, join(dir, ARQUIVO_LOG));
    expect(() => criarArquivoDeLog({ dir, maxBytes: 4096 })(linha(1))).toThrow("log_recusado");
    expect(readFileSync(alvo, "utf8")).toBe("intacto");
  });
});

describe("lerCaudaDoLog", () => {
  it("junta as duas gerações (a anterior antes) e respeita o teto, sem linha parcial", () => {
    writeFileSync(join(dir, ARQUIVO_LOG_ANTERIOR), [1, 2, 3].map((i) => linha(i)).join("\n") + "\n");
    writeFileSync(join(dir, ARQUIVO_LOG), [4, 5].map((i) => linha(i)).join("\n") + "\n");
    expect(lerCaudaDoLog(dir, 1_000_000)).toBe([1, 2, 3, 4, 5].map((i) => linha(i)).join("\n") + "\n");
    const teto = Buffer.byteLength(linha(1)) * 3 + 10;
    const cauda = lerCaudaDoLog(dir, teto);
    expect(Buffer.byteLength(cauda)).toBeLessThanOrEqual(teto);
    expect(cauda).toBe([3, 4, 5].map((i) => linha(i)).join("\n") + "\n");
  });

  it("log ausente, vazio ou só nod.1.log: devolve o que houver", () => {
    expect(lerCaudaDoLog(join(dir, "nada"), 1000)).toBe("");
    writeFileSync(join(dir, ARQUIVO_LOG_ANTERIOR), "antiga\n");
    expect(lerCaudaDoLog(dir, 1000)).toBe("antiga\n");
    writeFileSync(join(dir, ARQUIVO_LOG), "");
    expect(lerCaudaDoLog(dir, 1000)).toBe("antiga\n");
  });

  it("nod.log como symlink ou hardlink não é lido (cauda vazia)", () => {
    const alvo = join(dir, "segredo.txt");
    writeFileSync(alvo, "conteúdo de outro arquivo\n");
    writeFileSync(join(dir, ARQUIVO_LOG_ANTERIOR), "antiga\n");
    symlinkSync(alvo, join(dir, ARQUIVO_LOG));
    expect(lerCaudaDoLog(dir, 1000)).toBe("");
    rmSync(join(dir, ARQUIVO_LOG));
    linkSync(alvo, join(dir, ARQUIVO_LOG));
    expect(lerCaudaDoLog(dir, 1000)).toBe("");
  });
});

describe("escreverDiagnostico", () => {
  it("grava com 0600, inclusive sobre um arquivo existente", () => {
    const p = join(dir, "d.txt");
    writeFileSync(p, "velho velho velho", { mode: 0o644 });
    escreverDiagnostico(p, "novo");
    expect(readFileSync(p, "utf8")).toBe("novo");
    expect(modo(p)).toBe(0o600);
  });

  it("recusa um destino que é symlink ou hardlink e não toca o alvo", () => {
    const alvo = join(dir, "alvo.txt");
    writeFileSync(alvo, "intacto");
    symlinkSync(alvo, join(dir, "link.txt"));
    expect(() => escreverDiagnostico(join(dir, "link.txt"), "x")).toThrow();
    linkSync(alvo, join(dir, "duro.txt"));
    expect(() => escreverDiagnostico(join(dir, "duro.txt"), "x")).toThrow("destino_recusado");
    expect(readFileSync(alvo, "utf8")).toBe("intacto");
  });

  it("pasta inexistente lança (o main mostra a mensagem de erro)", () => {
    expect(() => escreverDiagnostico(join(dir, "nao", "existe.txt"), "x")).toThrow();
    expect(existsSync(join(dir, "nao"))).toBe(false);
  });
});

describe("registroDeQueda", () => {
  it("janela morta: metadados da união fechada; motivo fora da lista vira desconhecido", () => {
    expect(registroDeQueda({ tipo: "janela", principal: true, motivo: "killed", codigo: 9 })).toEqual({ processo: "janela", superficie: "janela_principal", motivo: "killed", codigo_saida: 9 });
    expect(registroDeQueda({ tipo: "janela", principal: false, motivo: "https://x/?token=1", codigo: "9" })).toEqual({ processo: "janela", superficie: "auxiliar", motivo: "desconhecido", codigo_saida: null });
  });

  it("clean-exit não é queda", () => {
    expect(registroDeQueda({ tipo: "janela", principal: true, motivo: "clean-exit", codigo: 0 })).toBeNull();
    expect(registroDeQueda({ tipo: "processo_filho", processo: "GPU", motivo: "clean-exit", codigo: 0 })).toBeNull();
  });

  it("processo filho: tipo fora da lista vira desconhecido", () => {
    expect(registroDeQueda({ tipo: "processo_filho", processo: "GPU", motivo: "crashed", codigo: 133 })).toEqual({ processo: "processo_filho", processo_tipo: "GPU", motivo: "crashed", codigo_saida: 133 });
    expect(registroDeQueda({ tipo: "processo_filho", processo: "/Users/ana/x", motivo: "oom", codigo: 1 })).toMatchObject({ processo_tipo: "desconhecido" });
  });

  it("erro do processo principal devolve só o nome da classe, nunca a mensagem", () => {
    const r = registroDeQueda({ tipo: "principal", origem: "uncaughtException", erro: new TypeError("sk-ant-segredo em /Users/ana") });
    expect(r).toEqual({ processo: "principal", origem: "uncaughtException", erro: "TypeError" });
    class ErroMeu extends Error { override name = "ErroComDado ana@x.com"; }
    expect(registroDeQueda({ tipo: "principal", origem: "outra", erro: new ErroMeu("x") })).toEqual({ processo: "principal", origem: "uncaughtException", erro: "Error" });
    expect(registroDeQueda({ tipo: "principal", origem: "unhandledRejection", erro: null })).toMatchObject({ erro: "Error" });
  });
});

describe("instalarOuvintesDeQueda", () => {
  it("registra janela, filho e principal; ignora tudo durante o encerramento; o desligar solta os ouvintes", () => {
    const app = new EventEmitter();
    const processo = new EventEmitter();
    const registros: CamposLog[] = [];
    let encerrando = false;
    const principal = {};
    const soltar = instalarOuvintesDeQueda({ app, processo, registrar: (c) => registros.push(c), encerrando: () => encerrando, ehJanelaPrincipal: (c) => c === principal });
    app.emit("render-process-gone", {}, principal, { reason: "killed", exitCode: 9 });
    app.emit("child-process-gone", {}, { type: "Utility", reason: "crashed", exitCode: 1, name: "Audio Service" });
    processo.emit("uncaughtExceptionMonitor", new RangeError("dado"), "uncaughtException");
    app.emit("render-process-gone", {}, {}, { reason: "clean-exit", exitCode: 0 });
    expect(registros).toEqual([
      { processo: "janela", superficie: "janela_principal", motivo: "killed", codigo_saida: 9 },
      { processo: "processo_filho", processo_tipo: "Utility", motivo: "crashed", codigo_saida: 1 },
      { processo: "principal", origem: "uncaughtException", erro: "RangeError" },
    ]);
    encerrando = true;
    app.emit("render-process-gone", {}, principal, { reason: "crashed", exitCode: 1 });
    expect(registros).toHaveLength(3);
    soltar();
    expect(app.listenerCount("render-process-gone") + app.listenerCount("child-process-gone") + processo.listenerCount("uncaughtExceptionMonitor")).toBe(0);
  });
});
