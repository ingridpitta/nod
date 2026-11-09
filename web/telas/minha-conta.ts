import type { TrocarSenhaDto } from "../../src/contracts/conta.ts";
import type { ConfirmarEmailDto, ExportacaoDto, FormasDto, MinhaContaDto, PerfilDto, ReautenticarDto } from "../../src/contracts/minha-conta.ts";
import { ErroApi } from "../lib/erro-api.ts";
import { esc } from "../lib/escape.ts";

/**
 * NOD-346 (ADR-126, protótipo aprovado da Jornada 3): a seção Minha conta de Seu espaço — perfil e "Sobre mim", formas de
 * entrada, troca de e-mail e senha, exportação e exclusão com 30 dias para desfazer.
 *
 * O estado vive aqui (como os cartões da conta, conta-no-chat.ts), fora do reducer. Senha e código ficam só no DOM e na
 * chamada; o rascunho do perfil (nome e Sobre mim) fica em memória para atravessar um redesenho no meio da digitação.
 * Ação de risco que volta com `motivo: reautenticar` abre a janela "Confirme que é você" e é refeita depois dela.
 */
/** Os limites do domínio (src/domain/minha-conta.ts), repetidos porque a web não importa o domínio; um teste os compara. */
export const NOME_MAX = 60;
export const SOBRE_MIM_MAX = 2000;

export type ApiMinhaConta = {
  estado(): Promise<MinhaContaDto>;
  salvarPerfil(p: { nome: string; sobreMim: string }): Promise<PerfilDto>;
  definirFoto(base64: string | null): Promise<PerfilDto>;
  reautenticarComSenha(senha: string): Promise<ReautenticarDto>;
  enviarCodigo(): Promise<{ enviado: boolean; expiraEm: number }>;
  reautenticarComCodigo(codigo: string): Promise<ReautenticarDto>;
  removerGoogle(): Promise<{ formas: FormasDto }>;
  pedirTrocaEmail(email: string): Promise<{ enviado: boolean; para: string; expiraEm: number }>;
  cancelarTrocaEmail(): Promise<unknown>;
  confirmarEmail(token: string): Promise<ConfirmarEmailDto>;
  trocarSenha(atual: string, nova: string): Promise<TrocarSenhaDto>;
  pedirExportacao(): Promise<ExportacaoDto>;
  /** Baixa o zip (a rota exige reautenticação: o 403 volta como ErroApi). */
  baixarExportacao(id: string): Promise<void>;
  excluir(): Promise<{ pedidaEm: number; purgarEm: number }>;
  desfazerExclusao(): Promise<{ desfeita: boolean }>;
};

type ElAcao = { dataset: { [k: string]: string | undefined } };
type Formulario = object;

export type Aba = "perfil" | "acesso" | "dados";
export type Passo = "email" | "senha" | "excluir" | null;
/** A ação de risco que espera a confirmação de identidade. */
export type Pendente = "remover-google" | "trocar-email" | "baixar" | "excluir";
export const NAO_ENVIOU_CODIGO = "Não conseguimos enviar o código agora. Tente de novo em instantes.";
export const NAO_ENVIOU_LINK = "Não conseguimos enviar o link agora. Use Reenviar e-mail em instantes.";
export type Janela = { pendente: Pendente; modo: "senha" | "codigo"; codigoEnviado: boolean; erro: string | null };

export type VistaMinhaConta = {
  dados: MinhaContaDto | null;
  erroCarga: string | null;
  aba: Aba;
  passo: Passo;
  janela: Janela | null;
  ocupado: string | null;
  /** "Alterações salvas…", "Senha trocada…": a linha de status ao lado da ação. */
  salvo: string | null;
  /** O erro no lugar certo: campo do perfil, passo, exportação. */
  erro: { onde: "nome" | "sobreMim" | "foto" | "email" | "senha" | "acesso" | "dados"; texto: string } | null;
  /** O aviso no topo (e-mail trocado, exclusão desfeita). */
  aviso: { tom: "ok" | "erro"; texto: string } | null;
  rascunho: { nome: string; sobreMim: string } | null;
  emailNovo: string;
  fotoVersao: number;
};

export type DepsMinhaConta = {
  api(): ApiMinhaConta;
  aoMudar(): void;
  agora(): number;
  campo(form: Formulario, nome: string): string;
  /** Lê o arquivo escolhido, reduz (até 512 px, JPEG) e devolve o base64; null = não é imagem que dê para ler. */
  lerFoto(el: ElAcao): Promise<string | null>;
  /** Liga o relógio que relê o estado enquanto a exportação está sendo preparada. */
  agendar(fn: () => void, ms: number): () => void;
  /** Põe o foco no primeiro elemento da seção que casa com o seletor (a janela que abriu, o botão que a abriu). */
  focar?(seletor: string): void;
};

/** Revisão do PR 506: quem abriu a janela "Confirme que é você" recebe o foco de volta quando ela fecha. */
const GATILHO: Record<Pendente, string> = {
  "remover-google": '[data-act="mc-google-remover"]',
  "trocar-email": '[data-form="mc-email"] [type="submit"]',
  baixar: '[data-act="mc-baixar"]',
  excluir: '[data-act="mc-excluir"]',
};
/** O primeiro campo da janela (a senha, o código) ou, sem campo, o botão principal ("Enviar código"). */
export const FOCO_DA_JANELA = '.conta-modal input:not([type="hidden"]), .conta-modal button.pri';

