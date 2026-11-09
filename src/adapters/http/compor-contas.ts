import * as repoContas from "../../repositories/contas.repo.ts";
import { caixaLocal, enviadorResend, type CaixaLocal, type EnviadorEmail } from "../email/enviador.ts";
import { rotuloDoAparelho } from "../../domain/conta.ts";
import type { Db, Escopo } from "../../shared/types.ts";
import { emitirChaveMaquina } from "../../use-cases/chaves-maquina.ts";
import { servicoConta, type ServicoConta } from "../../use-cases/conta.ts";
import { servicoMinhaConta, type ServicoMinhaConta } from "../../use-cases/minha-conta.ts";
import * as repoMinhaConta from "../../repositories/minha-conta.repo.ts";
import { perfilRepo } from "../../repositories/perfil.repo.ts";
import type { Rota } from "./roteador.ts";
import { contaNoGoogle, rotaCaixaDev, rotasConta } from "./rotas/conta.ts";
import { executar, type DentroDeTx } from "./rotas/dentro-de-tx.ts";
import { segredoEfetivo } from "./sessao.ts";
import { criarGuardaSessao, type GuardaSessao } from "./sessao-revogavel.ts";
import { antiAbusoLigado, tetoDaCota } from "../../domain/salvaguardas-provisorio.ts";
import { definirCotaDoProvisorio } from "../../repositories/cota-provisorio.ts";

/**
 * Composição das contas (NOD-345, ADR-124). As flags são lidas SÓ aqui e em `recusasDasFlagsDeConta` (boot):
 *  - NOD_CONTAS=1: sessão revogável, cadastro/entrada por e-mail e senha, recuperação, sessões e pareamento;
 *  - NOD_BOOTSTRAP=1 (exige NOD_CONTAS): o espaço provisório por instalação, sem cadastro;
 *  - NOD_CONTAS_GOOGLE=1 (exige NOD_LOGIN=google e o client OAuth EXTERNO): "Continuar com Google" para Gmail e Workspace;
 *  - NOD_MINHA_CONTA=1 (exige NOD_CONTAS, NOD-346): a seção Minha conta (`/api/conta/eu/*`) e o laço da exportação;
 *  - NOD_PURGA_CONTA=1 (exige NOD_MINHA_CONTA): a purga de verdade 30 dias depois da exclusão (revisão LGPD pendente).
 * Desligadas (o padrão), nada daqui existe e o servidor é o de antes.
 */
export type ContasMontadas = {
  guarda: GuardaSessao;
  servico: ServicoConta;
  /** NOD_MINHA_CONTA=1 (NOD-346): perfil, formas de entrada, e-mail, exportação e exclusão. */
  minhaConta: ServicoMinhaConta | null;
  caixa: CaixaLocal | null;
  rotas: Rota[];
  bootstrap: boolean;
  /** NOD_ONBOARDING_TEXTO=1 (ADA-242, ADR-157): onboarding por texto, conta por código e Google no app. */
  onboardingTexto: boolean;
  google: ReturnType<typeof contaNoGoogle> | null;
  /** A sessão "maquina" do cookie que a ponte põe no app (`/api/maquina/sessao`): uma por chave, reaproveitada enquanto viva. */
  sessaoDaMaquina(escopo: Escopo, chaveId: string, nome: string | null): Promise<string>;
};

type Env = Readonly<Record<string, string | undefined>>;

/** O que impede o boot: combinação de flags que deixaria a conta pela metade em produção. Vazio = sobe. */
export function recusasDasFlagsDeConta(env: Env): string[] {
  const r: string[] = [];
  const contas = env.NOD_CONTAS === "1";
  if (env.NOD_BOOTSTRAP === "1" && !contas) r.push("NOD_BOOTSTRAP=1 exige NOD_CONTAS=1");
  if (env.NOD_CONTAS_GOOGLE === "1" && !contas) r.push("NOD_CONTAS_GOOGLE=1 exige NOD_CONTAS=1");
  if (env.NOD_MINHA_CONTA === "1" && !contas) r.push("NOD_MINHA_CONTA=1 exige NOD_CONTAS=1");
  if (env.NOD_PURGA_CONTA === "1" && env.NOD_MINHA_CONTA !== "1") r.push("NOD_PURGA_CONTA=1 exige NOD_MINHA_CONTA=1");
  if (env.NOD_CONTAS_GOOGLE === "1" && env.NOD_LOGIN !== "google") r.push("NOD_CONTAS_GOOGLE=1 exige NOD_LOGIN=google");
  if (contas && env.NOD_LOGIN === "google" && (!env.NOD_RESEND_API_KEY || !env.NOD_EMAIL_REMETENTE)) r.push("NOD_CONTAS=1 com NOD_LOGIN=google exige NOD_RESEND_API_KEY e NOD_EMAIL_REMETENTE");
  if (contas && env.NOD_LOGIN === "google" && !env.NOD_URL_PUBLICA) r.push("NOD_CONTAS=1 com NOD_LOGIN=google exige NOD_URL_PUBLICA (o link de recuperação)");
  const cota = tetoDaCota(env.NOD_PROVISORIO_COTA_TURNOS);
  if (typeof cota === "object" && cota) r.push(cota.invalido);
  const antiAbuso = antiAbusoLigado(env.NOD_ANTIABUSO);
  if (typeof antiAbuso === "object") r.push(antiAbuso.invalido);
  if ((cota !== null || antiAbuso === true) && env.NOD_BOOTSTRAP !== "1") r.push("salvaguardas do provisório exigem NOD_BOOTSTRAP=1");
  return r;
}

