import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { criarPastas, projetoAtivo } from "../../../src/adapters/workspace/pastas.ts";

const temporarios: string[] = [];
afterEach(async () => { for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });
async function fixture() {
  const raiz = await mkdtemp(join(tmpdir(), "nod-pastas-test-")); temporarios.push(raiz);
  const pasta = join(raiz, "documentos"); await mkdir(pasta);
  const i = { tenantId: randomUUID(), pessoaId: randomUUID(), conversaId: randomUUID() };
  return { raiz, pasta, i, p: criarPastas(join(raiz, "privado")) };
}
it("não concede acesso antes da escolha; preserva vínculo e arquivos ao revogar", async () => {
  const f = await fixture();
  expect(await f.p.executar(f.i, "workspace_ler_texto", { caminho: "relatorio.txt" })).toMatchObject({ estado: "precisa_pasta" });
  await f.p.escolher(f.i, f.pasta);
  await f.p.executar(f.i, "workspace_gravar_texto", { caminho: "relatorio.txt", texto: "resultado", revisao: "novo" });
  const reaberto = criarPastas(join(f.raiz, "privado"));
  expect(projetoAtivo(await reaberto.consultar(f.i))).toMatchObject({ pasta: await realpath(f.pasta) });
  expect(await reaberto.consultar({ ...f.i, pessoaId: randomUUID() })).toBeNull();
  await reaberto.revogar(f.i);
  expect(await reaberto.consultar(f.i)).toBeNull();
  expect(await readFile(join(f.pasta, "relatorio.txt"), "utf8")).toBe("resultado");
});
it("recusa travessia, links externos e escrita em configuração de execução", async () => {
  const f = await fixture();
  await f.p.escolher(f.i, f.pasta);
  await mkdir(join(f.raiz, "fora"));
  await writeFile(join(f.raiz, "fora", "segredo"), "não ler");
  await symlink(join(f.raiz, "fora"), join(f.pasta, "link"));
  for (const caminho of ["../fora/segredo", "link/segredo", ".git/config", ".claude/settings.json"]) {
    await expect(f.p.executar(f.i, "workspace_gravar_texto", { caminho, texto: "não", revisao: "novo" })).rejects.toThrow();
  }
  expect(await readFile(join(f.raiz, "fora", "segredo"), "utf8")).toBe("não ler");
});
it("não permite conceder a própria raiz privada do Nod", async () => {
  const f = await fixture(); await mkdir(join(f.raiz, "privado"));
  await expect(f.p.escolher(f.i, join(f.raiz, "privado"))).rejects.toThrow();
  await expect(f.p.escolher(f.i, f.raiz)).rejects.toThrow();
});
it("seletor não oferece conceder a pasta pessoal nem a raiz privada", async () => {
  const f = await fixture();
  expect(await f.p.listarPastas(homedir())).toMatchObject({ selecionavel: false });
  expect(await f.p.listarPastas(f.raiz)).toMatchObject({ selecionavel: false });
  expect(await f.p.listarPastas(f.pasta)).toMatchObject({ selecionavel: true });
});
it("cancelamento impede nova escrita e preparação", async () => {
  const f = await fixture(); await f.p.escolher(f.i, f.pasta);
  const c = new AbortController(); c.abort();
  await expect(f.p.executar(f.i, "workspace_gravar_texto", { caminho: "cancelado.txt", texto: "não", revisao: "novo" }, c.signal)).rejects.toThrow();
  expect(projetoAtivo(await f.p.consultar(f.i))?.preparado).toBeNull();
  await expect(readFile(join(f.pasta, "cancelado.txt"))).rejects.toThrow();
});