const MOTIVO_TEXTO: Record<string, string> = {
  ultima_forma_de_entrada: "Esta é sua última forma de entrada. Defina uma senha antes de desconectar o Google.",
  email_em_uso: "Esse e-mail já é de outra conta.",
  email_igual: "Esse já é o seu e-mail.",
  email: "Confira o e-mail digitado.",
  conta_de_equipe: "Este espaço é de uma equipe: a exclusão vale só para o espaço pessoal.",
  exclusao_programada: "A exclusão já está programada.",
  sem_conta: "Seu espaço ainda não tem conta.",
  "nome:nome_vazio": "Escreva seu nome.",
  "nome:nome_longo": `Use até ${NOME_MAX} caracteres.`,
  "sobreMim:sobre_mim_longo": `Use até ${SOBRE_MIM_MAX} caracteres.`,
  "foto:formato": "Não deu para ler a imagem. Use JPG ou PNG.",
  "foto:tipo": "Use uma imagem JPG ou PNG.",
  "foto:tamanho": "A imagem ficou grande demais. Tente outra.",
};

/** A frase do erro para a pessoa: o motivo conhecido, senão a frase do servidor. */
export function fraseDoErro(e: unknown): string {
  if (e instanceof ErroApi) return (e.motivo && MOTIVO_TEXTO[e.motivo]) || e.message;
  return "Não deu para concluir. Tente de novo.";
}

