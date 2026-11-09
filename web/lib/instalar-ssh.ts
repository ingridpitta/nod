import type { CredencialSsh, InstalacaoCriadaDto, InstalacaoSshDto, MetodoSsh } from "../../src/contracts/instalacoes-ssh.ts";
import type { InstaladoraSsh, InstalarSsh } from "../estado/reducer.ts";
import { pareceChavePublica, resumoDaChave } from "./chave-ssh.ts";
import type { CodigoCifrado } from "../../src/contracts/contas-ia.ts";
import { ErroApi } from "./erro-api.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): o controlador do "Usar uma máquina só para o computador". Os segredos (a chave colada,
 * a frase, a senha, a do sudo) moram SÓ aqui, numa variável deste fechamento — nunca no estado, no HTML, no
 * localStorage ou num log. Saem uma vez por pedido, cifrados para a instaladora (RSA-OAEP + AES-GCM, ADR-102), e são
 * apagados quando a instalação fica pronta, é cancelada ou o diálogo fecha. Ficam enquanto a tela ainda pode precisar
 * deles: "Tentar de novo" e "Confiar na nova" mandam a credencial de novo.
 */
export type ApiDaInstalacao = {
  instaladorasSsh(): Promise<{ instaladoras: InstaladoraSsh[] }>;
  pedirInstalacaoSsh(p: { host: string; porta: number; usuario: string; metodo: MetodoSsh; origemId: string | null; substituir: boolean }): Promise<InstalacaoCriadaDto>;
  verInstalacaoSsh(id: string): Promise<InstalacaoSshDto>;
  credencialSsh(id: string, cifrado: CodigoCifrado): Promise<unknown>;
  confiarNaNovaSsh(id: string): Promise<unknown>;
  cancelarInstalacaoSsh(id: string): Promise<unknown>;
  criarConvite(computador?: { substituir: boolean }): Promise<{ convite: string; expiraEm: number }>;
};

export type DepsInstalarSsh = {
  api: ApiDaInstalacao;
  cifrar(chavePublica: string, texto: string): Promise<CodigoCifrado>;
  ler(): InstalarSsh | null;
  gravar(i: InstalarSsh | null): void;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  /** O endereço do nod (para o comando manual). */
  origem: string;
  /** O nome da só-computador viva, para o "Substituir?" (o 409 não traz o corpo até a tela). */
  computadorAtual(): string | null;
  /** A máquina pareou: Máquinas recarrega. */
  aoFicarPronta(): void;
};

export type CampoSegredo = "frase" | "senha" | "sudo";
type Segredos = { chave: string; frase: string; senha: string; sudo: string };
const vazios = (): Segredos => ({ chave: "", frase: "", senha: "", sudo: "" });

export const INTERVALO_DA_CONSULTA_MS = 2000;
/** Uma chave privada SSH tem poucos KB (RSA 4096 ≈ 3,4 KB); acima disso o arquivo escolhido não é uma. */
export const MAX_ARQUIVO_DA_CHAVE = 64_000;

export function estadoInicial(): InstalarSsh {
  return {
    fase: "form", endereco: "", usuario: "", metodo: "chave", chave: null, temFrase: false,
    instaladoras: null, origemId: null, trocarOrigem: false, substituir: null, pedido: null,
    campoErro: null, erro: null, pedeSudo: false, mostrarSudo: false, manual: null, segundoPlano: false, enviando: false, tentadas: [],
  };
}

/** `host`, `host:porta` ou `[ipv6]:porta`. null = não dá para ler (a tela diz no campo). */
export function lerEndereco(texto: string): { host: string; porta: number } | null {
  const t = texto.trim();
  if (!t || /\s/.test(t)) return null;
  const v6 = /^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/.exec(t);
  if (v6) return comPorta(v6[1]!, v6[2]);
  const partes = t.split(":");
  if (partes.length > 2) return /^[0-9a-fA-F:.]+$/.test(t) ? { host: t, porta: 22 } : null;
  if (!/^[A-Za-z0-9._-]+$/.test(partes[0]!) || partes[0]!.startsWith("-")) return null;
  return comPorta(partes[0]!, partes[1]);
}

function comPorta(host: string, porta: string | undefined): { host: string; porta: number } | null {
  if (porta === undefined) return { host, porta: 22 };
  const n = Number(porta);
  return /^\d{1,5}$/.test(porta) && n >= 1 && n <= 65535 ? { host, porta: n } : null;
}

