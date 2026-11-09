import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { TAREFA_DO_MOTOR_WINDOWS } from "../../../../src/adapters/http/motor-instalacao-windows.ts";
import { comandoDeInstalacao, lerLinhaDeInstalacao, MARCA_RESULTADO, rodarInstalacao, servidorValido, TAREFA_DO_MOTOR, type LinhaDeInstalacao } from "../../../../desktop/windows/instalacao.ts";

/** Um powershell falso: escreve `saida` no stdout (em pedaços quebrados no meio da linha) e fecha. */
function gerarFalso(saida: string, o: { stderr?: string; erro?: Error } = {}) {
  const chamadas: { arquivo: string; args: string[] }[] = [];
  const gerar = ((arquivo: string, args: string[]) => {
    chamadas.push({ arquivo, args });
    const filho = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    filho.stdout = new PassThrough();
    filho.stderr = new PassThrough();
    setImmediate(() => {
      if (o.erro) { filho.emit("error", o.erro); return; }
      const meio = Math.floor(saida.length / 2);
      filho.stdout.write(saida.slice(0, meio));
      filho.stdout.write(saida.slice(meio));
      if (o.stderr) filho.stderr.write(o.stderr);
      filho.stdout.end();
      filho.stderr.end();
      setImmediate(() => filho.emit("close", 0));
    });
    return filho;
  }) as unknown as Parameters<typeof rodarInstalacao>[0]["gerar"];
  return { gerar, chamadas };
}

describe("ADA-229: instalação do motor pelo app", () => {
  it("o prefixo da tarefa é o mesmo do script /windows", () => {
    expect(TAREFA_DO_MOTOR).toBe(TAREFA_DO_MOTOR_WINDOWS);
  });
  it("monta um PowerShell oculto, sem perfil, que roda o /windows do servidor e imprime o resultado", () => {
    const c = comandoDeInstalacao("https://app.nodbot.ai", "D:\\Win");
    expect(c.arquivo).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(c.args.slice(0, 7)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command"]);
    expect(c.args[7]).toContain("irm 'https://app.nodbot.ai/windows' | iex");
    expect(c.args[7]).toContain(MARCA_RESULTADO);
  });
  it("recusa servidor que poderia injetar no PowerShell", () => {
    for (const s of ["https://x.com/'; calc; '", "http://x.com", "https://x.com/caminho", "https://a b"]) {
      expect(servidorValido(s)).toBe(false);
      expect(() => comandoDeInstalacao(s)).toThrow();
    }
    expect(servidorValido("http://127.0.0.1:4321")).toBe(true);
  });
  it("lê as linhas do script", () => {
    expect(lerLinhaDeInstalacao("\u2713 Git 2.47\r")).toEqual({ tipo: "passo", texto: "Git 2.47" });
    expect(lerLinhaDeInstalacao("! Windows Server")).toEqual({ tipo: "aviso", texto: "Windows Server" });
    expect(lerLinhaDeInstalacao("\u2717 sem rede")).toEqual({ tipo: "erro", texto: "sem rede" });
    expect(lerLinhaDeInstalacao("Baixando o Node...")).toEqual({ tipo: "info", texto: "Baixando o Node..." });
    expect(lerLinhaDeInstalacao(`${MARCA_RESULTADO}ok`)).toEqual({ tipo: "resultado", ok: true });
    expect(lerLinhaDeInstalacao(`${MARCA_RESULTADO}`)).toEqual({ tipo: "resultado", ok: false });
    expect(lerLinhaDeInstalacao("   ")).toBeNull();
  });
  it("ok só com a linha marcada ok; entrega as linhas na ordem", async () => {
    const f = gerarFalso(`\u2713 Git\r\nBaixando\r\n\u2713 motor 1.2\r\n${MARCA_RESULTADO}ok\r\n`);
    const linhas: LinhaDeInstalacao[] = [];
    await expect(rodarInstalacao({ servidor: "https://nod.x", gerar: f.gerar, env: {}, aoLinha: (l) => linhas.push(l) })).resolves.toEqual({ ok: true, erro: null });
    expect(linhas.map((l) => ("texto" in l ? l.texto : ""))).toEqual(["Git", "Baixando", "motor 1.2"]);
  });
  it("falhou: o erro é a última linha ✗; sem marca nenhuma também é falha", async () => {
    const f = gerarFalso(`\u2717 O nod precisa do Windows 10 22H2\n${MARCA_RESULTADO}falhou`);
    await expect(rodarInstalacao({ servidor: "https://nod.x", gerar: f.gerar, env: {}, aoLinha: () => undefined })).resolves.toEqual({ ok: false, erro: "O nod precisa do Windows 10 22H2" });
    const cortado = gerarFalso("\u2713 Git\n", { stderr: "irm : 404 Not Found\n" });
    await expect(rodarInstalacao({ servidor: "https://nod.x", gerar: cortado.gerar, env: {}, aoLinha: () => undefined })).resolves.toEqual({ ok: false, erro: "irm : 404 Not Found" });
  });
  it("PowerShell que não abre vira falha com o motivo", async () => {
    const f = gerarFalso("", { erro: new Error("ENOENT") });
    const r = await rodarInstalacao({ servidor: "https://nod.x", gerar: f.gerar, env: {}, aoLinha: () => undefined });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("ENOENT");
  });
});