// definido em 2026-09-18: o bot é uma sessão viva — o mesmo agente transita entre projetos
// aprovados sem perder o anterior nem o ambiente já preparado dele.
it("autorizar um segundo projeto não revoga o primeiro", async () => {
  const f = await fixture();
  const outro = join(f.raiz, "outro-projeto"); await mkdir(outro);
  const x = await f.p.escolher(f.i, f.pasta);
  const y = await f.p.escolher(f.i, outro);
  const v = await f.p.consultar(f.i);
  expect(v?.projetos.map(p => p.pasta).sort()).toEqual([await realpath(outro), await realpath(f.pasta)].sort());
  expect(v?.ativoId).toBe(y.projeto.id);
  expect(projetoAtivo(v)?.pasta).toBe(await realpath(outro));
  expect(x.projeto.id).not.toBe(y.projeto.id);
});
it("trocar volta ao projeto anterior e preserva o ambiente preparado", async () => {
  const f = await fixture();
  const outro = join(f.raiz, "outro-projeto"); await mkdir(outro);
  const x = await f.p.escolher(f.i, f.pasta);
  await f.p.executar(f.i, "workspace_gravar_texto", { caminho: "no-x.txt", texto: "feito em X", revisao: "novo" });
  const preparadoX = projetoAtivo(await f.p.consultar(f.i))?.preparado;
  expect(preparadoX).not.toBeNull();
  await f.p.escolher(f.i, outro);
  expect(projetoAtivo(await f.p.consultar(f.i))?.preparado).toBeNull();
  const devolta = await f.p.trocar(f.i, x.projeto.id);
  expect(devolta.projeto.preparado).toEqual(preparadoX);
  expect(await f.p.executar(f.i, "workspace_ler_texto", { caminho: "no-x.txt" })).toMatchObject({ texto: { conteudo: "feito em X" } });
});
it("trocar recusa projeto que a pessoa não autorizou", async () => {
  const f = await fixture();
  await f.p.escolher(f.i, f.pasta);
  await expect(f.p.trocar(f.i, randomUUID())).rejects.toThrow();
});
it("reautorizar a mesma pasta reativa sem duplicar nem perder o ambiente", async () => {
  const f = await fixture();
  const outro = join(f.raiz, "outro-projeto"); await mkdir(outro);
  const x = await f.p.escolher(f.i, f.pasta);
  await f.p.executar(f.i, "workspace_gravar_texto", { caminho: "a.txt", texto: "a", revisao: "novo" });
  await f.p.escolher(f.i, outro);
  const rex = await f.p.escolher(f.i, f.pasta);
  expect(rex.projeto.id).toBe(x.projeto.id);
  expect(rex.projeto.preparado).not.toBeNull();
  expect((await f.p.consultar(f.i))?.projetos).toHaveLength(2);
});
it("revogar um projeto preserva os outros e os arquivos de ambos", async () => {
  const f = await fixture();
  const outro = join(f.raiz, "outro-projeto"); await mkdir(outro);
  const x = await f.p.escolher(f.i, f.pasta);
  await f.p.executar(f.i, "workspace_gravar_texto", { caminho: "x.txt", texto: "conteudo X", revisao: "novo" });
  const y = await f.p.escolher(f.i, outro);
  await f.p.executar(f.i, "workspace_gravar_texto", { caminho: "y.txt", texto: "conteudo Y", revisao: "novo" });
  await f.p.revogar(f.i, x.projeto.id);
  const v = await f.p.consultar(f.i);
  expect(v?.projetos.map(p => p.id)).toEqual([y.projeto.id]);
  expect(await readFile(join(f.pasta, "x.txt"), "utf8")).toBe("conteudo X");
  expect(await readFile(join(outro, "y.txt"), "utf8")).toBe("conteudo Y");
  await f.p.revogar(f.i);
  expect(await f.p.consultar(f.i)).toBeNull();
});
it("revogar o projeto ativo elege outro em vez de deixar a conversa sem ativo", async () => {
  const f = await fixture();
  const outro = join(f.raiz, "outro-projeto"); await mkdir(outro);
  const x = await f.p.escolher(f.i, f.pasta);
  const y = await f.p.escolher(f.i, outro);
  await f.p.revogar(f.i, y.projeto.id);
  expect(projetoAtivo(await f.p.consultar(f.i))?.id).toBe(x.projeto.id);
});
it("migra o formato antigo de pasta única sem perder o vínculo", async () => {
  const f = await fixture();
  const privado = join(f.raiz, "privado");
  await mkdir(join(privado, "vinculos"), { recursive: true });
  const antigo = { pasta: await realpath(f.pasta), id: randomUUID(), preparado: null };
  await writeFile(join(privado, "vinculos", `${f.i.tenantId}-${f.i.pessoaId}-${f.i.conversaId}.json`), JSON.stringify(antigo));
  const v = await f.p.consultar(f.i);
  expect(v?.ativoId).toBe(antigo.id);
  expect(projetoAtivo(v)).toMatchObject({ id: antigo.id, pasta: antigo.pasta, preparado: null });
  expect(await f.p.executar(f.i, "workspace_arquivos", {})).toHaveProperty("arquivos");
});