const pedeReautenticacao = (e: unknown) => e instanceof ErroApi && e.motivo === "reautenticar";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "22 nov 2026" */
export function dataCurta(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`;
}
/** "hoje, 15:12" ou "22 nov, 15:12" */
export function quando(ms: number, agora: number): string {
  const d = new Date(ms);
  const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const hoje = new Date(agora);
  const mesmoDia = d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth() && d.getDate() === hoje.getDate();
  return `${mesmoDia ? "hoje" : `${d.getDate()} ${MES[d.getMonth()]}`}, ${hora}`;
}
/** Dias que faltam, arredondando para cima (um dia e uma hora = 2 dias). */
export function diasAte(ms: number, agora: number): number {
  return Math.max(0, Math.ceil((ms - agora) / 86_400_000));
}
export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
export function iniciais(nome: string | null, email: string | null): string {
  const base = (nome ?? "").trim() || (email ?? "").split("@")[0] || "";
  const partes = base.split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? `${[...partes[0]!][0]}${[...partes[partes.length - 1]!][0]}` : [...(partes[0] ?? "?")].slice(0, 2).join("");
  return letras.toUpperCase() || "?";
}

const CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const ALERTA = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/><circle cx="12" cy="12" r="9"/></svg>`;
const ARQUIVO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;

const bt = (act: string, rotulo: string, o: { classe?: string; ocupado?: boolean; desabilitado?: boolean; dados?: Record<string, string>; descrito?: string } = {}) =>
  `<button type="button" class="bt ${o.classe ?? ""}" data-act="${act}"${Object.entries(o.dados ?? {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}${o.descrito ? ` aria-describedby="${o.descrito}"` : ""}${o.ocupado ? ' disabled aria-busy="true"' : o.desabilitado ? " disabled" : ""}>${esc(rotulo)}</button>`;
const enviar = (rotulo: string, ocupado: boolean, andamento: string, classe = "pri") =>
  `<button type="submit" class="bt ${classe}"${ocupado ? ' disabled aria-busy="true"' : ""}>${esc(ocupado ? andamento : rotulo)}</button>`;
const campoSenha = (nome: string, rotulo: string, nova: boolean, extra = "") =>
  `<label class="conta-campo"><span>${esc(rotulo)}</span><span class="cc-senha"><input name="${nome}" data-manter-foco="mc-${nome}" type="password" autocomplete="${nova ? "new-password" : "current-password"}" required${nova ? ' minlength="12"' : ""} maxlength="128"${extra}><button type="button" class="cc-mostrar" data-act="conta-mostrar" aria-pressed="false">Mostrar</button></span></label>`;

export function criarMinhaConta(deps: DepsMinhaConta) {
  let v: VistaMinhaConta = { dados: null, erroCarga: null, aba: "perfil", passo: null, janela: null, ocupado: null, salvo: null, erro: null, aviso: null, rascunho: null, emailNovo: "", fotoVersao: 0 };
  let pararRelogio: (() => void) | null = null;
  let aberta = false;

  const mudar = (p: Partial<VistaMinhaConta>) => {
    v = { ...v, ...p };
    vigiarExportacao();
    deps.aoMudar();
  };

  /** Enquanto a exportação está sendo preparada e a seção está aberta, relê a cada 5 s. */
  function vigiarExportacao(): void {
    const preparando = aberta && v.dados?.exportacao?.estado === "pedida";
    if (preparando && !pararRelogio) pararRelogio = deps.agendar(() => void recarregar(), 5000);
    if (!preparando && pararRelogio) { pararRelogio(); pararRelogio = null; }
  }

  async function recarregar(): Promise<void> {
    try {
      mudar({ dados: await deps.api().estado(), erroCarga: null });
    } catch (e) {
      mudar({ erroCarga: v.dados ? null : fraseDoErro(e) });
    }
  }

  async function trabalhar(qual: string, fn: () => Promise<void>): Promise<void> {
    if (v.ocupado) return;
    mudar({ ocupado: qual, salvo: null, erro: null });
    try {
      await fn();
    } finally {
      mudar({ ocupado: null });
    }
  }

  /** Faz a ação de risco; sem confirmação recente, abre a janela e guarda a ação para depois. */
  async function arriscada(pendente: Pendente, fn: () => Promise<void>, onde: NonNullable<VistaMinhaConta["erro"]>["onde"]): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (pedeReautenticacao(e)) {
        const senha = v.dados?.conta?.formas.senha ?? false;
        mudar({ janela: { pendente, modo: senha ? "senha" : "codigo", codigoEnviado: false, erro: null } });
        deps.focar?.(FOCO_DA_JANELA);
        return;
      }
      mudar({ erro: { onde, texto: fraseDoErro(e) } });
    }
  }

  async function fazer(p: Pendente): Promise<void> {
    const api = deps.api();
    switch (p) {
      case "remover-google":
        return arriscada(p, async () => {
          const r = await api.removerGoogle();
          if (v.dados?.conta) mudar({ dados: { ...v.dados, conta: { ...v.dados.conta, formas: r.formas } }, salvo: "Google desconectado. Você entra com e-mail e senha." });
        }, "acesso");
      case "trocar-email":
        return arriscada(p, async () => {
          const r = await api.pedirTrocaEmail(v.emailNovo.trim());
          await recarregar();
          // Codex no PR 506: o servidor devolve `enviado: false` quando o provedor falha; não fingir que o link saiu.
          if (!r.enviado) mudar({ erro: { onde: "email", texto: NAO_ENVIOU_LINK } });
        }, "email");
      case "baixar":
        return arriscada(p, async () => {
          const id = v.dados?.exportacao?.id;
          if (id) await api.baixarExportacao(id);
        }, "dados");
      case "excluir":
        return arriscada(p, async () => {
          await api.excluir();
          await recarregar();
          mudar({ passo: null });
        }, "dados");
    }
  }

  async function depoisDeConfirmar(janela: Janela): Promise<void> {
    mudar({ janela: null, dados: v.dados ? { ...v.dados, reautenticadaAte: deps.agora() + 10 * 60_000 } : v.dados });
    await fazer(janela.pendente);
    deps.focar?.(GATILHO[janela.pendente]);
  }

  /** Fecha a janela sem fazer a ação e devolve o foco a quem a abriu (o ×, o Esc). */
  function fecharJanela(): void {
    const j = v.janela;
    if (!j) return;
    mudar({ janela: null });
    deps.focar?.(GATILHO[j.pendente]);
  }

  const acoes: Record<string, (el: ElAcao) => Promise<void> | void> = {
    "mc-aba": (el) => {
      const aba = el.dataset.aba;
      if (aba === "perfil" || aba === "acesso" || aba === "dados") mudar({ aba, passo: null, salvo: null, erro: null, aviso: v.aviso?.tom === "ok" ? v.aviso : null });
    },
    "mc-passo": (el) => {
      const p = el.dataset.passo;
      mudar({ passo: p === "email" || p === "senha" || p === "excluir" ? p : null, salvo: null, erro: null });
    },
    "mc-recarregar": () => recarregar(),
    "mc-aviso-fechar": () => mudar({ aviso: null }),
    "mc-foto-remover": () => trabalhar("foto", async () => {
      try {
        const perfil = await deps.api().definirFoto(null);
        if (v.dados) mudar({ dados: { ...v.dados, perfil }, fotoVersao: v.fotoVersao + 1 });
      } catch (e) {
        mudar({ erro: { onde: "foto", texto: fraseDoErro(e) } });
      }
    }),
    "mc-foto-escolhida": (el) => trabalhar("foto", async () => {
      const base64 = await deps.lerFoto(el);
      if (base64 === null) return mudar({ erro: { onde: "foto", texto: "Não deu para ler a imagem. Use JPG ou PNG." } });
      try {
        const perfil = await deps.api().definirFoto(base64);
        if (v.dados) mudar({ dados: { ...v.dados, perfil }, fotoVersao: v.fotoVersao + 1 });
      } catch (e) {
        mudar({ erro: { onde: "foto", texto: fraseDoErro(e) } });
      }
    }),
    "mc-google-remover": () => trabalhar("google", () => fazer("remover-google")),
    "mc-email-cancelar": () => trabalhar("email-cancelar", async () => {
      try {
        await deps.api().cancelarTrocaEmail();
        await recarregar();
        mudar({ salvo: "Troca cancelada. Seu e-mail continua o mesmo." });
      } catch (e) {
        mudar({ erro: { onde: "email", texto: fraseDoErro(e) } });
      }
    }),
    "mc-email-reenviar": () => {
      const para = v.dados?.conta?.trocaEmail?.para;
      if (!para) return;
      v = { ...v, emailNovo: para };
      return trabalhar("email", () => fazer("trocar-email"));
    },
    "mc-baixar": () => trabalhar("baixar", () => fazer("baixar")),
    "mc-exportar": () => trabalhar("exportar", async () => {
      try {
        const exportacao = await deps.api().pedirExportacao();
        if (v.dados) mudar({ dados: { ...v.dados, exportacao } });
      } catch (e) {
        mudar({ erro: { onde: "dados", texto: fraseDoErro(e) } });
      }
    }),
    "mc-excluir": () => trabalhar("excluir", () => fazer("excluir")),
    "mc-desfazer": () => trabalhar("desfazer", async () => {
      try {
        await deps.api().desfazerExclusao();
        await recarregar();
        mudar({ aviso: { tom: "ok", texto: "Exclusão desfeita. Sua conta e seus dados continuam ativos; nada foi apagado." } });
      } catch (e) {
        mudar({ erro: { onde: "dados", texto: fraseDoErro(e) } });
      }
    }),
    "mc-janela-fechar": () => fecharJanela(),
    "mc-janela-modo": (el) => {
      if (!v.janela) return;
      mudar({ janela: { ...v.janela, modo: el.dataset.modo === "codigo" ? "codigo" : "senha", erro: null } });
      deps.focar?.(FOCO_DA_JANELA);
    },
    "mc-codigo-enviar": () => trabalhar("codigo", async () => {
      const j = v.janela;
      if (!j) return;
      try {
        const r = await deps.api().enviarCodigo();
        // Codex no PR 506: código que não saiu não abre o campo do código; a pessoa tenta de novo.
        if (!r.enviado) return mudar({ janela: { ...j, modo: "codigo", codigoEnviado: false, erro: NAO_ENVIOU_CODIGO } });
        mudar({ janela: { ...j, modo: "codigo", codigoEnviado: true, erro: null } });
        // O campo do código só existe agora; o foco vai para ele depois do redesenho do fim do trabalho.
        queueMicrotask(() => deps.focar?.(FOCO_DA_JANELA));
      } catch (e) {
        mudar({ janela: { ...j, erro: fraseDoErro(e) } });
      }
    }),
  };

  const forms: Record<string, (form: Formulario) => Promise<void>> = {
    "mc-perfil": (form) => trabalhar("perfil", async () => {
      const nome = deps.campo(form, "nome");
      const sobreMim = deps.campo(form, "sobreMim");
      v = { ...v, rascunho: { nome, sobreMim } };
      try {
        const perfil = await deps.api().salvarPerfil({ nome, sobreMim });
        mudar({ dados: v.dados ? { ...v.dados, perfil } : v.dados, rascunho: null, salvo: "Alterações salvas. Valem no próximo turno." });
      } catch (e) {
        const motivo = e instanceof ErroApi ? e.motivo ?? "" : "";
        mudar({ erro: { onde: motivo.startsWith("nome:") ? "nome" : "sobreMim", texto: e instanceof ErroApi && e.motivo ? fraseDoErro(e) : "Não deu para salvar. Confira sua conexão e tente de novo." } });
      }
    }),
    "mc-email": (form) => {
      v = { ...v, emailNovo: deps.campo(form, "email") };
      return trabalhar("email", () => fazer("trocar-email"));
    },
    "mc-senha": (form) => trabalhar("senha", async () => {
      const atual = deps.campo(form, "atual");
      const nova = deps.campo(form, "nova");
      if (nova !== deps.campo(form, "confirmar")) return mudar({ erro: { onde: "senha", texto: "A confirmação não é igual à nova senha." } });
      try {
        const r = await deps.api().trocarSenha(atual, nova);
        if (r.resultado === "recusado") return mudar({ erro: { onde: "senha", texto: "A senha atual não confere." } });
        mudar({ passo: null, salvo: r.encerradas > 0 ? `Senha trocada. ${r.encerradas === 1 ? "A outra sessão foi encerrada" : `As outras ${r.encerradas} sessões foram encerradas`}.` : "Senha trocada." });
      } catch (e) {
        mudar({ erro: { onde: "senha", texto: fraseDoErro(e) } });
      }
    }),
    "mc-confirmar-senha": (form) => trabalhar("confirmar", async () => {
      const j = v.janela;
      if (!j) return;
      try {
        const r = await deps.api().reautenticarComSenha(deps.campo(form, "senha"));
        if (r.resultado !== "ok") return mudar({ janela: { ...j, erro: "A senha não confere." } });
        await depoisDeConfirmar(j);
      } catch (e) {
        mudar({ janela: { ...j, erro: fraseDoErro(e) } });
      }
    }),
    "mc-confirmar-codigo": (form) => trabalhar("confirmar", async () => {
      const j = v.janela;
      if (!j) return;
      try {
        const r = await deps.api().reautenticarComCodigo(deps.campo(form, "codigo").replace(/\s/g, ""));
        if (r.resultado === "ok") return await depoisDeConfirmar(j);
        mudar({ janela: { ...j, codigoEnviado: r.resultado === "errado" && r.restantes > 0, erro: r.resultado === "errado" && r.restantes > 0 ? `Código errado. Mais ${r.restantes} ${r.restantes === 1 ? "tentativa" : "tentativas"}.` : "O código venceu. Peça outro." } });
      } catch (e) {
        mudar({ janela: { ...j, erro: fraseDoErro(e) } });
      }
    }),
  };

  return {
    acoes,
    forms,
    vista: () => v,
    /** A janela "Confirme que é você" está aberta (o Esc de Seu espaço fecha só ela). */
    janelaAberta: () => v.janela !== null,
    fecharJanela,
    /** Seu espaço abriu a seção: relê o estado (a exportação pode ter ficado pronta). */
    abrir(): void {
      aberta = true;
      void recarregar();
    },
    fechar(): void {
      aberta = false;
      mudar({ janela: null, passo: null, salvo: null, erro: null });
    },
    /** O rascunho do perfil acompanha a digitação (sem redesenhar). */
    digitou(nome: string, valor: string): void {
      if (nome !== "nome" && nome !== "sobreMim") return;
      const base = v.rascunho ?? { nome: v.dados?.perfil.nome ?? "", sobreMim: v.dados?.perfil.sobreMim ?? "" };
      v = { ...v, rascunho: { ...base, [nome]: valor } };
    },
    /** O link do e-mail novo (`#confirmar-email=<token>`): confirma e diz o resultado no topo da seção. */
    async confirmarEmail(token: string | null): Promise<void> {
      if (!token) return mudar({ aba: "acesso", aviso: { tom: "erro", texto: "Este link de confirmação não vale mais. Peça a troca de novo." } });
      try {
        const r = await deps.api().confirmarEmail(token);
        mudar({
          aba: "acesso",
          aviso: r.resultado === "trocado"
            ? { tom: "ok", texto: `E-mail trocado para ${r.email}. Use o endereço novo para entrar${r.encerradas > 0 ? "; as outras sessões foram encerradas" : ""}.` }
            : { tom: "erro", texto: r.resultado === "email_em_uso" ? "Esse e-mail passou a ser de outra conta. Seu e-mail continua o mesmo." : "Este link de confirmação não vale mais. Peça a troca de novo." },
        });
      } catch (e) {
        mudar({ aba: "acesso", aviso: { tom: "erro", texto: fraseDoErro(e) } });
      }
    },
    render: () => renderMinhaConta(v, deps.agora()),
  };
}

