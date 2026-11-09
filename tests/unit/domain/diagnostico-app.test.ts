import { describe, expect, it } from "vitest";
import { bytesUtf8, cortarCauda, montarDiagnostico, nomeArquivoDiagnostico, TETO_REGISTROS_BYTES, type EntradaDiagnostico } from "../../../src/domain/diagnostico-app.ts";
import { redigirSegredos } from "../../../src/domain/segredos.ts";
import { PRAZO_GUARDA, RAZAO_MAXIMA_LINEAR, razaoDeCrescimento } from "../../helpers/crescimento.ts";

/** Diagnóstico do app do Mac (definido em 2026-10-05, NOD-138): redige, depois corta; nada de chave, e-mail ou /Users/<nome>. */
const AGORA = Date.UTC(2026, 9, 5, 21, 7, 3);

function entrada(o: Partial<EntradaDiagnostico> = {}): EntradaDiagnostico {
  return {
    app: { versao: "0.4.0-rc.2", electron: "43.7.1", chrome: "142.0", node: "24.19.0", plataforma: "darwin", arquitetura: "arm64", versaoSistema: "14.6", empacotado: true, ligadoHaSegundos: 61.4 },
    conexao: { servidor: "https://nod.exemplo.com.br/caminho?x=1", conectado: true, maquinaId: "7d0c8a47-3a49-4f1e-9a0e-1c8a7e1d2f3b", status: "Conectado." },
    ia: [{ harness: "claude-cli", estado: "pronto", motivo: null, versao: "2.1.0" }, { harness: "codex-cli", estado: "ausente", motivo: "Instale o Codex", versao: null }],
    execucao: { conectado: true, lacoAtivo: true, sondandoIa: false, emLigacao: false, githubNoMac: true },
    preferencias: { avisos: true, tema: "sistema", som: true, avisosBloqueados: false },
    registros: "",
    ...o,
  };
}

/**
 * NOD-194: os testes que montam registros grandes (a guarda de crescimento e os de 6000 e 3000 linhas com segredo)
 * são CPU pura e sem relógio na asserção. medido em 2026-10-07: com o Mac em load ~950 (duas `test:unit` em
 * paralelo), 4–6 s cada, acima dos 5 s padrão do projeto unit. 30 s dá ~5x o pior medido; um laço infinito ainda falha.
 */
const PESADO = { timeout: 30_000 };
const linhaLog = (evento: string, extra = "") => `{"ts":"2026-10-05T21:00:00.000Z","nivel":"info","evento":"${evento}"${extra}}`;