export function comporContas(p: { db: Db; env: Env; dentro: DentroDeTx; agora: () => number; enviador?: EnviadorEmail }): ContasMontadas | null {
  const { env } = p;
  if (env.NOD_CONTAS !== "1") {
    definirCotaDoProvisorio(null);
    return null;
  }
  const recusas = recusasDasFlagsDeConta(env);
  if (recusas.length) throw new Error(`contas: ${recusas.join("; ")}`);
  const cota = tetoDaCota(env.NOD_PROVISORIO_COTA_TURNOS);
  const antiAbuso = antiAbusoLigado(env.NOD_ANTIABUSO);
  definirCotaDoProvisorio(typeof cota === "number" ? cota : null);
  const stub = env.NOD_LOGIN !== "google";
  const segredo = segredoEfetivo(stub ? "stub" : "google", env.NOD_SESSAO_SEGREDO);
  const seguro = !stub;
  const caixa = p.enviador ? null : stub ? caixaLocal() : null;
  const enviador: EnviadorEmail = p.enviador ?? caixa ?? enviadorResend({ chave: env.NOD_RESEND_API_KEY!, remetente: env.NOD_EMAIL_REMETENTE! });
  const guarda = criarGuardaSessao(p.db, p.agora);
  const servico = servicoConta({
    transacao: (fn) => p.db.begin(fn) as never,
    segredo,
    enviador,
    urlBase: (env.NOD_URL_PUBLICA ?? `http://127.0.0.1:${env.NOD_API_PORT ?? "8888"}`).replace(/\/$/, ""),
    agora: p.agora,
    repo: repoContas,
    emitirChaveMaquina: (escopo, nome) => p.dentro(escopo, async (d) => (await executar(d, emitirChaveMaquina, { nome })).chave),
    antiAbuso: antiAbuso === true,
  });
  const bootstrap = env.NOD_BOOTSTRAP === "1";
  const googleLigado = env.NOD_CONTAS_GOOGLE === "1";
  const urlBase = (env.NOD_URL_PUBLICA ?? `http://127.0.0.1:${env.NOD_API_PORT ?? "8888"}`).replace(/\/$/, "");
  const minhaConta =
    env.NOD_MINHA_CONTA === "1"
      ? servicoMinhaConta({ transacao: (fn) => p.db.begin(fn) as never, segredo, enviador, urlBase, agora: p.agora, repo: repoContas, mc: repoMinhaConta, perfil: perfilRepo, purgaLigada: env.NOD_PURGA_CONTA === "1", aoEncerrarSessoes: (escopos) => escopos.forEach((e) => guarda.esquecer?.(e)) })
      : null;
  // ADA-242 (ADR-157): conta sem senha e Google no app. Desligada, o onboarding e a conta seguem os de antes.
  const onboardingTexto = env.NOD_ONBOARDING_TEXTO === "1";
  const rotas = rotasConta({ servico, guarda, segredo, seguro, bootstrap, caixa, google: googleLigado, agora: p.agora, minhaConta, onboardingTexto });
  if (caixa) rotas.push(rotaCaixaDev(caixa));

  const daMaquina = new Map<string, string>();
  return {
    guarda,
    servico,
    minhaConta,
    caixa,
    rotas,
    bootstrap,
    onboardingTexto,
    google: googleLigado ? contaNoGoogle({ servico, guarda, segredo, seguro, agora: p.agora, onboardingTexto }) : null,
    async sessaoDaMaquina(escopo, chaveId, nome) {
      const k = `${escopo.tenantId}:${escopo.pessoaId}:${chaveId}`;
      const sid = daMaquina.get(k);
      if (sid && (await guarda.conferir(escopo, sid))) return sid;
      const novo = await guarda.criar(escopo, "maquina", (nome ?? rotuloDoAparelho(undefined)).slice(0, 60));
      if (daMaquina.size >= 10_000) daMaquina.clear();
      daMaquina.set(k, novo);
      return novo;
    },
  };
}
