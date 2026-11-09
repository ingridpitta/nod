import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lerTexto, gravarTexto } from "../../../infra/computador/texto.mjs";
import type { PedidoWorkspace, ProjetoWorkspace, VinculoWorkspace, WorkspacePreparado } from "../../contracts/workspace.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { validarAcaoComputador } from "../../domain/computador.ts";
import { buscarPastas } from "./busca-pastas.ts";
import { criarPreparadorWorkspace } from "./preparar.ts";
import { executarNoWorkspace } from "./terminal.ts";

type Identidade = { tenantId: string; pessoaId: string; conversaId: string };
/** O formato está no contrato (src/contracts/workspace.ts), que a web também lê. */
export type Projeto = ProjetoWorkspace;
/** O formato antigo (uma pasta) é migrado na leitura. */
export type Vinculo = VinculoWorkspace;
type VinculoAntigo = { pasta: string; id: string; preparado: WorkspacePreparado | null };
/** Teto por conversa: o excedente sai pelo uso mais antigo, para o registro não crescer sem fim. */
export const MAX_PROJETOS = 20;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function dentro(raiz: string, alvo: string): boolean {
  const r = relative(raiz, alvo);
  return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`));
}
/** Aceita o formato antigo de um vínculo só e devolve sempre a coleção. */
function migrar(bruto: Vinculo | VinculoAntigo): Vinculo {
  if ("projetos" in bruto) return bruto;
  const agora = Date.now();
  return { projetos: [{ id: bruto.id, pasta: bruto.pasta, preparado: bruto.preparado, autorizadoEm: agora, ultimoUsoEm: agora }], ativoId: bruto.id };
}
/** O projeto ativo, ou null quando a conversa ainda não tem nenhum. */
export function projetoAtivo(v: Vinculo | null): Projeto | null {
  return v?.projetos.find(p => p.id === v.ativoId) ?? null;
}

/**
 * definido em 2026-09-18: armazenamento privado na máquina local; não é autorização por si só.
 * `baseBusca` só existe para o teste apontar uma base descartável — em produção é a pasta pessoal.
 */
export function criarPastas(raiz: string, imagem?: string, baseBusca?: string) {
  const preparar = criarPreparadorWorkspace(join(raiz, "ambientes"));
  const registros = join(raiz, "vinculos");
  function arquivo(i: Identidade) {
    if (![i.tenantId, i.pessoaId, i.conversaId].every(v => uuid.test(v))) throw new ErroDeDominio("entrada_invalida");
    return join(registros, `${i.tenantId}-${i.pessoaId}-${i.conversaId}.json`);
  }
  async function consultar(i: Identidade): Promise<Vinculo | null> {
    try { return migrar(JSON.parse(await readFile(arquivo(i), "utf8")) as Vinculo | VinculoAntigo); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
  async function salvar(i: Identidade, v: Vinculo) {
    await mkdir(registros, { recursive: true, mode: 0o700 });
    const tmp = `${arquivo(i)}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(v), { mode: 0o600, flag: "wx" });
    await rename(tmp, arquivo(i));
  }
  async function caminho(w: WorkspacePreparado, nome: string, novo = false) {
    if (isAbsolute(nome) || nome.includes("\0") || nome.includes("\\")) throw new ErroDeDominio("entrada_invalida");
    const alvo = resolve(w.caminho, nome);
    if (!dentro(w.caminho, alvo)) throw new ErroDeDominio("nao_permitido");
    const partes = relative(w.caminho, alvo).split(sep);
    if (partes.some(p => [".git", ".nod", ".claude", ".codex", ".agents"].includes(p))) throw new ErroDeDominio("nao_permitido");
    // definido em 2026-09-18: verificar cada ancestral existente antes de criar diretórios.
    if (novo) {
      let pai = w.caminho;
      for (const segmento of partes.slice(0, -1)) {
        pai = join(pai, segmento);
        try { await mkdir(pai); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        if (!dentro(w.caminho, await realpath(pai))) throw new ErroDeDominio("nao_permitido");
      }
    }
    const real = await realpath(alvo).catch((e: NodeJS.ErrnoException) => {
      if (novo && e.code === "ENOENT") return alvo;
      throw e;
    });
    if (!dentro(w.caminho, real) || relative(w.caminho, real).split(sep).some(p => [".git", ".nod", ".claude", ".codex", ".agents"].includes(p))) throw new ErroDeDominio("nao_permitido");
    return real;
  }
  return {
    consultar,
    /** Acrescenta o projeto e o torna ativo; autorizar outro NÃO revoga os anteriores. */
    async escolher(i: Identidade, pasta: string) {
      if (!isAbsolute(pasta) || pasta.includes("\0")) throw new ErroDeDominio("entrada_invalida");
      const p = await realpath(pasta);
      await mkdir(raiz, { recursive: true, mode: 0o700 });
      const privado = await realpath(raiz);
      if (p === dirname(p) || p === await realpath(homedir()) || dentro(p, privado) || dentro(privado, p)) throw new ErroDeDominio("nao_permitido");
      await readdir(p);
      const agora = Date.now();
      const atual = await consultar(i);
      const existente = atual?.projetos.find(x => x.pasta === p);
      if (existente) {
        // Reautorizar a mesma pasta só a reativa: preserva o ambiente já preparado.
        const v: Vinculo = { projetos: atual!.projetos.map(x => x.id === existente.id ? { ...x, ultimoUsoEm: agora } : x), ativoId: existente.id };
        await salvar(i, v);
        return { vinculo: v, projeto: { ...existente, ultimoUsoEm: agora } };
      }
      const novo: Projeto = { id: randomUUID(), pasta: p, preparado: null, autorizadoEm: agora, ultimoUsoEm: agora };
      const mantidos = [...(atual?.projetos ?? []), novo]
        .sort((a, b) => b.ultimoUsoEm - a.ultimoUsoEm)
        .slice(0, MAX_PROJETOS);
      const v: Vinculo = { projetos: mantidos, ativoId: novo.id };
      await salvar(i, v);
      return { vinculo: v, projeto: novo };
    },
    /** Torna ativo um projeto JÁ autorizado. Não concede nada: id desconhecido é recusado. */
    async trocar(i: Identidade, projetoId: string) {
      const v = await consultar(i);
      const alvo = v?.projetos.find(x => x.id === projetoId);
      if (!v || !alvo) throw new ErroDeDominio("nao_permitido");
      const agora = Date.now();
      const atualizado: Vinculo = { projetos: v.projetos.map(x => x.id === projetoId ? { ...x, ultimoUsoEm: agora } : x), ativoId: projetoId };
      await salvar(i, atualizado);
      return { vinculo: atualizado, projeto: { ...alvo, ultimoUsoEm: agora } };
    },
    /** Sem projetoId remove todos; com id remove um só e mantém o resto. Nunca apaga arquivos. */
    async revogar(i: Identidade, projetoId?: string) {
      if (projetoId === undefined) {
        await unlink(arquivo(i)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
        return;
      }
      const v = await consultar(i);
      if (!v) return;
      const projetos = v.projetos.filter(x => x.id !== projetoId);
      if (projetos.length === v.projetos.length) return;
      if (projetos.length === 0) {
        await unlink(arquivo(i)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
        return;
      }
      await salvar(i, { projetos, ativoId: v.ativoId === projetoId ? projetos[0]!.id : v.ativoId });
    },
    /**
     * Procura no computador da pessoa as pastas que casam com o nome do projeto citado.
     * Usa a MESMA regra da concessão, então nunca oferece pasta que escolher() recusaria.
     */
    async buscar(termo: string) {
      await mkdir(raiz, { recursive: true, mode: 0o700 });
      const privado = await realpath(raiz);
      const casa = await realpath(homedir());
      return buscarPastas(termo, {
        ...(baseBusca ? { base: baseBusca } : {}),
        podeAutorizar: (p) => p !== dirname(p) && p !== casa && !dentro(p, privado) && !dentro(privado, p),
      });
    },
    async listarPastas(pasta?: string) {
      const p = await realpath(pasta ?? homedir());
      await mkdir(raiz, { recursive: true, mode: 0o700 });
      const privado = await realpath(raiz);
      const selecionavel = p !== dirname(p) && p !== await realpath(homedir()) && !dentro(p, privado) && !dentro(privado, p);
      return { caminho: p, pai: dirname(p), selecionavel, pastas: (await readdir(p, { withFileTypes: true })).filter(e => e.isDirectory() && !e.name.startsWith(".")).map(e => ({ nome: e.name, caminho: join(p, e.name) })).sort((a,b) => a.nome.localeCompare(b.nome)).slice(0, 200) };
    },
    /** Prepara o ambiente do projeto ativo e guarda nele, sem tocar nos outros projetos. */
    async preparar(i: Identidade, escolha: Pick<PedidoWorkspace, "modo" | "referencia">) {
      const v = await consultar(i);
      const alvo = projetoAtivo(v);
      if (!v || !alvo) throw new ErroDeDominio("nao_permitido");
      const w = await preparar({ id: alvo.id, pastaAutorizada: alvo.pasta, ...escolha });
      await salvar(i, { ...v, projetos: v.projetos.map(x => x.id === alvo.id ? { ...x, preparado: w, ultimoUsoEm: Date.now() } : x) });
      return w;
    },
    async executar(i: Identidade, nome: string, args: Record<string, unknown>, sinal = new AbortController().signal) {
      sinal.throwIfAborted();
      const v = await consultar(i);
      const alvo = projetoAtivo(v);
      if (!v || !alvo) return { estado: "precisa_pasta", instrucao: "Nenhum projeto autorizado nesta conversa. Chame workspace_propor_pasta com o nome do projeto citado pela pessoa; não descreva menus, não chute caminhos e não peça para a pessoa procurar a pasta." };
      const w = alvo.preparado ?? await this.preparar(i, { modo: "auto" });
      sinal.throwIfAborted();
      if (await realpath(w.caminho) !== w.caminho || await realpath(alvo.pasta) !== alvo.pasta) throw new ErroDeDominio("nao_permitido");
      if (nome === "workspace_terminal") {
        if (typeof args.comando !== "string") throw new ErroDeDominio("entrada_invalida");
        return executarNoWorkspace(w, args.comando, sinal, imagem);
      }
      if (nome === "workspace_arquivos") {
        const itens = await readdir(await caminho(w, String(args.caminho ?? ".")), { withFileTypes: true });
        return { arquivos: itens.slice(0, 100).map(e => ({ nome: e.name, diretorio: e.isDirectory() })), mais: itens.length > 100 };
      }
      const a = validarAcaoComputador({ ...args, tipo: nome.slice(10) });
      if (a.tipo === "ler_texto") return lerTexto(await caminho(w, a.caminho), a.inicio, a.revisao);
      if (a.tipo === "gravar_texto") {
        const destino = await caminho(w, a.caminho, true);
        sinal.throwIfAborted();
        return gravarTexto(destino, a.texto, a.revisao);
      }
      throw new ErroDeDominio("entrada_invalida");
    },
  };
}
