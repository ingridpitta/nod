import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import type { ContaNuvemDto, DormirAposMin, EstadoMaquinaNuvem, MaquinaCriandoDto, MaquinaNuvemDto, MotivoFalhaNuvem, TamanhoMaquinaNuvem } from "../../src/contracts/provedor-nuvem.ts";

/**
 * ADR-121 (NOD-92, PR 1): a máquina na nuvem que dorme e acorda pelo Google, como a tela a diz. Só regra pura (rótulos,
 * a frase de cada motivo e a ação que ela pede); o render mora em `web/telas/maquinas.ts` e as chamadas em `main.ts`.
 * A frase que a pessoa lê sai daqui, nunca do provedor (o motivo é código fechado, ADR-004).
 */

/**
 * O que é só da tela na nuvem: a conta lida de `GET nuvem/conta` (`"desligada"` = 404, sem `NOD_MAQUINA_NUVEM`; null =
 * ainda não lida), o aviso da volta do Google (`?nuvem=preparando|recusado`), o formulário "Dormir e acordar pelo Google"
 * aberto numa máquina, o menu do sono aberto e a recusa da última ação numa máquina (o 409 do "Dormir agora").
 */
export type UiNuvem = {
  conta: ContaNuvemDto | "desligada" | null;
  aviso: "preparando" | "recusado" | null;
  conectar: { maquinaId: string; projeto: string; zona: string; nome: string; erro: string | null } | null;
  sonoMenu: string | null;
  recusa: { maquinaId: string; texto: string } | null;
  /** PR 2: o painel "Criar minha máquina na nuvem" aberto (região e tamanho escolhidos). */
  criar: { regiao: string; tamanho: TamanhoMaquinaNuvem; erro: string | null; enviando: boolean } | null;
  /** PR 2: o diálogo "Excluir a <nome>?" (id da chave ou da linha da nuvem). */
  excluir: { id: string; nome: string; erro: string | null } | null;
};

export const UI_NUVEM_INICIAL: UiNuvem = { conta: null, aviso: null, conectar: null, sonoMenu: null, recusa: null, criar: null, excluir: null };

/** definido em 2026-10-22 (plano NOD-92): São Paulo é a zona que vem marcada. */
export const ZONA_PADRAO = "southamerica-east1-a";

/** O "Dormir e acordar pelo Google" só aparece com a flag: a conta respondeu (não 404) ou alguma máquina já tem `nuvem`. */
export function nuvemLigada(ui: Pick<UiNuvem, "conta">, maquinas: readonly MaquinaDto[]): boolean {
  return (ui.conta !== null && ui.conta !== "desligada") || maquinas.some((m) => m.nuvem !== undefined);
}

/** O estado da máquina na nuvem em uma palavra. `adormecendo` não chega à tela (o DTO o manda como `dormindo`). */
export function rotuloEstadoNuvem(estado: EstadoMaquinaNuvem): string {
  switch (estado) {
    case "acordada": return "Acordada";
    case "dormindo": return "Dormindo";
    case "acordando": return "Acordando…";
    case "adormecendo": return "Adormecendo…";
    case "criando": return "Criando…";
    case "falhou_ao_acordar": return "Não acordou";
    case "excluida": return "Excluída";
  }
}

/** A frase do motivo, com o nome da máquina e a zona (o "sem capacidade" diz onde). */
export function motivoLegivel(motivo: MotivoFalhaNuvem | null, nome: string, zona: string): string {
  switch (motivo) {
    case "credencial_nuvem": return `O nod perdeu a permissão na sua conta Google. A ${nome} continua como está e nada foi apagado.`;
    case "cota_ou_cobranca": return `O Google recusou acordar a ${nome} por cobrança ou cota. O nod não resolve isso por você: confira no console do Google.`;
    case "sem_capacidade": return `O Google está sem máquinas livres em ${nomeDaZona(zona)} agora. O nod tenta de novo sozinho.`;
    case "motor_sem_contato": return `A ${nome} ligou, mas o nod não respondeu nela.`;
    case "excluida": return `A ${nome} não existe mais na sua conta Google Cloud.`;
    case null: return `A ${nome} não acordou.`;
  }
}

export type AcaoDaFalha =
  | { tipo: "reconectar"; rotulo: "Reconectar o Google" }
  | { tipo: "console"; rotulo: "Abrir o console do Google ↗" }
  | { tipo: "acordar"; rotulo: "Tentar agora" | "Tentar de novo" };

/**
 * A ação de cada motivo (plano NOD-92, PR 1 item 6): a permissão volta pelo OAuth; cobrança ou cota se resolve no console
 * (e depois "Tentar de novo"); sem capacidade é espera, com "Tentar agora"; o resto tenta acordar de novo. `excluida` não
 * tem ação nesta versão ("Criar de novo" vem com o PR 2).
 */
