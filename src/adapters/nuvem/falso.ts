import type { ContaNuvem, ContaPreparada, CriarInstancia, ErroNuvem, EstadoInstancia, ProvedorNuvem, RefInstancia } from "../../contracts/provedor-nuvem.ts";
import { ErroNuvemLancado, ErroNuvemTransitorio } from "../../domain/maquina-nuvem.ts";

type Operacao = "criar" | "ligar" | "desligar" | "reiniciar" | "excluir" | "estado" | "definirScript";
type Roteiro = ErroNuvem | "transitorio";

const chave = (r: RefInstancia) => `${r.projeto}/${r.zona}/${r.nome}`;

/**
 * ADR-121: o provedor de mentira, para unit e integração (o e2e real depende do OAuth do Google). Guarda as instâncias
 * na memória; `ligar` deixa a instância `rodando` na hora (ou `provisionando`, com `ligarDevagar`). `falharNa(op, erro)`
 * roteiriza a próxima chamada daquela operação; `chamadas` registra tudo para o teste conferir.
 */
export class ProvedorNuvemFalso implements ProvedorNuvem {
  readonly instancias = new Map<string, EstadoInstancia>();
  readonly chamadas: { op: Operacao; ref: RefInstancia; requestId?: string }[] = [];
  ligarDevagar = false;
  private readonly roteiro = new Map<Operacao, Roteiro[]>();

  /** Uma instância que a pessoa já tem (Conectar). */
  existe(ref: RefInstancia, estado: EstadoInstancia = "rodando"): this {
    this.instancias.set(chave(ref), estado);
    return this;
  }

  falharNa(op: Operacao, erro: Roteiro): this {
    this.roteiro.set(op, [...(this.roteiro.get(op) ?? []), erro]);
    return this;
  }

  quantas(op: Operacao): number {
    return this.chamadas.filter((c) => c.op === op).length;
  }

  private registrar(op: Operacao, ref: RefInstancia, requestId?: string): void {
    this.chamadas.push({ op, ref, ...(requestId ? { requestId } : {}) });
    const fila = this.roteiro.get(op);
    const erro = fila?.shift();
    if (erro === undefined) return;
    if (erro === "transitorio") throw new ErroNuvemTransitorio();
    throw new ErroNuvemLancado(erro);
  }

  private exigir(ref: RefInstancia): void {
    if (!this.instancias.has(chave(ref))) throw new ErroNuvemLancado({ motivo: "excluida" });
  }

  /** O `startup-script` de cada instância (a criação grava; `definirScript` troca). */
  readonly scripts = new Map<string, string>();
  readonly criadas: CriarInstancia[] = [];

  async criar(req: CriarInstancia, requestId: string): Promise<void> {
    this.registrar("criar", req, requestId);
    if (!this.instancias.has(chave(req))) {
      this.instancias.set(chave(req), "rodando");
      this.scripts.set(chave(req), req.startupScript);
      this.criadas.push(req);
    }
  }

  async definirScript(ref: RefInstancia, script: string): Promise<void> {
    this.registrar("definirScript", ref);
    this.exigir(ref);
    this.scripts.set(chave(ref), script);
  }

  script(ref: RefInstancia): string | undefined {
    return this.scripts.get(chave(ref));
  }

  async ligar(ref: RefInstancia): Promise<void> {
    this.registrar("ligar", ref);
    this.exigir(ref);
    this.instancias.set(chave(ref), this.ligarDevagar ? "provisionando" : "rodando");
  }

  async desligar(ref: RefInstancia): Promise<void> {
    this.registrar("desligar", ref);
    this.exigir(ref);
    this.instancias.set(chave(ref), "parada");
  }

  async reiniciar(ref: RefInstancia): Promise<void> {
    this.registrar("reiniciar", ref);
    this.exigir(ref);
    this.instancias.set(chave(ref), "rodando");
  }

  async excluir(ref: RefInstancia): Promise<void> {
    this.registrar("excluir", ref);
    this.instancias.delete(chave(ref));
  }

  async estado(ref: RefInstancia): Promise<EstadoInstancia> {
    this.registrar("estado", ref);
    return this.instancias.get(chave(ref)) ?? "inexistente";
  }
}

/** A conta de mentira: prepara um projeto previsível e anota as instâncias autorizadas. */
export class ContaNuvemFalsa implements ContaNuvem {
  readonly autorizadas: RefInstancia[] = [];
  preparos = 0;
  erroNoPreparo: ErroNuvem | null = null;

  async preparar(p: { pessoaId: string; tokenAcesso: string; projetoExistente?: string | null }): Promise<ContaPreparada> {
    this.preparos += 1;
    if (this.erroNoPreparo) throw new ErroNuvemLancado(this.erroNoPreparo);
    const projeto = p.projetoExistente ?? `nod-${p.pessoaId.slice(0, 8)}-abcd`;
    const contaServico = `nod-12345678@${projeto}.iam.gserviceaccount.com`;
    const chaveNome = `projects/${projeto}/serviceAccounts/${contaServico}/keys/k${this.preparos}`;
    this.chaves.push(chaveNome);
    return { projeto, contaServico, chaveJson: JSON.stringify({ type: "service_account", project_id: projeto, private_key: "falsa" }), chaveNome };
  }

  /** As chaves vivas no "Google" (o preparo cria uma; `apagarOutrasChaves` deixa só a mantida). */
  chaves: string[] = [];

  async apagarOutrasChaves(p: { tokenAcesso: string; projeto: string; contaServico: string; manter: string }): Promise<number> {
    const antes = this.chaves.length;
    this.chaves = this.chaves.filter((c) => c === p.manter || !c.startsWith(`projects/${p.projeto}/`));
    return antes - this.chaves.length;
  }

  async autorizarInstancia(p: { tokenAcesso: string; projeto: string; contaServico: string; ref: RefInstancia }): Promise<void> {
    this.autorizadas.push(p.ref);
  }
}
