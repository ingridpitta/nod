import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClienteNod } from "../../../src/adapters/executor/cliente-nod.ts";
import { anexarLinksDaFala, anexarMidias, PRAZO_ENVIO_MIDIA_MS, respostaAnexar } from "../../../src/adapters/executor/midia-local.ts";
import { criarProxy } from "../../../src/adapters/mcp-proxy/proxy.ts";
import { LIMITE_POR_FAMILIA, type CabecalhoMidia, type RecusasMidia } from "../../../src/contracts/anexo.ts";
import { FERRAMENTA_ANEXAR_MIDIA, FERRAMENTA_LER_MAIS } from "../../../src/contracts/ferramentas-proxy.ts";
import { planoDeTeste } from "../../helpers/l5.ts";
import { gif, mp4, pdf, png, svg } from "../../fixtures/midia/construir.ts";

/**
 * NOD-323 (ADR-126): `anexar_midia` lê o arquivo NA máquina, contra a pasta do bot do plano. Testado com fs real num
 * HOME temporário: symlink para fora, `..`, credencial, FIFO, pasta, vazio, grande demais (só o cartão), nova tentativa.
 */
let home: string;
let pasta: string;
type Enviado = { cabecalho: CabecalhoMidia; corpo: Uint8Array };

function clienteFalso(status: number[] = []) {
  const enviados: Enviado[] = [];
  const recusas: RecusasMidia[] = [];
  const fila = [...status];
  const cliente: Pick<ClienteNod, "midia" | "recusasMidia"> = {
    midia: async (cabecalho, corpo) => {
      enviados.push({ cabecalho, corpo });
      const s = fila.shift() ?? 201;
      if (s === 0) return { transporte: "servidor_fora", status: null };
      return { status: s, json: s < 300 ? { id: `id-${enviados.length}` } : { codigo: "x" } };
    },
    recusasMidia: async (r) => {
      recusas.push(r);
    },
  };
  return { cliente, enviados, recusas };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nod-midia-"));
  pasta = join(home, "nod", "Faustino");
  mkdirSync(join(pasta, "task-1"), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("anexar_midia na máquina (NOD-323)", () => {
  it("anexa png pelo caminho relativo e pelo ~/nod, com sha, medidas e caminho relativo à ~/nod", async () => {
    const bytes = png(640, 480);
    writeFileSync(join(pasta, "task-1", "grafico.png"), bytes);
    writeFileSync(join(pasta, "a.gif"), gif(10, 20));
    const { cliente, enviados, recusas } = clienteFalso();
    const r = await anexarMidias(["grafico.png", "~/nod/Faustino/a.gif"], { cliente, pastaDoBot: "Faustino/task-1", home });
    expect(r.recusados).toEqual([]);
    expect(r.anexados.map((a) => [a.nome, a.tipo])).toEqual([["grafico.png", "image/png"], ["a.gif", "image/gif"]]);
    expect(enviados[0]!.cabecalho).toMatchObject({ nome: "grafico.png", caminhoRelativo: "Faustino/task-1/grafico.png", mime: "image/png", largura: 640, altura: 480, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(enviados[0]!.corpo.byteLength).toBe(bytes.byteLength);
    expect(enviados[1]!.cabecalho.caminhoRelativo).toBe("Faustino/a.gif");
    expect(recusas).toEqual([]);
  });

  it("recusa fora da pasta, `..`, symlink para fora, credencial, inexistente, pasta, vazio, svg — sem enviar nada", async () => {
    const fora = join(home, "nod", "OutroBot");
    mkdirSync(fora, { recursive: true });
    writeFileSync(join(fora, "x.png"), png(1, 1));
    symlinkSync(join(fora, "x.png"), join(pasta, "atalho.png"));
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_ed25519"), png(1, 1));
    writeFileSync(join(pasta, "vazio.png"), "");
    writeFileSync(join(pasta, "x.svg"), svg());
    mkdirSync(join(pasta, "sub"));
    const { cliente, enviados, recusas } = clienteFalso();
    const r = await anexarMidias(
      ["~/nod/OutroBot/x.png", "../OutroBot/x.png", "atalho.png", "~/.ssh/id_ed25519", "nao-tem.png", "sub", "vazio.png", "x.svg", "/etc/passwd"],
      { cliente, pastaDoBot: "Faustino", home },
    );
    expect(r.anexados).toEqual([]);
    expect(r.recusados.map((x) => x.motivo)).toEqual(["fora_da_pasta", "fora_da_pasta", "fora_da_pasta", "credencial", "nao_existe", "nao_e_arquivo", "vazio", "tipo_nao_suportado", "fora_da_pasta"]);
    expect(r.recusados.every((x) => x.dica.length > 0 && !x.dica.includes(home))).toBe(true);
    expect(enviados).toEqual([]);
    expect(recusas[0]).toEqual(expect.arrayContaining([{ motivo: "fora_da_pasta", n: 4 }, { motivo: "credencial", n: 1 }]));
    expect(respostaAnexar(r).isError).toBe(true);
  });

  it("FIFO não trava a leitura e vira nao_e_arquivo", async () => {
    execFileSync("mkfifo", [join(pasta, "cano.png")]);
    const { cliente, enviados } = clienteFalso();
    const r = await anexarMidias(["cano.png"], { cliente, pastaDoBot: "Faustino", home });
    expect(r.recusados.map((x) => x.motivo)).toEqual(["nao_e_arquivo"]);
    expect(enviados).toEqual([]);
  });

  it("vídeo acima do limite vai sem bytes (só o cartão), com tamanho real e duração", async () => {
    const arq = join(pasta, "demo.mp4");
    writeFileSync(arq, mp4(1280, 720, 12_000));
    truncateSync(arq, LIMITE_POR_FAMILIA.video + 1);
    const { cliente, enviados } = clienteFalso();
    const r = await anexarMidias(["demo.mp4"], { cliente, pastaDoBot: "Faustino", home });
    expect(r.anexados.map((a) => a.tipo)).toEqual(["video/mp4"]);
    expect(enviados[0]!.corpo.byteLength).toBe(0);
    expect(enviados[0]!.cabecalho).toMatchObject({ tamanhoReal: LIMITE_POR_FAMILIA.video + 1, largura: 1280, altura: 720, duracaoMs: 12_000 });
  });

  it("o mesmo arquivo duas vezes sobe uma vez; 503 e servidor fora tentam de novo (até 4); 415/429 viram o motivo", async () => {
    writeFileSync(join(pasta, "a.pdf"), pdf());
    writeFileSync(join(pasta, "b.png"), png(2, 2));
    writeFileSync(join(pasta, "c.png"), png(3, 3));
    writeFileSync(join(pasta, "d.png"), png(4, 4));
    const { cliente, enviados } = clienteFalso([503, 201, 0, 0, 0, 0, 415, 429]);
    const r = await anexarMidias(["a.pdf", "./a.pdf", "b.png", "c.png", "d.png"], { cliente, pastaDoBot: "Faustino", home, dormir: async () => undefined });
    expect(r.anexados.map((a) => a.nome)).toEqual(["a.pdf"]);
    expect(r.recusados.map((x) => [x.caminho, x.motivo])).toEqual([["b.png", "falha_envio"], ["c.png", "tipo_nao_suportado"], ["d.png", "limite_por_turno"]]);
    expect(enviados).toHaveLength(8);
    expect(respostaAnexar(r).isError).toBe(false);
  });

  it("servidor ocupado: espera o retry-after entre as tentativas e sobe na 4ª (revisão 2 do #507, M2)", async () => {
    writeFileSync(join(pasta, "a.png"), png(2, 2));
    const esperas: number[] = [];
    let n = 0;
    const cliente: Pick<ClienteNod, "midia" | "recusasMidia"> = {
      midia: async () => (++n < 4 ? { status: 503, json: null, retryAposS: 3 } : { status: 201, json: { id: "ok" } }),
      recusasMidia: async () => undefined,
    };
    const r = await anexarMidias(["a.png"], { cliente, pastaDoBot: "Faustino", home, dormir: async (ms) => { esperas.push(ms); } });
    expect(r.anexados.map((a) => a.id)).toEqual(["ok"]);
    expect(esperas).toEqual([3000, 3000, 3000]);
  });

  it("cancelado (prazo da J6, turno parado): não lê nem envia o resto (revisão 2 do #507, M4)", async () => {
    writeFileSync(join(pasta, "a.png"), png(2, 2));
    writeFileSync(join(pasta, "b.png"), png(3, 3));
    const ctrl = new AbortController();
    const enviados: (AbortSignal | undefined)[] = [];
    const cliente: Pick<ClienteNod, "midia" | "recusasMidia"> = {
      midia: async (_c, _b, sinal) => { enviados.push(sinal); ctrl.abort(); return { transporte: "timeout", status: null }; },
      recusasMidia: async () => undefined,
    };
    const r = await anexarMidias(["a.png", "b.png"], { cliente, pastaDoBot: "Faustino", home, sinal: ctrl.signal, dormir: async () => undefined });
    expect(enviados).toEqual([ctrl.signal]);
    expect(r.recusados.map((x) => [x.caminho, x.motivo])).toEqual([["a.png", "falha_envio"], ["b.png", "falha_envio"]]);
  });

  it("passa de 10 por chamada: o excedente é recusado sem ler", async () => {
    for (let i = 0; i < 11; i++) writeFileSync(join(pasta, `${i}.png`), png(i + 1, 1));
    const { cliente, enviados } = clienteFalso();
    const r = await anexarMidias(Array.from({ length: 11 }, (_, i) => `${i}.png`), { cliente, pastaDoBot: "Faustino", home });
    expect(r.anexados).toHaveLength(10);
    expect(r.recusados.map((x) => x.motivo)).toEqual(["limite_por_turno"]);
    expect(enviados).toHaveLength(10);
  });
});

// Revisão do #507 (M1): um diretório do meio trocado por symlink na hora do open (e destrocado logo depois) faria o fd
// aberto ser de fora da pasta; o realpath de novo não vê, o lstat do caminho contra o fd vê.
describe("troca de diretório na janela do open (M1)", () => {
  it("abre fora por um instante e volta: recusa, sem enviar", async () => {
    const fora = mkdtempSync(join(tmpdir(), "nod-fora-"));
    writeFileSync(join(fora, "x.png"), png(1, 1));
    writeFileSync(join(pasta, "task-1", "x.png"), png(2, 2));
    const { cliente, enviados } = clienteFalso();
    const naJanela = async (fase: "antes" | "depois") => {
      if (fase === "antes") {
        renameSync(join(pasta, "task-1"), join(pasta, "guardada"));
        symlinkSync(fora, join(pasta, "task-1"));
      } else {
        unlinkSync(join(pasta, "task-1"));
        renameSync(join(pasta, "guardada"), join(pasta, "task-1"));
      }
    };
    const r = await anexarMidias(["task-1/x.png"], { cliente, pastaDoBot: "Faustino", home, naJanela });
    rmSync(fora, { recursive: true, force: true });
    expect(r.anexados).toEqual([]);
    expect(r.recusados.map((x) => x.motivo)).toEqual(["fora_da_pasta"]);
    expect(enviados).toEqual([]);
  });
  it("sem troca na janela, o mesmo caminho anexa", async () => {
    writeFileSync(join(pasta, "task-1", "x.png"), png(2, 2));
    const { cliente } = clienteFalso();
    const r = await anexarMidias(["task-1/x.png"], { cliente, pastaDoBot: "Faustino", home, naJanela: async () => undefined });
    expect(r.recusados).toEqual([]);
  });
});

describe("J6: links locais da fala viram anexo (NOD-323)", () => {
  it("![]() anexado sai do texto, [t]() vira nod-anexo:id, o de código e o que não anexou ficam", async () => {
    writeFileSync(join(pasta, "g.png"), png(5, 5));
    writeFileSync(join(pasta, "r.pdf"), pdf());
    const { cliente, enviados } = clienteFalso();
    const texto = "Pronto:\n\n![grafico](g.png)\n\nVeja [o relatório](./r.pdf) e ![x](nao-tem.png).\n\n```\n![g](g.png)\n```";
    const r = await anexarLinksDaFala(texto, { cliente, pastaDoBot: "Faustino", home });
    expect(enviados.map((e) => e.cabecalho.nome)).toEqual(["g.png", "r.pdf"]);
    expect(r).toBe("Pronto:\n\nVeja [o relatório](nod-anexo:id-2) e x.\n\n```\n![g](g.png)\n```");
    expect(r).not.toContain(home);
  });

  it("fala de código cheia de links para arquivos do projeto: nada sobe e nada vira recusa (M2)", async () => {
    mkdirSync(join(pasta, "src"));
    writeFileSync(join(pasta, "src", "x.ts"), "export {}");
    writeFileSync(join(pasta, "README.md"), "# oi");
    const { cliente, enviados, recusas } = clienteFalso();
    const texto = "Mudei [laco.ts](src/x.ts:120), [o README](README.md), [a ADR](docs/adr/a.md) e [o teste](tests/a.test.ts).";
    expect(await anexarLinksDaFala(texto, { cliente, pastaDoBot: "Faustino", home })).toBe(texto);
    expect(enviados).toEqual([]);
    expect(recusas).toEqual([]);
  });

  it("sem link local não chama ninguém", async () => {
    const { cliente, enviados } = clienteFalso();
    expect(await anexarLinksDaFala("veja [site](https://x.com) e ![](data:image/png;base64,AA)", { cliente, pastaDoBot: "Faustino", home })).toBe("veja [site](https://x.com) e ![](data:image/png;base64,AA)");
    expect(enviados).toEqual([]);
  });
});

describe("proxy despacha anexar_midia pelo nome (NOD-323)", () => {
  function montar() {
    const plano = planoDeTeste({ expiraEm: 10_000, pastaDoBot: "Faustino" });
    plano.catalogo = { ferramentas: [FERRAMENTA_LER_MAIS, FERRAMENTA_ANEXAR_MIDIA], servidores: [] };
    const { cliente: c, enviados } = clienteFalso();
    const ferramentas: string[] = [];
    const cliente: ClienteNod = {
      ...c,
      plano: async () => ({ ok: true, plano }),
      ferramenta: async (nome) => {
        ferramentas.push(nome);
        return { ok: true, conteudo: "", confianca: "confiavel" };
      },
      aguardar: async () => ({ estado: "pendente" }),
      negacao: async () => undefined,
      chamarFerramenta: async () => ({ conteudo: "", isError: false }),
    };
    return { proxy: criarProxy({ cliente, agora: () => 1, home }), enviados, ferramentas };
  }
  const rpc = async (proxy: ReturnType<typeof criarProxy>, id: number, method: string, params?: unknown) =>
    JSON.parse((await proxy.tratarLinha(JSON.stringify({ jsonrpc: "2.0", id, method, params })))!) as { result: { content: { text: string }[]; isError?: boolean } };

  it("anexa pelo proxy sem passar pelo /ferramentas; ler_mais segue sendo ler_mais", async () => {
    writeFileSync(join(pasta, "g.png"), png(5, 5));
    const { proxy, enviados, ferramentas } = montar();
    await rpc(proxy, 1, "initialize");
    const r = await rpc(proxy, 2, "tools/call", { name: "anexar_midia", arguments: { caminhos: ["g.png"] } });
    expect(JSON.parse(r.result.content[0]!.text)).toEqual({ anexados: [{ nome: "g.png", tipo: "image/png" }], recusados: [] });
    expect(r.result.isError).toBeUndefined();
    expect(enviados).toHaveLength(1);
    expect(ferramentas).toEqual([]);
    const lm = await rpc(proxy, 3, "tools/call", { name: "ler_mais", arguments: { ref: "r9" } });
    expect(lm.result.content[0]!.text).not.toContain("anexados");
    expect(enviados).toHaveLength(1);
  });

  it("pasta ou arquivo oculto e cara de env são recusados como credencial, sem enviar (QA 2 do #507)", async () => {
    mkdirSync(join(pasta, ".git"), { recursive: true });
    mkdirSync(join(pasta, ".env.d"), { recursive: true });
    for (const n of [".git/x.png", ".env.d/x.png", ".env.png", "png.env", ".oculto.png"]) writeFileSync(join(pasta, n), png(2, 2));
    const { cliente, enviados } = clienteFalso();
    const r = await anexarMidias([".git/x.png", ".env.d/x.png", ".env.png", "png.env", ".oculto.png"], { cliente, pastaDoBot: "Faustino", home });
    expect(r.recusados.map((x) => x.motivo)).toEqual(["credencial", "credencial", "credencial", "credencial", "credencial"]);
    expect(enviados).toHaveLength(0);
  });

  it("rede caída: espera crescente com jitter entre as tentativas e para no prazo total (revisão 3 do #507, M5)", async () => {
    writeFileSync(join(pasta, "a.png"), png(2, 2));
    writeFileSync(join(pasta, "b.png"), png(3, 3));
    const esperas: number[] = [];
    let relogio = 0;
    let n = 0;
    const cliente: Pick<ClienteNod, "midia" | "recusasMidia"> = {
      midia: async () => { n++; return { transporte: "servidor_fora", status: null }; },
      recusasMidia: async () => undefined,
    };
    const r = await anexarMidias(["a.png"], { cliente, pastaDoBot: "Faustino", home, aleatorio: () => 1, agora: () => relogio, dormir: async (ms) => { esperas.push(ms); } });
    expect(r.recusados.map((x) => x.motivo)).toEqual(["falha_envio"]);
    expect(esperas).toEqual([1000, 2000, 4000]);
    // Passou do prazo total: não tenta de novo.
    n = 0;
    const r2 = await anexarMidias(["b.png"], { cliente, pastaDoBot: "Faustino", home, aleatorio: () => 0, agora: () => relogio, dormir: async () => { relogio += PRAZO_ENVIO_MIDIA_MS + 1; } });
    expect(r2.recusados.map((x) => x.motivo)).toEqual(["falha_envio"]);
    expect(n).toBe(1);
  });
});