export function acoesDaFalha(motivo: MotivoFalhaNuvem | null): AcaoDaFalha[] {
  switch (motivo) {
    case "credencial_nuvem": return [{ tipo: "reconectar", rotulo: "Reconectar o Google" }];
    case "cota_ou_cobranca": return [{ tipo: "console", rotulo: "Abrir o console do Google ↗" }, { tipo: "acordar", rotulo: "Tentar de novo" }];
    case "sem_capacidade": return [{ tipo: "acordar", rotulo: "Tentar agora" }];
    case "motor_sem_contato":
    case null: return [{ tipo: "acordar", rotulo: "Tentar de novo" }];
    case "excluida": return [];
  }
}

/** A linha de falha (ou de espera) aparece com motivo, ou quando ela não acordou. */
export function temLinhaDeFalha(n: MaquinaNuvemDto): boolean {
  return n.motivo !== null || n.estado === "falhou_ao_acordar";
}

/** O console do Google no projeto da pessoa (sem projeto conhecido, o console de entrada). */
export function urlConsoleGoogle(projeto: string | null | undefined): string {
  return projeto ? `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(projeto)}` : "https://console.cloud.google.com/";
}

/** As opções do "Dorme depois de" (15 min a 2 h) e o "Nunca dormir". */
export const OPCOES_SONO: readonly { minutos: DormirAposMin | null; rotulo: string }[] = [
  { minutos: 15, rotulo: "15 min" },
  { minutos: 30, rotulo: "30 min" },
  { minutos: 60, rotulo: "1 h" },
  { minutos: 120, rotulo: "2 h" },
  { minutos: null, rotulo: "Nunca dormir" },
];

export function rotuloSono(minutos: DormirAposMin | null): string {
  return OPCOES_SONO.find((o) => o.minutos === minutos)?.rotulo ?? "Nunca dormir";
}

/**
 * O 409 do "Dormir agora": o servidor só manda `estado_invalido` (o motivo da recusa fica no log), então a frase cobre as
 * recusas do `tentarDormir` — trabalho rodando ou na fila, rotina perto de rodar, ou ela não está acordada.
 */
export function recusaDoDormir(nome: string): string {
  return `A ${nome} não pode dormir agora: tem trabalho rodando ou esperando, uma rotina perto de rodar, ou ela não está acordada.`;
}

/**
 * Os erros do "Dormir e acordar pelo Google" (POST nuvem/google, para "conectar"), pelo status. O 409 sem o OAuth do
 * Google no servidor (`integracao_nao_configurada`) não é "já conectada": a frase diz que falta configurar o nod.
 */
export function erroDoConectar(status: number, codigo?: string): string {
  if (codigo === "integracao_nao_configurada") return "Este nod ainda não tem o acesso ao Google configurado. Peça a quem administra o servidor.";
  if (status === 400) return "Confira o projeto, a zona e o nome da instância: um deles não está no formato do Google.";
  if (status === 404) return "Essa máquina não está mais conectada ao nod. Atualize a página.";
  if (status === 409) return "Essa máquina já dorme e acorda pelo Google.";
  return "Não deu para falar com o Google agora. Tente de novo.";
}

/**
 * A máquina na nuvem segura a fila acordando (plano NOD-92, `situacaoNaFila`): o trabalho diz `acordando`, ou ela está
 * dormindo/acordando agora. Na falha (`falhou_ao_acordar`) não: a fila volta a oferecer "Rodar em X desta vez".
 */
export function acordandoNaFila(m: Pick<MaquinaDto, "nuvem"> | null | undefined, doTrabalho: { acordando?: boolean } | null | undefined): boolean {
  if (doTrabalho?.acordando) return true;
  const e = m?.nuvem?.estado;
  return e === "dormindo" || e === "acordando";
}

/** Por que o preparo da conta falhou. `detalhe` é código curto do servidor (ex.: `org_bloqueia_chave`), nunca texto do provedor. */
export function motivoDoPreparo(motivo: MotivoFalhaNuvem, detalhe: string | null): string {
  if (detalhe === "org_bloqueia_chave") return "a organização do Google bloqueia chave de conta de serviço.";
  switch (motivo) {
    case "credencial_nuvem": return "o Google não deu a permissão que o nod precisa.";
    case "cota_ou_cobranca": return "o Google recusou por cobrança ou cota no projeto.";
    case "excluida": return "o projeto ou a instância não existe nessa conta.";
    case "sem_capacidade":
    case "motor_sem_contato": return "o Google não respondeu como esperado. Tente de novo.";
  }
}