export type TelaMinhaConta = ReturnType<typeof criarMinhaConta>;

// ------------------------------------------------------------------------------------------------- render

export function renderMinhaConta(v: VistaMinhaConta, agora: number): string {
  const d = v.dados;
  if (!d) {
    return `<section class="conta-pagina" aria-busy="${v.erroCarga ? "false" : "true"}"><header class="conta-cab"><div><h2>Minha conta</h2><p>Cuide do seu perfil, acesso e dados.</p></div></header>${
      v.erroCarga ? `<p class="cc-erro" role="alert">${esc(v.erroCarga)}</p><div class="conta-acoes">${bt("mc-recarregar", "Tentar de novo")}</div>` : `<p class="mudo" role="status">Carregando…</p>`
    }</section>`;
  }
  const email = d.conta?.email ?? null;
  const avatar = d.perfil.temFoto ? `<img class="conta-avatar" src="/api/conta/eu/foto?v=${v.fotoVersao}" alt="">` : `<span class="conta-avatar" aria-hidden="true">${esc(iniciais(d.perfil.nome, email))}</span>`;
  const abas: [Aba, string][] = d.conta ? [["perfil", "Perfil"], ["acesso", "Formas de entrada"], ["dados", "Seus dados"]] : [["perfil", "Perfil"]];
  const aba = abas.some(([a]) => a === v.aba) ? v.aba : "perfil";
  const aviso = v.aviso
    ? `<div class="processo ${v.aviso.tom === "ok" ? "pronto" : "erro"}" role="${v.aviso.tom === "ok" ? "status" : "alert"}"><span class="processo-ic">${v.aviso.tom === "ok" ? CHECK : ALERTA}</span><div><p>${esc(v.aviso.texto)}</p></div>${bt("mc-aviso-fechar", "Ok", { classe: "sm" })}</div>`
    : "";
  const corpo = aba === "perfil" ? secaoPerfil(v, d) : aba === "acesso" ? secaoAcesso(v, d) : secaoDados(v, d, agora);
  return `<div class="conta-pagina">
    <header class="conta-cab">${avatar}<div><h2>Minha conta</h2><p>Cuide do seu perfil, acesso e dados.</p></div></header>
    ${abas.length > 1 ? `<nav class="conta-abas" aria-label="Seções da conta">${abas.map(([a, nome]) => `<button type="button" class="conta-aba" data-act="mc-aba" data-aba="${a}"${a === aba ? ' aria-current="page"' : ""}>${esc(nome)}</button>`).join("")}</nav>` : ""}
    <div class="conta-corpo">${aviso}${corpo}</div>
    ${v.janela ? janela(v, v.janela, d) : ""}
  </div>`;
}

