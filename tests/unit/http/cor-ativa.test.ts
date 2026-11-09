import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";
import { iniciarCorAtiva } from "../../../src/adapters/http/cor-ativa.ts";

/** NOD-218: o marcador cor-ativa decide quem atende; ausente/inválido = inativa (fail-safe); aoAtivar roda uma vez. */

let dir: string;
let arquivo: string;
let logs: { evento: string; motivo?: string }[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cor-ativa-"));
  arquivo = join(dir, "cor-ativa");
  logs = [];
  definirDestinoDoLog((linha) => logs.push(JSON.parse(linha) as { evento: string; motivo?: string }));
});
afterEach(async () => {
  definirDestinoDoLog(null);
  await rm(dir, { recursive: true, force: true });
});

const esperarMicro = () => new Promise((r) => setTimeout(r, 0));

describe("NOD-218: cor-ativa", () => {
  it("sem NOD_COR: sempre ativa e aoAtivar roda na hora, sem ler arquivo", async () => {
    const ler = vi.fn(async () => "verde");
    const c = await iniciarCorAtiva({ cor: null, arquivo, ler });
    const cb = vi.fn();
    c.aoAtivar(cb);
    await esperarMicro();
    expect(c.ativa()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(ler).not.toHaveBeenCalled();
    c.parar();
  });

  it("arquivo ausente → inativa (fail-safe), com aviso", async () => {
    const c = await iniciarCorAtiva({ cor: "azul", arquivo, intervaloMs: 60_000 });
    expect(c.ativa()).toBe(false);
    expect(logs).toContainEqual(expect.objectContaining({ evento: "cor_inativa", motivo: "ausente" }));
    c.parar();
  });

  it("conteúdo inválido → inativa; a outra cor → inativa; a própria (com \\n) → ativa", async () => {
    await writeFile(arquivo, "roxo\n");
    const c = await iniciarCorAtiva({ cor: "verde", arquivo, intervaloMs: 60_000 });
    expect(c.ativa()).toBe(false);
    await writeFile(arquivo, "azul\n");
    await c.reler();
    expect(c.ativa()).toBe(false);
    await writeFile(arquivo, "verde\n");
    await c.reler();
    expect(c.ativa()).toBe(true);
    expect(logs.map((l) => l.motivo ?? l.evento)).toEqual(["invalido", "outra_cor", "cor_ativa"]);
    c.parar();
  });

  it("aoAtivar espera a virada e roda UMA vez; voltar a inativa e reativar não roda de novo", async () => {
    await writeFile(arquivo, "azul");
    const c = await iniciarCorAtiva({ cor: "verde", arquivo, intervaloMs: 60_000 });
    const cb = vi.fn();
    c.aoAtivar(cb);
    await c.reler();
    await esperarMicro();
    expect(cb).not.toHaveBeenCalled();
    await writeFile(arquivo, "verde");
    await c.reler();
    await esperarMicro();
    expect(cb).toHaveBeenCalledTimes(1);
    await writeFile(arquivo, "azul");
    await c.reler();
    await writeFile(arquivo, "verde");
    await c.reler();
    await esperarMicro();
    expect(cb).toHaveBeenCalledTimes(1);
    const depois = vi.fn();
    c.aoAtivar(depois); // registrado depois de ativar: roda na hora
    await esperarMicro();
    expect(depois).toHaveBeenCalledTimes(1);
    c.parar();
  });

  it("relê sozinho no intervalo (a virada do deploy.sh chega sem reiniciar)", async () => {
    await writeFile(arquivo, "azul");
    const c = await iniciarCorAtiva({ cor: "verde", arquivo, intervaloMs: 20 });
    expect(c.ativa()).toBe(false);
    await writeFile(arquivo, "verde");
    await vi.waitFor(() => expect(c.ativa()).toBe(true), { timeout: 2_000 });
    await unlink(arquivo);
    await vi.waitFor(() => expect(c.ativa()).toBe(false), { timeout: 2_000 });
    c.parar();
  });

  it("aoAtivar que lança vira log de erro, não rejeição solta", async () => {
    const c = await iniciarCorAtiva({ cor: null });
    c.aoAtivar(() => { throw new Error("x"); });
    await esperarMicro();
    await esperarMicro();
    expect(logs).toContainEqual(expect.objectContaining({ evento: "ao_ativar_falhou" }));
    c.parar();
  });
});