/** O aviso do topo depois da volta do Google. null = nenhum. */
export function avisoDaConta(ui: Pick<UiNuvem, "aviso" | "conta">): { texto: string; tom: "espera" | "ok" | "falha"; motivo: MotivoFalhaNuvem | null } | null {
  if (ui.aviso === "recusado") return { texto: "O Google não autorizou. Nada mudou na sua conta; tente de novo quando quiser.", tom: "falha", motivo: null };
  if (ui.aviso !== "preparando") return null;
  const c = ui.conta;
  if (c === null || c === "desligada" || c.preparando) return { texto: "Preparando sua conta do Google…", tom: "espera", motivo: null };
  if (c.motivo) return { texto: `Não deu para preparar sua conta do Google: ${motivoDoPreparo(c.motivo, c.detalhe)}`, tom: "falha", motivo: c.motivo };
  if (!c.conectada) return { texto: "Não deu para terminar de preparar sua conta do Google. Tente de novo.", tom: "falha", motivo: null };
  return { texto: "Pronto: sua conta do Google está conectada. A máquina dorme quando fica parada e acorda quando chega trabalho.", tom: "ok", motivo: null };
}

/**
 * PR 2 (protótipo da NOD-92): as regiões do "Criar", São Paulo marcada. Cópia de REGIOES_NUVEM (src/domain/maquina-nuvem.ts;
 * a web não importa src/); tests/unit/web/maquina-nuvem-criar.test.ts confere as duas.
 */
export const REGIOES_CRIAR = [
  { regiao: "southamerica-east1", nome: "São Paulo", nota: "mais perto de você" },
  { regiao: "us-central1", nome: "Iowa (EUA)", nota: "costuma ter mais máquinas livres" },
  { regiao: "us-east1", nome: "Carolina do Sul (EUA)", nota: "" },
] as const;
export const REGIAO_PADRAO = "southamerica-east1";

/** Revisão NOD-92 (item 15): a zona do Google ("southamerica-east1-a") vira o nome da região ("São Paulo"); zona fora
 *  da lista do Criar (máquina conectada à mão) fica crua. */
export function nomeDaZona(zona: string): string {
  return REGIOES_CRIAR.find((r) => zona === r.regiao || zona.startsWith(`${r.regiao}-`))?.nome ?? zona;
}

/** Os tamanhos: o padrão aguenta vários bots; o menor custa menos e serve para um ou dois. */
export const TAMANHOS_CRIAR: readonly { tamanho: TamanhoMaquinaNuvem; nome: string; nota: string }[] = [
  { tamanho: "padrao", nome: "Padrão", nota: "8 vCPU · 32 GB · para vários bots" },
  { tamanho: "menor", nome: "Menor", nota: "4 vCPU · 16 GB · para um ou dois bots" },
];

/** O que está sendo criado agora (sem chave ainda): a lista vem de `GET nuvem/conta`. */
export function criandoDaConta(ui: Pick<UiNuvem, "conta">): MaquinaCriandoDto[] {
  return ui.conta && ui.conta !== "desligada" ? (ui.conta.criando ?? []) : [];
}

/** Enquanto alguma VM está sendo criada, a tela relê a conta e as máquinas (o motor pareia sozinho). */
export function relerEnquantoCria(ui: Pick<UiNuvem, "conta">): boolean {
  return criandoDaConta(ui).some((c) => c.estado === "criando");
}

/** A linha da VM em criação: o que está acontecendo, em uma frase. */
export function fraseDaCriacao(c: MaquinaCriandoDto): string {
  if (c.estado === "criando") return c.motivo === "sem_capacidade" ? motivoLegivel("sem_capacidade", c.nome, c.zona) : "Criando no Google e instalando o nod. Costuma levar 3 a 5 min; esta tela segue sozinha.";
  return c.motivo === "motor_sem_contato" ? `A ${c.nome} foi criada, mas o nod não conseguiu se instalar nela. Exclua e crie de novo.` : motivoLegivel(c.motivo, c.nome, c.zona);
}

/** A frase do erro do "Criar" (o status da API; o texto do servidor não chega à tela). */
export function erroDoCriar(status: number): string {
  if (status === 409) return "Não deu para criar agora: já há uma máquina sendo criada, a conta Google precisa ser reconectada ou este nod ainda não tem o endereço público configurado.";
  if (status === 400) return "Escolha uma região e um tamanho da lista.";
  return "Não deu para criar agora. Tente de novo.";
}

/** A frase do erro do "Excluir". */
export function erroDoExcluir(status: number): string {
  if (status === 409) return "O Google não deixou excluir agora. Confira no console do Google ou tente de novo.";
  if (status === 404) return "Esta máquina já não existe.";
  return "Não deu para excluir agora. Tente de novo.";
}