const erroNo = (v: VistaMinhaConta, onde: NonNullable<VistaMinhaConta["erro"]>["onde"], id: string) =>
  v.erro?.onde === onde ? `<small id="${id}" class="campo-erro" role="alert">${esc(v.erro.texto)}</small>` : "";
const salvo = (v: VistaMinhaConta) => `<span class="conta-salvo" role="status">${v.salvo ? `${CHECK}${esc(v.salvo)}` : ""}</span>`;

function secaoPerfil(v: VistaMinhaConta, d: MinhaContaDto): string {
  const nome = v.rascunho?.nome ?? d.perfil.nome ?? "";
  const sobre = v.rascunho?.sobreMim ?? d.perfil.sobreMim ?? "";
  const o = v.ocupado === "perfil";
  const fotoOcupada = v.ocupado === "foto";
  const erroNome = v.erro?.onde === "nome";
  const erroSobre = v.erro?.onde === "sobreMim";
  const fotoMini = d.perfil.temFoto ? `<img class="foto-avatar" src="/api/conta/eu/foto?v=${v.fotoVersao}" alt="Sua foto">` : `<span class="foto-avatar" aria-hidden="true">${esc(iniciais(d.perfil.nome, d.conta?.email ?? null))}</span>`;
  return `<section class="conta-secao"><h3>Perfil</h3>
    <div class="foto-linha">${fotoMini}<div><b>Sua foto</b><p>JPG ou PNG.</p>${erroNo(v, "foto", "foto-erro")}</div>
      <label class="bt sm mc-foto${fotoOcupada ? " ocupado" : ""}"${fotoOcupada ? ' aria-busy="true"' : ""}><input type="file" accept="image/png,image/jpeg" data-act-change="mc-foto-escolhida" class="mc-arquivo"${fotoOcupada ? " disabled" : ""}>${fotoOcupada ? "Enviando…" : d.perfil.temFoto ? "Trocar foto" : "Escolher foto"}</label>
      ${d.perfil.temFoto ? bt("mc-foto-remover", "Remover", { classe: "sm cc-link", ocupado: fotoOcupada }) : ""}
    </div>
    <form class="conta-form" data-form="mc-perfil" novalidate>
      <label class="conta-campo"><span>Nome</span><input name="nome" data-manter-foco="mc-nome" type="text" autocomplete="name" maxlength="${NOME_MAX}" value="${esc(nome)}" data-mc-rascunho="nome"${erroNome ? ' aria-invalid="true" aria-describedby="nome-erro"' : ""}>${erroNo(v, "nome", "nome-erro")}</label>
      ${d.conta ? `<div class="conta-campo"><span>E-mail<span class="campo-estado">Verificado</span></span><p class="mc-valor">${esc(d.conta.email)}</p><small>Para trocar, vá em ${`<button type="button" class="ob-link" data-act="mc-aba" data-aba="acesso">Formas de entrada</button>`}: o novo endereço é confirmado antes.</small></div>` : ""}
      <label class="conta-campo"><span>Sobre mim</span><textarea name="sobreMim" data-manter-foco="mc-sobre" rows="4" maxlength="${SOBRE_MIM_MAX}" data-mc-rascunho="sobreMim" aria-describedby="sobre-ajuda${erroSobre ? " sobre-erro" : ""}"${erroSobre ? ' aria-invalid="true"' : ""}>${esc(sobre)}</textarea>${erroNo(v, "sobreMim", "sobre-erro")}<small id="sobre-ajuda">Vale no próximo turno dos seus bots. Não muda conversas passadas nem é enviado a bots de equipe.</small></label>
      <div class="conta-acoes">${salvo(v)}${enviar("Salvar alterações", o, "Salvando…")}</div>
    </form>
    ${d.conta ? "" : `<p class="beta-nota">Seu espaço ainda não tem conta. Crie uma pelo menu da sua foto para escolher formas de entrada, exportar seus dados ou excluir a conta.</p>`}
  </section>`;
}