/** Endereço de rede privada (10/8, 172.16/12, 192.168/16, 100.64/10 — o Tailscale): "a origem precisa estar na mesma rede". */
export function ehIpPrivado(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export const comandoManual = (origem: string, convite: string): string => `curl -fsSL "${origem}/motor?papel=computador&convite=${convite}" | sh`;

/** Os finais (ESTADOS_INSTALACAO_FINAIS do contrato; a web só importa tipos de src/contracts, ADR-018). */
const FINAIS: readonly InstalacaoSshDto["estado"][] = ["pronta", "erro", "cancelada"];
const ehFinal = (p: InstalacaoSshDto | null) => p !== null && FINAIS.includes(p.estado);

export type ControladorInstalarSsh = ReturnType<typeof criarInstalarSsh>;

export function criarInstalarSsh(d: DepsInstalarSsh) {
  let segredos = vazios();
  let chavePublica: string | null = null;
  let consulta: { cancelar(): void } | null = null;
  let enviandoCredencial = false;
  /** Cada pedido novo invalida as respostas atrasadas do anterior. */
  let geracao = 0;

  const atual = () => d.ler();
  const mudar = (parcial: Partial<InstalarSsh>) => {
    const a = atual();
    if (a) d.gravar({ ...a, ...parcial });
  };
  const pararConsulta = () => { consulta?.cancelar(); consulta = null; };
  const limpar = () => { segredos = vazios(); chavePublica = null; enviandoCredencial = false; pararConsulta(); };

  function credencial(metodo: MetodoSsh): CredencialSsh | null {
    if (metodo === "apelido") return null;
    const c: CredencialSsh = metodo === "chave" ? { chave: segredos.chave, ...(segredos.frase ? { frase: segredos.frase } : {}) } : { senha: segredos.senha };
    if (segredos.sudo) c.sudo = segredos.sudo;
    return c;
  }

  async function mandarCredencial(id: string, metodo: MetodoSsh, g: number) {
    const c = credencial(metodo);
    if (!c || !chavePublica || enviandoCredencial) return;
    enviandoCredencial = true;
    try {
      const cifrado = await d.cifrar(chavePublica, JSON.stringify(c));
      if (g !== geracao) return;
      await d.api.credencialSsh(id, cifrado);
    } catch (e) {
      // 409 credencial_nao_pedida: outra consulta já mandou; o resto, a próxima consulta tenta de novo.
      if (!(e instanceof ErroApi && e.status === 409)) mudar({ erro: e instanceof Error ? e.message : String(e) });
    } finally {
      enviandoCredencial = false;
    }
  }

  function agendarConsulta(g: number) {
    pararConsulta();
    consulta = d.agendar(() => { void consultar(g); }, INTERVALO_DA_CONSULTA_MS);
  }

  async function consultar(g: number) {
    const a = atual();
    const id = a?.pedido?.id;
    if (!a || !id || g !== geracao) return;
    let p: InstalacaoSshDto;
    try {
      p = await d.api.verInstalacaoSsh(id);
    } catch (e) {
      if (g !== geracao) return;
      // O pedido sumiu (o servidor reiniciou: os pedidos vivem em memória): é um "não pareou".
      if (e instanceof ErroApi && e.status === 404) { aoChegar({ ...a.pedido!, estado: "erro", motivo: "nao_pareou", pedeCredencial: false }, g); return; }
      agendarConsulta(g);
      return;
    }
    if (g !== geracao) return;
    aoChegar(p, g);
  }

  function aoChegar(p: InstalacaoSshDto, g: number) {
    const a = atual();
    if (!a) return;
    if (p.estado === "pronta") {
      limpar();
      d.gravar({ ...a, pedido: p, erro: null });
      d.aoFicarPronta();
      return;
    }
    if (p.estado === "cancelada") { limpar(); d.gravar(null); return; }
    if (p.estado === "erro") {
      pararConsulta();
      if (p.motivo === "ssh_recusou_login" || p.motivo === "frase_senha_errada") {
        if (p.motivo === "frase_senha_errada") segredos.frase = "";
        d.gravar({
          ...a, fase: "form", pedido: null, enviando: false,
          campoErro: { campo: "acesso", texto: p.motivo === "frase_senha_errada" ? "A frase-senha não abre essa chave. Confira e tente de novo." : "A máquina recusou o login com esse usuário e esse acesso." },
        });
        return;
      }
      if (p.motivo === "sem_sudo") {
        if (a.metodo === "chave" && !segredos.sudo) { d.gravar({ ...a, pedido: p, pedeSudo: true }); return; }
        segredos.sudo = "";
        d.gravar({ ...a, fase: "form", pedido: null, pedeSudo: false, enviando: false, campoErro: { campo: "usuario", texto: "Esse usuário não pode usar o sudo lá. Use um usuário com sudo (ou o root)." } });
        return;
      }
      d.gravar({ ...a, pedido: p });
      return;
    }
    d.gravar({ ...a, pedido: p });
    if (p.pedeCredencial) void mandarCredencial(p.id, a.metodo, g);
    agendarConsulta(g);
  }

  /** O que dá para conferir antes de pedir. null = pode ir. */
  function conferir(a: InstalarSsh): InstalarSsh["campoErro"] {
    if (!lerEndereco(a.endereco)) return { campo: "endereco", texto: a.endereco.trim() ? "Use host ou host:porta (por exemplo 203.0.113.7 ou vm.exemplo.com:2222)." : "Diga o endereço da máquina." };
    if (a.metodo !== "apelido" && !a.usuario.trim()) return { campo: "usuario", texto: "Diga o usuário do SSH (por exemplo ubuntu ou root)." };
    if (a.metodo === "chave" && !segredos.chave) return { campo: "acesso", texto: "Cole a chave privada ou escolha o arquivo." };
    if (a.metodo === "chave" && a.temFrase && !segredos.frase) return { campo: "acesso", texto: "Essa chave tem frase-senha: escreva a frase." };
    if (a.metodo === "senha" && !segredos.senha) return { campo: "acesso", texto: "Escreva a senha do SSH." };
    return null;
  }

  async function pedir(origemId: string | null) {
    const a = atual();
    if (!a || a.enviando) return;
    const erro = conferir(a);
    if (erro) { d.gravar({ ...a, campoErro: erro }); return; }
    const end = lerEndereco(a.endereco)!;
    const g = ++geracao;
    pararConsulta();
    d.gravar({ ...a, enviando: true, campoErro: null, erro: null, origemId, pedeSudo: false });
    try {
      const r = await d.api.pedirInstalacaoSsh({
        host: end.host, porta: end.porta, usuario: a.usuario.trim(), metodo: a.metodo, origemId, substituir: a.substituir?.confirmado === true,
      });
      if (g !== geracao) return;
      chavePublica = r.chavePublica;
      const b = atual();
      if (!b) return;
      const pedido: InstalacaoSshDto = {
        id: r.id, origemId: r.origemId, host: end.host, porta: end.porta, usuario: a.usuario.trim(), metodo: a.metodo, estado: "esperando", etapa: null,
        motivo: null, impressoes: null, linhas: [], maquinaId: null, pedeCredencial: a.metodo !== "apelido", expiraEm: r.expiraEm, atualizadoEm: Date.now(),
      };
      d.gravar({ ...b, fase: "progresso", enviando: false, origemId: r.origemId, pedido, manual: null });
      aoChegar(pedido, g);
    } catch (e) {
      if (g !== geracao) return;
      const b = atual();
      if (!b) return;
      if (e instanceof ErroApi && e.codigo === "ja_tem_computador") { d.gravar({ ...b, enviando: false, substituir: { nome: d.computadorAtual() ?? "a máquina só computador atual", confirmado: false } }); return; }
      if (e instanceof ErroApi && e.codigo === "sem_instaladora") { d.gravar({ ...b, enviando: false, instaladoras: [], erro: e.message }); return; }
      d.gravar({ ...b, enviando: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    /** Abre o diálogo e carrega as máquinas que podem instalar (a mais recente primeiro). */
    async abrir(): Promise<void> {
      limpar();
      geracao++;
      d.gravar(estadoInicial());
      try {
        const { instaladoras } = await d.api.instaladorasSsh();
        const a = atual();
        if (a) d.gravar({ ...a, instaladoras, origemId: instaladoras[0]?.id ?? null });
      } catch (e) {
        const a = atual();
        if (a) d.gravar({ ...a, instaladoras: [], erro: e instanceof Error ? e.message : String(e) });
      }
    },
    /** Endereço e usuário: o estado muda sem desenhar (o input guarda o foco), como os outros formulários. */
    campo(nome: "endereco" | "usuario", valor: string): void {
      const a = atual();
      if (!a) return;
      a[nome] = valor;
      if (a.campoErro?.campo === (nome === "endereco" ? "endereco" : "usuario")) a.campoErro = null;
    },
    /** frase/senha/sudo: só aqui, nunca no estado. */
    segredo(nome: CampoSegredo, valor: string): void {
      segredos[nome] = valor;
    },
    /** Para a tela devolver aos inputs depois de redesenhar (o HTML nunca leva o valor). */
    valorDoSegredo(nome: CampoSegredo): string {
      return segredos[nome];
    },
    async colarChave(texto: string): Promise<void> {
      if (!texto.trim()) return;
      const r = await resumoDaChave(texto);
      const a = atual();
      if (!a) return;
      if (!r) {
        d.gravar({ ...a, campoErro: { campo: "acesso", texto: pareceChavePublica(texto) ? "Essa é a chave pública (a .pub). Cole a privada, a que começa com -----BEGIN." : "Isso não parece uma chave privada SSH." } });
        return;
      }
      segredos.chave = texto.trim();
      d.gravar({ ...a, chave: r, temFrase: r.temFrase, campoErro: null });
    },
    /** NOD-94 (QA, nota do Revisor): o arquivo escolhido; grande demais avisa no campo em vez de sumir em silêncio. */
    async chaveDoArquivo(arquivo: { size: number; text(): Promise<string> }): Promise<void> {
      const a = atual();
      if (!a) return;
      if (arquivo.size >= MAX_ARQUIVO_DA_CHAVE) {
        d.gravar({ ...a, campoErro: { campo: "acesso", texto: "Esse arquivo é grande demais para ser uma chave SSH. Escolha a chave privada (id_ed25519 ou id_rsa)." } });
        return;
      }
      await this.colarChave(await arquivo.text());
    },
    trocarChave(): void {
      segredos.chave = "";
      segredos.frase = "";
      mudar({ chave: null, temFrase: false });
    },
    metodo(m: MetodoSsh): void {
      mudar({ metodo: m, campoErro: null });
    },
    temFrase(sim: boolean): void {
      if (!sim) segredos.frase = "";
      mudar({ temFrase: sim });
    },
    trocarOrigem(abrir: boolean): void {
      mudar({ trocarOrigem: abrir });
    },
    escolherOrigem(id: string): void {
      mudar({ origemId: id, trocarOrigem: false });
    },
    enviar(): Promise<void> {
      return pedir(atual()?.origemId ?? null);
    },
    /** "Substituir?" → sim: pede de novo com `substituir`. */
    confirmarSubstituir(): Promise<void> {
      const a = atual();
      if (!a?.substituir) return Promise.resolve();
      d.gravar({ ...a, substituir: { ...a.substituir, confirmado: true } });
      return pedir(a.origemId);
    },
    desistirDeSubstituir(): void {
      mudar({ substituir: null });
    },
    /** Tentar de novo (de outra origem, no `ssh_sem_rota`). Um pedido novo, com a mesma credencial. */
    tentarDeNovo(origemId?: string): Promise<void> {
      const a = atual();
      if (!a) return Promise.resolve();
      const tentadas = a.pedido?.motivo === "ssh_sem_rota" && a.pedido.origemId && !a.tentadas.includes(a.pedido.origemId) ? [...a.tentadas, a.pedido.origemId] : a.tentadas;
      d.gravar({ ...a, tentadas });
      return pedir(origemId ?? a.origemId);
    },
    /** `sem_sudo` com chave: a senha do sudo chegou; tenta de novo. */
    enviarSudo(): Promise<void> {
      const a = atual();
      if (!a) return Promise.resolve();
      if (!segredos.sudo) { d.gravar({ ...a, campoErro: { campo: "sudo", texto: "Escreva a senha do sudo." } }); return Promise.resolve(); }
      d.gravar({ ...a, campoErro: null });
      return pedir(a.origemId);
    },
    mostrarSudo(sim: boolean): void {
      mudar({ mostrarSudo: sim });
    },
    /** "Conferir o endereço": volta ao formulário com o que estava. */
    voltarAoFormulario(): void {
      geracao++;
      pararConsulta();
      mudar({ fase: "form", pedido: null, enviando: false });
    },
    async confiarNaNova(): Promise<void> {
      const a = atual();
      const id = a?.pedido?.id;
      if (!a || !id) return;
      const g = geracao;
      try {
        await d.api.confiarNaNovaSsh(id);
      } catch (e) {
        mudar({ erro: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (g !== geracao) return;
      // O pedido volta a `esperando` e pede a credencial de novo: a consulta manda.
      void consultar(g);
    },
    async abrirManual(): Promise<void> {
      const a = atual();
      if (!a) return;
      try {
        const c = await d.api.criarConvite({ substituir: a.substituir?.confirmado === true });
        mudar({ manual: comandoManual(d.origem, c.convite) });
      } catch (e) {
        mudar({ erro: e instanceof Error ? e.message : String(e) });
      }
    },
    fecharManual(): void {
      mudar({ manual: null });
    },
    segundoPlano(): void {
      mudar({ segundoPlano: true });
    },
    reabrir(): void {
      mudar({ segundoPlano: false });
    },
    /** Fechar o diálogo: com a instalação andando, vai para segundo plano; senão some (e os segredos com ele). */
    fechar(): void {
      const a = atual();
      if (a && a.fase === "progresso" && a.pedido && !ehFinal(a.pedido) && !a.pedeSudo) { mudar({ segundoPlano: true }); return; }
      geracao++;
      limpar();
      d.gravar(null);
    },
    async cancelar(): Promise<void> {
      const a = atual();
      const id = a?.pedido?.id;
      geracao++;
      const vivo = a?.pedido && !ehFinal(a.pedido);
      limpar();
      d.gravar(null);
      if (id && vivo) await d.api.cancelarInstalacaoSsh(id).catch(() => undefined);
    },
    /** Troca de pessoa/sessão: tudo some sem chamar o servidor. */
    descartar(): void {
      geracao++;
      limpar();
    },
  };
}
