import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnexoMeta } from "../../../src/contracts/anexo.ts";
import { baixarAnexos, entradaCodex, mensagemClaude, TEXTO_ANEXO_MAX, type AnexoBaixado } from "../../../src/adapters/executor/anexos-turno.ts";
import { montarArgs } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { argsCodex } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

const meta = (id: string, mime: AnexoMeta["mime"], nome = id): AnexoMeta => ({ id, nome, mime, tamanho: 3 });
const png: AnexoBaixado = { meta: meta("a1", "image/png", "print.png"), bytes: new Uint8Array([1, 2, 3]) };
const pdf: AnexoBaixado = { meta: meta("a2", "application/pdf", "contrato.pdf"), bytes: new Uint8Array([4, 5, 6]) };
const md: AnexoBaixado = { meta: meta("a3", "text/markdown", "notas.md"), bytes: new TextEncoder().encode("# Reunião\nprazo dia 10") };
const falhou: AnexoBaixado = { meta: meta("a4", "image/png", "sumiu.png"), bytes: null };

describe("entrada do Claude com anexos (stream-json)", () => {
  it("texto + imagem + PDF + arquivo de texto viram blocos, numa linha só", () => {
    const linha = mensagemClaude("compare", [png, pdf, md]);
    expect(linha.endsWith("\n")).toBe(true);
    expect(linha.trimEnd().includes("\n")).toBe(false);
    const o = JSON.parse(linha) as { type: string; message: { role: string; content: { type: string; text?: string; source?: { media_type: string; data: string } }[] } };
    expect(o).toMatchObject({ type: "user", message: { role: "user" } });
    expect(o.message.content.map((b) => b.type)).toEqual(["text", "image", "document", "text"]);
    expect(o.message.content[1]?.source).toEqual({ type: "base64", media_type: "image/png", data: "AQID" });
    expect(o.message.content[2]?.source?.media_type).toBe("application/pdf");
    expect(o.message.content[3]?.text).toContain('Arquivo anexado "notas.md":\n# Reunião');
  });

  it("ADR-111: o anexo de uma fala anterior chega dito como anterior — texto no cabeçalho, imagem com a linha antes", () => {
    const o = JSON.parse(mensagemClaude("e aí?", [{ ...md, meta: { ...md.meta, anterior: true } }, { ...png, meta: { ...png.meta, anterior: true } }])) as { message: { content: { type: string; text?: string }[] } };
    expect(o.message.content.map((b) => b.type)).toEqual(["text", "text", "text", "image"]);
    expect(o.message.content[1]?.text).toContain('Arquivo anexado antes nesta conversa (não nesta mensagem) "notas.md":\n# Reunião');
    expect(o.message.content[2]?.text).toBe('[o arquivo "print.png" a seguir foi anexado antes nesta conversa, não nesta mensagem]');
  });

  it("anexo que não desceu vira aviso escrito, nunca some", () => {
    const o = JSON.parse(mensagemClaude("", [falhou])) as { message: { content: { type: string; text: string }[] } };
    expect(o.message.content).toEqual([{ type: "text", text: '[anexo "sumiu.png" não pôde ser lido: falha ao baixar do servidor. Diga isso à pessoa.]' }]);
  });

  it("arquivo de texto grande é cortado e marcado", () => {
    const grande: AnexoBaixado = { meta: meta("g", "text/plain", "log.txt"), bytes: new TextEncoder().encode("x".repeat(TEXTO_ANEXO_MAX + 50)) };
    const o = JSON.parse(mensagemClaude("", [grande])) as { message: { content: { text: string }[] } };
    expect(o.message.content[0]?.text).toContain("[cortado pelo nod: 50 caracteres ficaram de fora]");
  });

  it("montarArgs só liga --input-format stream-json quando pedido", () => {
    const plano = planoHarness();
    expect(montarArgs({ plano, mcpJson: "{}", sessaoNova: () => "s" }).args).not.toContain("--input-format");
    const { args } = montarArgs({ plano, mcpJson: "{}", sessaoNova: () => "s", streamJson: true });
    expect(args.slice(args.indexOf("--input-format"), args.indexOf("--input-format") + 2)).toEqual(["--input-format", "stream-json"]);
  });
});

describe("entrada do Codex com anexos", () => {
  it("imagem vira arquivo do turno com --image antes do '-'; texto no prompt; PDF vira aviso", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-anexos-"));
    try {
      const e = await entradaCodex("veja", [png, pdf, md], dir);
      expect(e.imagens).toHaveLength(1);
      expect(new Uint8Array(await readFile(e.imagens[0]!))).toEqual(png.bytes);
      expect(e.texto).toContain("veja");
      expect(e.texto).toContain('Arquivo anexado "notas.md"');
      expect(e.texto).toContain('[anexo "contrato.pdf" não pôde ser lido: o Codex não lê PDF. Diga isso à pessoa.]');
      const args = argsCodex(planoHarness(), "{}", e.imagens);
      expect(args.slice(-3)).toEqual(["--image", e.imagens[0], "-"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("baixarAnexos", () => {
  it("pede cada anexo na rota interna com o token do turno; resposta não-ok vira bytes nulos", async () => {
    const pedidos: { url: string; auth: string | null }[] = [];
    const fetchFalso: typeof fetch = async (url, init) => {
      pedidos.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return String(url).endsWith("/a1") ? new Response(new Uint8Array([9, 9])) : new Response("{}", { status: 404 });
    };
    const plano = { ...planoHarness({ anexos: [meta("a1", "image/png"), meta("a2", "application/pdf")] }), tokenDeTurno: "tok" };
    const r = await baixarAnexos(plano, "http://nod/", fetchFalso);
    expect(pedidos).toEqual([{ url: "http://nod/api/interno/anexos/a1", auth: "Bearer tok" }, { url: "http://nod/api/interno/anexos/a2", auth: "Bearer tok" }]);
    expect(r.map((a) => a.bytes && [...a.bytes])).toEqual([[9, 9], null]);
  });
});