function secaoAcesso(v: VistaMinhaConta, d: MinhaContaDto): string {
  const c = d.conta!;
  if (v.passo === "email") return passoEmail(v, c);
  if (v.passo === "senha") return passoSenha(v);
  const ultimaGoogle = c.formas.google && !c.formas.senha;
  const google = c.formas.google
    ? `<div class="metodo"><span class="metodo-ic"><span class="conta-logo google" aria-hidden="true">G</span></span><div class="metodo-txt"><b>Google</b><span>${esc(c.email)}</span>${ultimaGoogle ? `<p class="metodo-nota" id="ultima-ajuda">É sua única forma de entrada. Para desconectar, entre com uma senha primeiro.</p>` : ""}</div><span class="metodo-status">${CHECK}Conectado</span>${bt("mc-google-remover", v.ocupado === "google" ? "Desconectando…" : "Desconectar", { classe: "sm", ocupado: v.ocupado === "google", desabilitado: ultimaGoogle, ...(ultimaGoogle ? { descrito: "ultima-ajuda" } : {}) })}</div>`
    : `<div class="metodo metodo-vazio"><span class="metodo-ic"><span class="conta-logo google" aria-hidden="true">G</span></span><div class="metodo-txt"><b>Google</b><span>Não conectado</span></div></div>`;
  const troca = c.trocaEmail ? `<p class="metodo-nota">Aguardando confirmação de <strong>${esc(c.trocaEmail.para)}</strong>.</p>` : "";
  const emailLinha = `<div class="metodo"><span class="metodo-ic"><span class="conta-logo" aria-hidden="true">@</span></span><div class="metodo-txt"><b>E-mail</b><span>${esc(c.email)}</span>${troca}</div><span class="metodo-status">${CHECK}Verificado</span>${bt("mc-passo", "Trocar", { classe: "sm", dados: { passo: "email" } })}</div>`;
  const senha = c.formas.senha
    ? `<div class="metodo"><span class="metodo-ic"><span class="conta-logo" aria-hidden="true">••</span></span><div class="metodo-txt"><b>Senha</b><span>Definida</span></div><span class="metodo-status">${CHECK}Definida</span>${bt("mc-passo", "Trocar", { classe: "sm", dados: { passo: "senha" } })}</div>`
    : `<div class="metodo metodo-vazio"><span class="metodo-ic"><span class="conta-logo" aria-hidden="true">••</span></span><div class="metodo-txt"><b>Senha</b><span>Nenhuma senha definida</span></div></div>`;
  return `<section class="conta-secao"><h3>Formas de entrada</h3>
    <p class="secao-intro">Mantenha pelo menos uma forma de entrada para não perder o acesso.</p>
    <div class="metodos">${google}${emailLinha}${senha}</div>
    ${erroNo(v, "acesso", "acesso-erro")}
    <div class="conta-acoes">${salvo(v)}</div>
  </section>`;
}

