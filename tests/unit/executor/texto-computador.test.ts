import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { gravarTexto, lerTexto } from "../../../infra/computador/texto.mjs";

const pastas: string[] = [];
afterEach(async () => { for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true }); });
async function arquivo(texto?: string | Buffer) {
  const p = await mkdtemp(join(tmpdir(), "nod-texto-test-"));
  pastas.push(p);
  const f = join(p, "exemplo.txt");
  if (texto !== undefined) await writeFile(f, texto);
  return f;
}

it("páginas de texto cabem no proxy e reconstituem Unicode e caracteres escapados", async () => {
  const original = '"\\\n\t🙂\u0001á'.repeat(4000);
  const f = await arquivo(original);
  let inicio = 0;
  let revisao: string | undefined;
  let reconstruido = "";
  for (;;) {
    const pagina = await lerTexto(f, inicio, revisao);
    expect(JSON.stringify(pagina).length).toBeLessThan(6000);
    expect(pagina.texto.inicio).toBe(inicio);
    reconstruido += pagina.texto.conteudo;
    revisao = pagina.texto.revisao;
    if (pagina.texto.proximo === null) break;
    expect(pagina.texto.proximo).toBeGreaterThan(inicio);
    inicio = pagina.texto.proximo;
  }
  expect(reconstruido).toBe(original);
});

it("arquivo vazio continua tendo revisão e fim inequívoco", async () => {
  const f = await arquivo("");
  expect((await lerTexto(f)).texto).toMatchObject({ conteudo: "", inicio: 0, proximo: null, total: 0 });
});

it("recusa continuar ou sobrescrever quando a versão mudou", async () => {
  const f = await arquivo("antes".repeat(2000));
  const lido = await lerTexto(f);
  await writeFile(f, "edição da pessoa");
  await expect(lerTexto(f, lido.texto.proximo!, lido.texto.revisao)).rejects.toThrow("arquivo_alterado");
  await expect(gravarTexto(f, "perderia a edição", lido.texto.revisao)).rejects.toThrow("arquivo_alterado");
  expect(await readFile(f, "utf8")).toBe("edição da pessoa");
});

it("cria e atualiza arquivo, sem sobrescrever por engano com novo", async () => {
  const f = await arquivo();
  const primeira = await gravarTexto(f, "novo", "novo");
  await expect(gravarTexto(f, "errado", "novo")).rejects.toThrow();
  const segunda = await gravarTexto(f, "atualizado", primeira.revisao);
  expect((await lerTexto(f)).texto.revisao).toBe(segunda.revisao);
  expect(await readFile(f, "utf8")).toBe("atualizado");
});

it("não interpreta bytes inválidos como UTF-8 nem exige base64 para texto", async () => {
  const f = await arquivo(Buffer.from([0xff, 0xfe]));
  await expect(lerTexto(f)).rejects.toThrow();
});

it("recusa paginação sem revisão e gravação acima do limite", async () => {
  const f = await arquivo("conteúdo");
  await expect(lerTexto(f, 1)).rejects.toThrow("inicio_invalido");
  await expect(lerTexto(f, -1)).rejects.toThrow("inicio_invalido");
  await expect(gravarTexto(f, "a".repeat(131073), "novo")).rejects.toThrow("entrada_invalida");
});
