import { createHash, randomBytes } from "node:crypto";
import type { ContaNuvem, ContaPreparada, RefInstancia } from "../../contracts/provedor-nuvem.ts";
import {
  classificarErroDeOperacao,
  condicaoGerenciarProjeto,
  condicaoLerProjeto,
  condicaoLigar,
  ErroNuvemLancado,
  ErroNuvemTransitorio,
  idDaContaDeServico,
  nomeDoProjeto,
  PAPEL_GERENCIAR,
  PAPEL_LER,
  PAPEL_LIGAR,
  PERMISSOES_DOS_PAPEIS,
  REDE_NOD,
} from "../../domain/maquina-nuvem.ts";
import { chamarGoogle, lancarErroGoogle, ok, URL_COMPUTE, type RespostaGoogle } from "./gcp.ts";

/**
 * ADR-121 (NOD-92): o preparo do projeto da pessoa no Google, com o token OAuth DELA (só na memória). Cada passo é
 * idempotente e aceita "já existe" (409), então refazer o preparo depois de uma falha no meio continua de onde parou.
 * Todo erro HTTP passa por `classificarErroNuvem`; nenhuma mensagem do Google sai daqui.
 */

const URL_CRM = "https://cloudresourcemanager.googleapis.com/v3";
const URL_BILLING = "https://cloudbilling.googleapis.com/v1";
const URL_SERVICE_USAGE = "https://serviceusage.googleapis.com/v1";
const URL_IAM = "https://iam.googleapis.com/v1";
const SERVICOS = ["compute.googleapis.com", "iam.googleapis.com"];
// definido em 2026-10-22 (plano da NOD-92): até 20 consultas de uma operação longa, 3 s entre elas (~1 min).
const MAX_CONSULTAS_OPERACAO = 20;
const INTERVALO_CONSULTA_MS = 3_000;
// definido em 2026-10-22: o id do projeto é global no Google; com 4 hex aleatórios, 3 nomes bastam.
const TENTATIVAS_NOME_PROJETO = 3;
// definido em 2026-10-22: setIamPolicy com etag velho volta 409; relemos a política até 3 vezes.
const TENTATIVAS_POLITICA = 3;

type Condicao = { title: string; expression: string; description?: string };
type Vinculo = { role: string; members: string[]; condition?: Condicao };
type NovoVinculo = { role: string; membro: string; condicao: Condicao | null };

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
function campoTexto(v: unknown, campo: string): string | null {
  if (!objeto(v)) return null;
  const valor = v[campo];
  return typeof valor === "string" ? valor : null;
}

/** Os vínculos da política lida, copiados (a condição e os campos que não conhecemos voltam iguais no set). */
function lerVinculos(bruto: unknown): Vinculo[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Vinculo[] = [];
  for (const v of bruto as unknown[]) {
    const role = campoTexto(v, "role");
    if (!objeto(v) || !role) continue;
    const members = Array.isArray(v.members) ? v.members.filter((m: unknown): m is string => typeof m === "string") : [];
    const expressao = campoTexto(v.condition, "expression");
    const condition = expressao !== null && objeto(v.condition) ? { ...v.condition, title: campoTexto(v.condition, "title") ?? "", expression: expressao } : undefined;
    saida.push({ ...v, role, members, ...(condition ? { condition } : {}) });
  }
  return saida;
}

const esperarDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function criarContaGcp(p: {
  fetchImpl?: typeof fetch;
  contaFaturamento?: string | null;
  aleatorioHex?: (n: number) => string;
  /** Pausa entre consultas de operação. Padrão: setTimeout; com `fetchImpl` injetado (teste), sem pausa. */
  esperar?: (ms: number) => Promise<void>;
}): ContaNuvem {
  const fetchImpl = p.fetchImpl ?? fetch;
  const aleatorioHex = p.aleatorioHex ?? ((n: number) => randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n));
  const esperar = p.esperar ?? (p.fetchImpl ? async () => {} : esperarDeVerdade);

  /** Chama e exige 2xx; `tolerar409` = "já existe" conta como sucesso. Devolve o corpo. */
  async function exigir(token: string, metodo: string, url: string, corpo?: unknown, o: { tolerar409?: boolean; operacao?: "criar_chave" } = {}): Promise<RespostaGoogle> {
    const r = await chamarGoogle(fetchImpl, token, metodo, url, corpo);
    if (ok(r.status) || (o.tolerar409 && r.status === 409)) return r;
    return lancarErroGoogle(r, o.operacao);
  }

  /** Espera uma operação longa (Resource Manager, Service Usage: `done`; Compute: `status: DONE`). */
  async function esperarOperacao(token: string, url: string, inicial: unknown): Promise<void> {
    let op = inicial;
    for (let i = 0; i <= MAX_CONSULTAS_OPERACAO; i++) {
      if (objeto(op) && (op.done === true || op.status === "DONE")) {
        if (op.error !== undefined && op.error !== null) {
          const c = classificarErroDeOperacao(op.error);
          if (c === "transitorio") throw new ErroNuvemTransitorio();
          throw new ErroNuvemLancado(c);
        }
        return;
      }
      if (i === MAX_CONSULTAS_OPERACAO) break;
      await esperar(INTERVALO_CONSULTA_MS);
      op = (await exigir(token, "GET", url)).corpo;
    }
    // A operação continua no Google; o próximo preparo segue de onde parou.
    throw new ErroNuvemTransitorio();
  }

  async function criarProjeto(token: string, pessoaId: string): Promise<string> {
    for (let i = 0; i < TENTATIVAS_NOME_PROJETO; i++) {
      const projeto = nomeDoProjeto(pessoaId, aleatorioHex(4));
      const r = await exigir(token, "POST", `${URL_CRM}/projects`, { projectId: projeto, displayName: "nod máquinas" }, { tolerar409: true });
      if (r.status === 409) {
        // O id é global: só reaproveita se o projeto é da pessoa (ela o enxerga); senão, outro nome.
        const meu = await chamarGoogle(fetchImpl, token, "GET", `${URL_CRM}/projects/${encodeURIComponent(projeto)}`);
        if (ok(meu.status)) return projeto;
        continue;
      }
      const nome = campoTexto(r.corpo, "name");
      if (nome) await esperarOperacao(token, `${URL_CRM}/${nome}`, r.corpo);
      return projeto;
    }
    throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "nome_de_projeto_ocupado" });
  }

  async function vincularFaturamento(token: string, projeto: string): Promise<void> {
    const url = `${URL_BILLING}/projects/${encodeURIComponent(projeto)}/billingInfo`;
    const atual = await exigir(token, "GET", url);
    if (objeto(atual.corpo) && atual.corpo.billingEnabled === true) return;
    let conta = p.contaFaturamento ?? null;
    if (conta && !conta.startsWith("billingAccounts/")) conta = `billingAccounts/${conta}`;
    if (!conta) {
      const lista = await exigir(token, "GET", `${URL_BILLING}/billingAccounts`);
      const contas = objeto(lista.corpo) && Array.isArray(lista.corpo.billingAccounts) ? lista.corpo.billingAccounts : [];
      const aberta = contas.find((c: unknown) => objeto(c) && c.open === true && typeof c.name === "string");
      conta = campoTexto(aberta, "name");
    }
    if (!conta) throw new ErroNuvemLancado({ motivo: "cota_ou_cobranca", detalhe: "sem_faturamento" });
    await exigir(token, "PUT", url, { billingAccountName: conta });
  }

  async function ativarServicos(token: string, projeto: string): Promise<void> {
    const r = await exigir(token, "POST", `${URL_SERVICE_USAGE}/projects/${encodeURIComponent(projeto)}/services:batchEnable`, { serviceIds: SERVICOS }, { tolerar409: true });
    const nome = r.status === 409 ? null : campoTexto(r.corpo, "name");
    if (nome) await esperarOperacao(token, `${URL_SERVICE_USAGE}/${nome}`, r.corpo);
  }

  async function criarRede(token: string, projeto: string): Promise<void> {
    const base = `${URL_COMPUTE}/projects/${encodeURIComponent(projeto)}/global`;
    const r = await exigir(token, "POST", `${base}/networks`, { name: REDE_NOD, autoCreateSubnetworks: true }, { tolerar409: true });
    // A sub-rede da zona precisa existir antes da primeira VM: espera a operação global da Compute.
    const nome = r.status === 409 ? null : campoTexto(r.corpo, "name");
    if (nome) await esperarOperacao(token, `${base}/operations/${encodeURIComponent(nome)}`, r.corpo);
  }

  async function criarContaDeServico(token: string, projeto: string, pessoaId: string): Promise<string> {
    const hash8 = createHash("sha256").update(pessoaId).digest("hex").slice(0, 8);
    const id = idDaContaDeServico(hash8);
    await exigir(token, "POST", `${URL_IAM}/projects/${encodeURIComponent(projeto)}/serviceAccounts`, { accountId: id, serviceAccount: { displayName: "nod máquinas" } }, { tolerar409: true });
    return `${id}@${projeto}.iam.gserviceaccount.com`;
  }

  async function criarPapeis(token: string, projeto: string): Promise<void> {
    for (const papel of [PAPEL_GERENCIAR, PAPEL_LIGAR, PAPEL_LER] as const) {
      const corpo = { roleId: papel, role: { title: papel, includedPermissions: [...PERMISSOES_DOS_PAPEIS[papel]], stage: "GA" } };
      await exigir(token, "POST", `${URL_IAM}/projects/${encodeURIComponent(projeto)}/roles`, corpo, { tolerar409: true });
    }
  }

  /** Acrescenta vínculos à política do projeto (versão 3, com condição), sem duplicar o que já está lá. */
  async function vincular(token: string, projeto: string, novos: NovoVinculo[]): Promise<void> {
    const base = `${URL_CRM}/projects/${encodeURIComponent(projeto)}`;
    for (let i = 0; i < TENTATIVAS_POLITICA; i++) {
      const lida = await exigir(token, "POST", `${base}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } });
      const politica: Record<string, unknown> = objeto(lida.corpo) ? { ...lida.corpo } : {};
      const vinculos = lerVinculos(politica.bindings);
      let mudou = false;
      for (const n of novos) {
        const igual = vinculos.find((v) => v.role === n.role && (v.condition?.expression ?? null) === (n.condicao?.expression ?? null));
        if (igual?.members.includes(n.membro)) continue;
        mudou = true;
        if (igual) igual.members.push(n.membro);
        else vinculos.push({ role: n.role, members: [n.membro], ...(n.condicao ? { condition: n.condicao } : {}) });
      }
      if (!mudou) return;
      const r = await chamarGoogle(fetchImpl, token, "POST", `${base}:setIamPolicy`, { policy: { ...politica, version: 3, bindings: vinculos } });
      if (ok(r.status)) return;
      if (r.status !== 409) lancarErroGoogle(r);
    }
    throw new ErroNuvemTransitorio();
  }

  const urlChaves = (projeto: string, email: string) => `${URL_IAM}/projects/${encodeURIComponent(projeto)}/serviceAccounts/${encodeURIComponent(email)}/keys`;

  async function criarChave(token: string, projeto: string, email: string): Promise<{ json: string; nome: string }> {
    const r = await exigir(token, "POST", urlChaves(projeto, email), { privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE", keyAlgorithm: "KEY_ALG_RSA_2048" }, { operacao: "criar_chave" });
    const dados = campoTexto(r.corpo, "privateKeyData");
    const nome = campoTexto(r.corpo, "name");
    if (!dados || !nome) throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "chave_sem_dados" });
    return { json: Buffer.from(dados, "base64").toString("utf8"), nome };
  }

  return {
    async preparar({ pessoaId, tokenAcesso, projetoExistente }): Promise<ContaPreparada> {
      const projeto = projetoExistente || (await criarProjeto(tokenAcesso, pessoaId));
      await vincularFaturamento(tokenAcesso, projeto);
      await ativarServicos(tokenAcesso, projeto);
      await criarRede(tokenAcesso, projeto);
      const contaServico = await criarContaDeServico(tokenAcesso, projeto, pessoaId);
      await criarPapeis(tokenAcesso, projeto);
      const membro = `serviceAccount:${contaServico}`;
      await vincular(tokenAcesso, projeto, [
        { role: `projects/${projeto}/roles/${PAPEL_GERENCIAR}`, membro, condicao: { title: "nod gerenciar", expression: condicaoGerenciarProjeto(projeto) } },
        { role: `projects/${projeto}/roles/${PAPEL_LER}`, membro, condicao: { title: "nod ler", expression: condicaoLerProjeto(projeto) } },
      ]);
      const chave = await criarChave(tokenAcesso, projeto, contaServico);
      return { projeto, contaServico, chaveJson: chave.json, chaveNome: chave.nome };
    },

    /**
     * NOD-92 (revisão B2): apaga as chaves da conta de serviço que não são `manter` (as do preparo anterior, no
     * Reconectar). Só as USER_MANAGED; a que o Google já apagou (404) conta como apagada. Devolve quantas apagou.
     */
    async apagarOutrasChaves({ tokenAcesso, projeto, contaServico, manter }) {
      const r = await exigir(tokenAcesso, "GET", `${urlChaves(projeto, contaServico)}?keyTypes=USER_MANAGED`);
      const chaves = objeto(r.corpo) && Array.isArray(r.corpo.keys) ? (r.corpo.keys as unknown[]) : [];
      let apagadas = 0;
      for (const k of chaves) {
        const nome = campoTexto(k, "name");
        if (!nome || nome === manter || !nome.startsWith(`projects/${projeto}/serviceAccounts/`)) continue;
        const d = await chamarGoogle(fetchImpl, tokenAcesso, "DELETE", `${URL_IAM}/${nome}`);
        if (d.status === 404) continue;
        if (!ok(d.status)) lancarErroGoogle(d);
        apagadas += 1;
      }
      return apagadas;
    },

    async autorizarInstancia({ tokenAcesso, projeto, contaServico, ref }: { tokenAcesso: string; projeto: string; contaServico: string; ref: RefInstancia }) {
      const url = `${URL_COMPUTE}/projects/${encodeURIComponent(ref.projeto)}/zones/${encodeURIComponent(ref.zona)}/instances/${encodeURIComponent(ref.nome)}`;
      const r = await chamarGoogle(fetchImpl, tokenAcesso, "GET", url);
      if (r.status === 404) throw new ErroNuvemLancado({ motivo: "excluida" });
      if (!ok(r.status)) lancarErroGoogle(r);
      await vincular(tokenAcesso, projeto, [
        { role: `projects/${projeto}/roles/${PAPEL_LIGAR}`, membro: `serviceAccount:${contaServico}`, condicao: { title: `nod ligar ${ref.nome}`, expression: condicaoLigar(ref) } },
      ]);
    },
  };
}