function passoEmail(v: VistaMinhaConta, c: NonNullable<MinhaContaDto["conta"]>): string {
  const volta = `<button type="button" class="ob-link passo-volta" data-act="mc-passo" data-passo="">← Formas de entrada</button>`;
  if (c.trocaEmail) {
    return `<section class="conta-secao"><h3>Trocar e-mail</h3>${volta}
      <div class="confirmacao-email"><span class="confirmacao-ic" aria-hidden="true">✉</span><div><b>Confirme o novo endereço</b><p>${v.erro?.onde === "email" && v.erro.texto === NAO_ENVIOU_LINK ? `Pedimos a troca para <strong>${esc(c.trocaEmail.para)}</strong>, mas o e-mail não saiu.` : `Enviamos um link para <strong>${esc(c.trocaEmail.para)}</strong>.`} Até você confirmar, continue entrando com <strong>${esc(c.email)}</strong>.</p>${bt("mc-email-reenviar", v.ocupado === "email" ? "Reenviando…" : "Reenviar e-mail", { classe: "sm cc-link", ocupado: v.ocupado === "email" })}</div></div>
      ${erroNo(v, "email", "email-erro")}
      <div class="conta-acoes">${salvo(v)}${bt("mc-email-cancelar", v.ocupado === "email-cancelar" ? "Cancelando…" : "Cancelar troca", { ocupado: v.ocupado === "email-cancelar" })}</div>
    </section>`;
  }
  const erro = v.erro?.onde === "email";
  return `<section class="conta-secao"><h3>Trocar e-mail</h3>${volta}
    <form class="conta-form" data-form="mc-email">
      <label class="conta-campo"><span>Novo e-mail</span><input name="email" data-manter-foco="mc-email" type="email" autocomplete="email" required maxlength="254" spellcheck="false" autocapitalize="off" value="${esc(v.emailNovo)}"${erro ? ' aria-invalid="true" aria-describedby="email-erro"' : ""}>${erroNo(v, "email", "email-erro")}<small>Enviamos um link para o endereço novo. O atual continua valendo até você confirmar.</small></label>
      <div class="conta-acoes">${salvo(v)}${enviar("Enviar link", v.ocupado === "email", "Enviando…")}</div>
    </form>
  </section>`;
}

function passoSenha(v: VistaMinhaConta): string {
  const erro = v.erro?.onde === "senha";
  return `<section class="conta-secao"><h3>Trocar senha</h3>
    <button type="button" class="ob-link passo-volta" data-act="mc-passo" data-passo="">← Formas de entrada</button>
    <form class="conta-form" data-form="mc-senha">
      ${campoSenha("atual", "Senha atual", false)}
      ${campoSenha("nova", "Nova senha", true, ' aria-describedby="senha-regras"')}
      <small id="senha-regras" class="mc-regra">Pelo menos 12 caracteres. As outras sessões saem ao trocar.</small>
      ${campoSenha("confirmar", "Confirmar nova senha", true, erro ? ' aria-invalid="true" aria-describedby="senha-erro"' : "")}
      ${erroNo(v, "senha", "senha-erro")}
      <div class="conta-acoes">${enviar("Trocar senha", v.ocupado === "senha", "Trocando…")}</div>
    </form>
  </section>`;
}

function blocoExportacao(v: VistaMinhaConta, e: ExportacaoDto | null, agora: number): string {
  const pedir = (rotulo: string, classe = "pri") => bt("mc-exportar", v.ocupado === "exportar" ? "Pedindo…" : rotulo, { classe, ocupado: v.ocupado === "exportar" });
  const lista = `<div class="exporta-lista"><b>A exportação inclui</b><p>Perfil, conversas, bots, memórias, rotinas, decisões e uma trilha legível.</p><small>Senhas, códigos, tokens, chaves de máquina e credenciais de apps conectados nunca entram no arquivo.</small></div>`;
  const erro = erroNo(v, "dados", "dados-erro");
  if (e?.estado === "pedida") {
    return `<section class="conta-secao"><h3>Exportar meus dados</h3>
      <div class="processo" role="status"><span class="processo-ic"><span class="ob-gira grande" aria-hidden="true"></span></span><div><b>Preparando sua exportação</b><p>Pedida ${esc(quando(e.pedidaEm, agora))}. Pode sair desta tela: quando voltar, ela estará aqui.</p></div></div>${lista}${erro}
    </section>`;
  }
  if (e?.estado === "pronta") {
    return `<section class="conta-secao"><h3>Exportar meus dados</h3>
      <div class="processo pronto"><span class="processo-ic">${ARQUIVO}</span><div><b>Exportação pronta</b><p>Disponível até ${esc(quando(e.expiraEm ?? agora, agora))}. Para baixar, confirme que é você.</p><span class="processo-status">Arquivo ZIP${e.tamanho !== null ? ` · ${esc(tamanhoLegivel(e.tamanho))}` : ""}</span></div>${bt("mc-baixar", v.ocupado === "baixar" ? "Baixando…" : "Baixar", { classe: "pri", ocupado: v.ocupado === "baixar" })}</div>
      <div class="conta-acoes">${pedir("Pedir uma nova exportação", "cc-link")}</div>${erro}
    </section>`;
  }
  if (e?.estado === "falhou") {
    const grande = e.motivo === "grande_demais";
    return `<section class="conta-secao"><h3>Exportar meus dados</h3>
      <div class="processo erro" role="alert"><span class="processo-ic">${ALERTA}</span><div><b>Não conseguimos preparar o arquivo</b><p>${grande ? "Seus dados passaram do tamanho que o beta exporta de uma vez. Relate o problema e a gente prepara para você." : "Nenhum dado foi perdido. Tente de novo; se falhar, relate o problema."}</p><span class="processo-status">Pedida ${esc(quando(e.pedidaEm, agora))}</span></div>${grande ? "" : pedir("Tentar de novo", "")}</div>${erro}
    </section>`;
  }
  return `<section class="conta-secao"><h3>Exportar meus dados</h3><p class="secao-intro">Receba uma cópia para guardar ou levar para outro lugar.</p>${lista}${erro}<div class="conta-acoes">${pedir("Pedir exportação")}</div></section>`;
}