describe("montarDiagnostico", () => {
  it("as sete seções aparecem na ordem e o servidor sai só como origem", () => {
    const t = montarDiagnostico(entrada({ registros: linhaLog("app_iniciado") }), AGORA);
    const ordem = ["## App", "## Conexão", "## IA neste Mac", "## Execução", "## Preferências", "## Quedas recentes", "## Registros recentes"].map((s) => t.indexOf(s));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(t).toContain("Servidor: https://nod.exemplo.com.br\n");
    expect(t).not.toContain("caminho");
    expect(t).toContain("Gerado em: 2026-10-05T21:07:03.000Z");
    expect(t).toContain("claude-cli: pronto (versão 2.1.0)");
    expect(t).toContain("codex-cli: ausente — Instale o Codex");
    expect(t).toContain("Som dos avisos: ligado\n");
  });

  it("usuario:senha na URL do servidor nunca sai", () => {
    const t = montarDiagnostico(entrada({ conexao: { servidor: "https://ana:segredo123@nod.exemplo.com", conectado: false, maquinaId: null, status: "" } }), AGORA);
    expect(t).toContain("Servidor: https://nod.exemplo.com\n");
    expect(t).not.toContain("ana");
    expect(t).not.toContain("segredo123");
  });

  const segredos: Array<[string, string]> = [
    ["Bearer abcdefghijklmnopqrstuv", "abcdefghijklmnopqrstuv"],
    ["sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA", "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA"],
    ["ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"],
    ["token=cccccccccccc", "cccccccccccc"],
  ];
  it.each(segredos)("%s em motivo, status e registros vira «redigido: N caracteres» com N correto", (cru, valor) => {
    const t = montarDiagnostico(entrada({
      conexao: { servidor: "https://nod.exemplo.com", conectado: true, maquinaId: "m", status: `falhou: ${cru}` },
      ia: [{ harness: "claude-cli", estado: "nao_autenticado", motivo: `erro ${cru}`, versao: null }],
      registros: `linha ${cru}\n`,
    }), AGORA);
    expect(t).not.toContain(valor);
    expect(t.split(`«redigido: ${valor.length} caracteres»`).length - 1).toBe(3);
  });

  it("/Users/<nome>/… vira ~/… e e-mail vira «e-mail»", () => {
    const t = montarDiagnostico(entrada({ registros: `${linhaLog("x", ',"caminho":"/Users/marlon/Library/Logs/nod"')}\nde ana.silva@exemplo.com\n` }), AGORA);
    expect(t).toContain('"caminho":"~/Library/Logs/nod"');
    expect(t).not.toContain("/Users/");
    expect(t).not.toContain("ana.silva");
    expect(t).toContain("«e-mail»");
  });

  it("caminho dentro de JSON aninhado mantém o escape, e /Users/ sozinho também sai", () => {
    const t = montarDiagnostico(entrada({ registros: `${linhaLog("x", ',"erro_cru":"cwd=\\"/Users/marlon\\" e /Users/ vazio"')}\n` }), AGORA);
    expect(t).toContain('cwd=\\"~\\" e ~ vazio');
    expect(t).not.toContain("/Users/");
  });

  it("segredo em JSON aninhado com aspa escapada não sai no diagnóstico (NOD-138, QA)", () => {
    const valores = ["tokAninhado987654", "segredoAninhado12345"];
    const corpo = JSON.stringify(JSON.stringify({ token: valores[0], password: valores[1] }));
    const t = montarDiagnostico(entrada({ registros: `${linhaLog("resposta", `,"corpo":${corpo}`)}\n` }), AGORA);
    for (const v of valores) expect(t).not.toContain(v);
    expect(t).toContain("«redigido: 17 caracteres»");
  });

  // A regex de e-mail sem teto levava ~33 s para anonimizar 256 KB sem @ nem /. NOD-194: a guarda mede o
  // crescimento (7 KB → 28 KB, o mesmo formato, linhas de 1000+ caracteres, bem acima do teto de 64) em tempo de
  // CPU, não o relógio de parede (< 3 s caía com o Mac em load ~950: 10–11 s de fila sem regressão).
  // medido em 2026-10-07 (load ~950): razão 4,0–4,4 com os tetos; 16,2–16,7 com os tetos de EMAIL e de /Users/
  // removidos ({1,64}/{1,63}→+, {0,8}→*, {0,255}→*). CPU pura, 4–5 s de relógio nesse load: por isso o PRAZO_GUARDA.
  it("anonimizar texto sem @ nem / cresce linear com o tamanho (a regex sem teto era quadrática)", PRAZO_GUARDA, () => {
    const registros = (n: number) => Array.from({ length: 6 }, () => "a.".repeat(n)).join("\n") + "\n" + "x".repeat(2 * n);
    const razao = razaoDeCrescimento(registros, (r) => montarDiagnostico(entrada({ registros: r }), AGORA), 500);
    expect(razao).toBeLessThan(RAZAO_MAXIMA_LINEAR);
  });

  it("os registros são cortados na borda de linha a ≤ 262 144 bytes DEPOIS da redação, sem pedaço de segredo", PESADO, () => {
    const segredo = "sk-ant-" + "Z".repeat(60);
    const linhas = Array.from({ length: 6000 }, (_, i) => linhaLog(`ev_${i}`, `,"erro":"Bearer ${"q".repeat(20)} e ${segredo} ção"`));
    const t = montarDiagnostico(entrada({ registros: linhas.join("\n") + "\n" }), AGORA);
    const registros = t.slice(t.indexOf("## Registros recentes")).split("\n").slice(1).filter((l) => l !== "");
    expect(bytesUtf8(registros.join("\n") + "\n")).toBeLessThanOrEqual(TETO_REGISTROS_BYTES);
    expect(registros.at(-1)).toContain('"evento":"ev_5999"');
    for (const l of registros) expect(() => JSON.parse(l)).not.toThrow();
    expect(t).not.toContain("ZZZZ");
    expect(t).not.toContain("qqqq");
  });

  it("redigir de novo o texto montado dá o mesmo texto, byte a byte", PESADO, () => {
    const registros = Array.from({ length: 3000 }, (_, i) => `l${i} senha=hunter2 Authorization: Basic dXN1YXJpbzpzZW5oYQ== ghp_${"x".repeat(36)} /Users/ana/x`).join("\n");
    const t = montarDiagnostico(entrada({ registros }), AGORA);
    expect(redigirSegredos(t)).toBe(t);
    expect(montarDiagnostico(entrada({ registros: t }), AGORA)).toContain("## Registros recentes");
  });

  it("seção vazia mostra (nada registrado); desconectado não quebra", () => {
    const t = montarDiagnostico(entrada({ ia: null, registros: "", execucao: { conectado: false, lacoAtivo: false, sondandoIa: false, emLigacao: false, githubNoMac: null }, conexao: { servidor: null, conectado: false, maquinaId: null, status: "" } }), AGORA);
    expect(t).toMatch(/## Quedas recentes\n\(nada registrado\)/);
    expect(t).toMatch(/## Registros recentes[^\n]*\n\(nada registrado\)/);
    expect(t).toMatch(/## IA neste Mac\nEstado: desconectado/);
    expect(t).toContain("Máquina: desconectado");
    expect(t).toContain("Servidor: (não configurado)");
  });

  it("quedas recentes junta as linhas app_processo_caiu da cauda", () => {
    const registros = [linhaLog("app_iniciado"), linhaLog("app_processo_caiu", ',"processo":"janela","motivo":"killed"'), linhaLog("outro")].join("\n");
    const t = montarDiagnostico(entrada({ registros }), AGORA);
    const quedas = t.slice(t.indexOf("## Quedas recentes"), t.indexOf("## Registros recentes"));
    expect(quedas).toContain('"motivo":"killed"');
    expect(quedas).not.toContain("app_iniciado");
  });
});

describe("cortarCauda", () => {
  it("nunca parte o marcador: cortes de 1 a 80 bytes em volta dele", () => {
    const linhas = ["a".repeat(30), `token=${"«redigido: 40 caracteres»"} fim`, "b".repeat(30)].join("\n");
    const total = bytesUtf8(linhas);
    for (let teto = total - 80; teto <= total; teto++) {
      const c = cortarCauda(linhas, teto);
      expect(bytesUtf8(c)).toBeLessThanOrEqual(teto);
      const abre = (c.match(/«/g) ?? []).length;
      const fecha = (c.match(/»/g) ?? []).length;
      expect(abre).toBe(fecha);
      expect(linhas.endsWith(c)).toBe(true);
      expect(c === "" || linhas.split("\n").includes(c.split("\n")[0]!)).toBe(true);
    }
  });

  it("conta bytes UTF-8 (acento e emoji) e não corta o que cabe", () => {
    expect(bytesUtf8("ção🙂")).toBe(1 + 2 + 2 + 4);
    expect(cortarCauda("ção", 5)).toBe("ção");
    expect(cortarCauda("ab\nção🙂", 9)).toBe("ção🙂");
    expect(cortarCauda("ab\nção🙂", 8)).toBe("");
  });
});

describe("nomeArquivoDiagnostico", () => {
  it("segue nod-diagnostico-AAAAMMDD-HHMMSS.txt na hora local do fuso passado", () => {
    expect(nomeArquivoDiagnostico(AGORA, 0)).toBe("nod-diagnostico-20261005-210703.txt");
    expect(nomeArquivoDiagnostico(AGORA, -180)).toBe("nod-diagnostico-20261005-180703.txt");
    expect(nomeArquivoDiagnostico(Date.UTC(2026, 0, 1, 1, 2, 3), -180)).toBe("nod-diagnostico-20251231-220203.txt");
  });
});