function blocoExclusao(v: VistaMinhaConta, c: NonNullable<MinhaContaDto["conta"]>, purgaLigada: boolean, agora: number): string {
  const pausada = purgaLigada ? "" : `<p class="beta-nota">No beta, a purga automática ainda está pausada: até ela ser ligada, nada é apagado e você pode desfazer quando quiser.</p>`;
  if (c.exclusao) {
    const dias = diasAte(c.exclusao.purgarEm, agora);
    return `<section class="conta-secao"><h3>Exclusão programada</h3>
      <div class="exclusao-status"><span class="exclusao-dia"><b>${dias}</b><small>${dias === 1 ? "dia" : "dias"}</small></span><div><b>Sua conta será apagada em ${esc(dataCurta(c.exclusao.purgarEm))}</b><p>Até lá, você pode entrar e desfazer. Depois dessa data, o beta apaga tudo e o login deixa de funcionar.</p>${pausada}${bt("mc-desfazer", v.ocupado === "desfazer" ? "Desfazendo…" : "Desfazer exclusão", { classe: "pri", ocupado: v.ocupado === "desfazer" })}</div></div>
      <div class="linha-tempo" aria-hidden="true"><span class="feito">Pedido confirmado</span><span>Prazo para desfazer</span><span>Tudo apagado</span></div>
    </section>`;
  }
  if (!c.podeExcluir) {
    return `<section class="conta-secao perigo-area"><h3>Excluir conta</h3><p>Este espaço é de uma equipe. A exclusão da conta vale só para o espaço pessoal.</p></section>`;
  }
  if (v.passo !== "excluir") {
    return `<section class="conta-secao perigo-area"><h3>Excluir conta</h3><p>Você terá 30 dias para desfazer. Depois, o beta apaga todos os seus dados.</p>${bt("mc-passo", "Excluir conta…", { classe: "perigo", dados: { passo: "excluir" } })}</section>`;
  }
  return `<section class="conta-secao perigo-area"><h3>Excluir conta</h3>
    <div class="risco-resumo"><b>Você terá 30 dias para mudar de ideia</b><p>Durante esse período, a conta fica programada para exclusão e você pode desfazer. Depois, o beta apaga perfil, conversas, bots, memórias, rotinas, decisões e trilha. O login deixa de funcionar.</p><p class="beta-nota">Política do beta: purga total. Será revista antes da saída do beta.</p>${pausada}</div>
    <div class="conta-acoes">${bt("mc-passo", "Cancelar", { classe: "cc-link", dados: { passo: "" } })}${bt("mc-excluir", v.ocupado === "excluir" ? "Programando…" : "Programar exclusão", { classe: "perigo", ocupado: v.ocupado === "excluir" })}</div>
  </section>`;
}

function secaoDados(v: VistaMinhaConta, d: MinhaContaDto, agora: number): string {
  return `${blocoExportacao(v, d.exportacao, agora)}${blocoExclusao(v, d.conta!, d.purgaLigada, agora)}`;
}

const PARA_QUE: Record<Pendente, string> = {
  "remover-google": "Para desconectar o Google",
  "trocar-email": "Para trocar o e-mail",
  baixar: "Para baixar seus dados",
  excluir: "Para programar a exclusão",
};

function janela(v: VistaMinhaConta, j: Janela, d: MinhaContaDto): string {
  const o = v.ocupado === "confirmar";
  const temSenha = d.conta?.formas.senha ?? false;
  const erro = j.erro ? `<p class="cc-erro" role="alert">${esc(j.erro)}</p>` : "";
  const corpo = j.modo === "senha"
    ? `<form class="conta-form" data-form="mc-confirmar-senha">${campoSenha("senha", "Sua senha", false, " autofocus")}${erro}<div class="conta-acoes mc-coluna">${enviar("Confirmar", o, "Conferindo…")}${bt("mc-janela-modo", "Receber um código por e-mail", { classe: "cc-link", dados: { modo: "codigo" } })}</div></form>`
    : j.codigoEnviado
      ? `<form class="conta-form" data-form="mc-confirmar-codigo"><p>Enviamos um código de 6 dígitos para <strong>${esc(d.conta?.email ?? "")}</strong>.</p><label class="conta-campo"><span>Código</span><input name="codigo" data-manter-foco="mc-codigo" class="cc-codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus></label>${erro}<div class="conta-acoes mc-coluna">${enviar("Confirmar", o, "Conferindo…")}${bt("mc-codigo-enviar", "Enviar outro código", { classe: "cc-link", ocupado: v.ocupado === "codigo" })}${temSenha ? bt("mc-janela-modo", "Usar senha", { classe: "cc-link", dados: { modo: "senha" } }) : ""}</div></form>`
      : `<p>Vamos enviar um código de 6 dígitos para <strong>${esc(d.conta?.email ?? "")}</strong>.</p>${erro}<div class="conta-acoes mc-coluna">${bt("mc-codigo-enviar", v.ocupado === "codigo" ? "Enviando…" : "Enviar código", { classe: "pri", ocupado: v.ocupado === "codigo" })}${temSenha ? bt("mc-janela-modo", "Usar senha", { classe: "cc-link", dados: { modo: "senha" } }) : ""}</div>`;
  return `<div class="conta-veu"><section class="conta-modal" role="dialog" aria-modal="true" aria-labelledby="confirmar-titulo">
    <button type="button" class="modal-fechar" data-act="mc-janela-fechar" aria-label="Fechar">×</button>
    <h3 id="confirmar-titulo">Confirme que é você</h3>
    <p>${esc(PARA_QUE[j.pendente])}, confirme sua identidade. Vale por 10 minutos nesta sessão.</p>
    ${corpo}
  </section></div>`;
}
