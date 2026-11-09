import type { DesejoNuvem, DormirAposMin, EstadoMaquinaNuvem, MotivoFalhaNuvem, RefInstancia, TamanhoMaquinaNuvem } from "../contracts/provedor-nuvem.ts";
import { RESERVA_MS, ROTINA_SEGURA_SONO_MS, type SituacaoNuvem } from "../domain/maquina-nuvem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { alvoDoTurno } from "./alvo-da-maquina.ts";
import { data, dataOuNull, msOuNull } from "./conversao.ts";

/** Uma máquina na nuvem como o nod a guarda (ADR-121). */
export type MaquinaNuvem = {
  id: string;
  credencialId: string;
  maquinaId: string | null;
  provedor: "gcp";
  ref: RefInstancia;
  tamanho: TamanhoMaquinaNuvem | null;
  criadaPeloNod: boolean;
  estado: EstadoMaquinaNuvem;
  estadoDesde: number;
  desejado: DesejoNuvem;
  ligouEm: number | null;
  motivo: MotivoFalhaNuvem | null;
  proximaTentativaEm: number | null;
  reiniciouEm: number | null;
  dormirAposMin: DormirAposMin | null;
  operacaoId: string | null;
};

/** O que o reconciliador precisa para decidir o passo (domínio) e chamar o provedor. */
export type ParaReconciliar = MaquinaNuvem & { situacao: SituacaoNuvem };

type Linha = {
  id: string; credencial_id: string; maquina_id: string | null; provedor: "gcp"; projeto: string; zona: string; nome_instancia: string;
  tamanho: TamanhoMaquinaNuvem | null; criada_pelo_nod: boolean; estado: EstadoMaquinaNuvem; estado_desde: Date; desejado: DesejoNuvem;
  ligou_em: Date | null; motivo: MotivoFalhaNuvem | null; proxima_tentativa_em: Date | null; reiniciou_em: Date | null;
  dormir_apos_min: DormirAposMin | null; operacao_id: string | null; ocupado_ate: Date | null; ultima_atividade_em: Date | null;
};

const maquina = (l: Linha): MaquinaNuvem => ({
  id: l.id, credencialId: l.credencial_id, maquinaId: l.maquina_id, provedor: l.provedor,
  ref: { projeto: l.projeto, zona: l.zona, nome: l.nome_instancia },
  tamanho: l.tamanho, criadaPeloNod: l.criada_pelo_nod, estado: l.estado, estadoDesde: l.estado_desde.getTime(), desejado: l.desejado,
  ligouEm: msOuNull(l.ligou_em), motivo: l.motivo, proximaTentativaEm: msOuNull(l.proxima_tentativa_em), reiniciouEm: msOuNull(l.reiniciou_em),
  dormirAposMin: l.dormir_apos_min, operacaoId: l.operacao_id,
});

/** Por que o sono foi recusado (o "Dormir agora" mostra; o laço só segue). */
export type RecusaDoSono = "nao_encontrada" | "nao_acordada" | "ocupada" | "turno_rodando" | "turno_na_fila" | "rotina_proxima" | "nao_ociosa";

export function maquinasNuvemRepo(conn: Conn, escopo: Escopo) {
  const daPessoa = () => conn`mn.tenant_id = ${escopo.tenantId} and mn.owner_id = ${escopo.pessoaId}`;
  const travarPessoa = () => conn`select pg_advisory_xact_lock(hashtext(${`${escopo.tenantId}:${escopo.pessoaId}`}))`;

  const registrarEvento = async (maquinaNuvemId: string, de: EstadoMaquinaNuvem | null, para: EstadoMaquinaNuvem, motivo: MotivoFalhaNuvem | null, agora: number) => {
    await conn`insert into maquinas_nuvem_eventos (tenant_id, owner_id, maquina_nuvem_id, de, para, motivo, em)
      values (${escopo.tenantId}, ${escopo.pessoaId}, ${maquinaNuvemId}, ${de}, ${para}, ${motivo}, ${data(agora)})`;
  };

  return {
    /** Conectar (ADR-121): a VM que a pessoa já tem, já pareada (`maquinaId`), entra acordada. */
    async criarConectada(p: { credencialId: string; maquinaId: string; ref: RefInstancia; agora: number }): Promise<MaquinaNuvem> {
      const [l] = await conn<Linha[]>`
        insert into maquinas_nuvem (tenant_id, owner_id, credencial_id, maquina_id, provedor, projeto, zona, nome_instancia, criada_pelo_nod, estado, estado_desde, desejado)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.credencialId}, ${p.maquinaId}, 'gcp', ${p.ref.projeto}, ${p.ref.zona}, ${p.ref.nome}, false, 'acordada', ${data(p.agora)}, 'acordada')
        returning *`;
      await registrarEvento(l!.id, null, "acordada", null, p.agora);
      return maquina(l!);
    },

    async buscar(id: string): Promise<MaquinaNuvem | null> {
      const [l] = await conn<Linha[]>`select * from maquinas_nuvem mn where ${daPessoa()} and mn.id = ${id}`;
      return l ? maquina(l) : null;
    },

    async buscarPorMaquina(maquinaId: string): Promise<MaquinaNuvem | null> {
      const [l] = await conn<Linha[]>`select * from maquinas_nuvem mn where ${daPessoa()} and mn.maquina_id = ${maquinaId} and mn.estado <> 'excluida'`;
      return l ? maquina(l) : null;
    },

    /** As máquinas na nuvem vivas da pessoa (a tela de Máquinas junta pelo `maquinaId`). */
    async listarDaPessoa(): Promise<MaquinaNuvem[]> {
      const linhas = await conn<Linha[]>`select * from maquinas_nuvem mn where ${daPessoa()} and mn.estado <> 'excluida' order by mn.criado_em`;
      return linhas.map(maquina);
    },

    /** As máquinas que estão acordando agora (a conversa mostra "Acordando <máquina>…"). */
    async idsAcordando(): Promise<Set<string>> {
      const linhas = await conn<{ maquina_id: string }[]>`select mn.maquina_id from maquinas_nuvem mn
        where ${daPessoa()} and mn.maquina_id is not null and (mn.estado = 'acordando' or (mn.estado in ('dormindo', 'adormecendo') and mn.desejado = 'acordada'))`;
      return new Set(linhas.map((l) => l.maquina_id));
    },

    async definirDormirApos(id: string, minutos: DormirAposMin | null): Promise<boolean> {
      const r = await conn`update maquinas_nuvem mn set dormir_apos_min = ${minutos} where ${daPessoa()} and mn.id = ${id} and mn.estado <> 'excluida' returning mn.id`;
      return r.length > 0;
    },

    /**
     * Um gatilho (ou o botão Acordar) pede a máquina acordada. Da falha volta a `dormindo` com o desejo: o reconciliador
     * liga de novo na próxima volta. No acordando com nova tentativa agendada, a tentativa vem para `agora`. `false` = não
     * há o que acordar (excluída, criando ou já acordada).
     */
    async pedirAcordar(id: string, agora: number): Promise<boolean> {
      const [antes] = await conn<{ estado: EstadoMaquinaNuvem }[]>`select mn.estado from maquinas_nuvem mn where ${daPessoa()} and mn.id = ${id} for update`;
      if (!antes) return false;
      if (antes.estado === "falhou_ao_acordar") {
        await conn`update maquinas_nuvem mn set estado = 'dormindo', estado_desde = ${data(agora)}, desejado = 'acordada', motivo = null,
          proxima_tentativa_em = null, reiniciou_em = null where ${daPessoa()} and mn.id = ${id}`;
        await registrarEvento(id, "falhou_ao_acordar", "dormindo", null, agora);
        return true;
      }
      if (antes.estado !== "dormindo" && antes.estado !== "adormecendo" && antes.estado !== "acordando") return false;
      // Revisão NOD-92 (rodada 2, item 2): o "Tentar agora" do acordando com nova tentativa agendada (sem capacidade)
      // antecipa a tentativa para já — sem isso nada acontecia por até 5 min. Vai para `agora` e não para nulo: nulo
      // faria o reconciliador contar o prazo do motor desde o primeiro start, e não ligar de novo.
      await conn`update maquinas_nuvem mn set desejado = 'acordada',
        proxima_tentativa_em = case when mn.estado = 'acordando' and mn.proxima_tentativa_em is not null and mn.proxima_tentativa_em > ${data(agora)}
          then ${data(agora)} else mn.proxima_tentativa_em end
        where ${daPessoa()} and mn.id = ${id}`;
      return true;
    },

    /**
     * Põe a máquina para dormir se nada precisa dela (ADR-121). Sob a mesma trava da pessoa que o `reivindicar` toma:
     * o turno que já foi pego segura a máquina acordada; o que chegar depois vê `adormecendo` e espera ela acordar.
     * Reconfere: nenhum turno rodando nela, nenhum pendente que ela possa pegar (o com alvo nela e, por cautela, o sem
     * alvo), nenhuma rotina com alvo nela nos próximos 15 min, nenhuma reserva viva e, sem `forcar`, ociosa há
     * `dormir_apos_min`. Passou: grava `adormecendo` (desejo `dormindo`, `ligou_em` nulo). Quem chama desliga no
     * provedor DEPOIS do commit.
     */
    async tentarDormir(id: string, agora: number, o: { forcar?: boolean } = {}): Promise<{ ok: true } | { ok: false; motivo: RecusaDoSono }> {
      await travarPessoa();
      const [l] = await conn<(Linha & { ultimo_uso_em: Date | null; criado_maquina: Date | null })[]>`
        select mn.*, k.ultimo_uso_em, k.criado_em as criado_maquina from maquinas_nuvem mn
        left join maquina_tokens k on k.tenant_id = mn.tenant_id and k.id = mn.maquina_id
        where ${daPessoa()} and mn.id = ${id} for update of mn`;
      if (!l?.maquina_id) return { ok: false, motivo: "nao_encontrada" };
      if (l.estado !== "acordada") return { ok: false, motivo: "nao_acordada" };
      if (l.ocupado_ate && l.ocupado_ate.getTime() > agora) return { ok: false, motivo: "ocupada" };
      const maquinaId = l.maquina_id;
      const [rodando] = await conn`select 1 from turnos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
        and t.estado = 'despachando' and t.machine_id = ${maquinaId} limit 1`;
      if (rodando) return { ok: false, motivo: "turno_rodando" };
      const alvo = alvoDoTurno(conn, agora);
      const [naFila] = await conn`select 1 from turnos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
        and t.estado = 'pendente' and (t.acordar_em is null or t.acordar_em <= ${data(agora + ROTINA_SEGURA_SONO_MS)})
        and (${alvo} = ${maquinaId}::text or ${alvo} is null) limit 1`;
      if (naFila) return { ok: false, motivo: "turno_na_fila" };
      const [rotina] = await conn`select 1 from rotinas r join agentes a on a.tenant_id = r.tenant_id and a.id = r.agente_id
        where r.tenant_id = ${escopo.tenantId} and r.owner_id = ${escopo.pessoaId} and r.estado = 'ativa' and a.excluido_em is null
          and r.proxima_execucao <= ${data(agora + ROTINA_SEGURA_SONO_MS)}
          and coalesce(a.maquina_id, (select pr.maquina_padrao_id from preferencias pr where pr.tenant_id = r.tenant_id and pr.owner_id = r.owner_id)) = ${maquinaId}
        limit 1`;
      if (rotina) return { ok: false, motivo: "rotina_proxima" };
      if (o.forcar !== true) {
        if (l.dormir_apos_min === null) return { ok: false, motivo: "nao_ociosa" };
        // NOD-92 (revisão B1): o ocioso conta do último turno (ultima_atividade_em), não do poll do motor (ultimo_uso_em).
        const ultimo = Math.max(l.ultima_atividade_em?.getTime() ?? 0, l.estado_desde.getTime());
        if (agora - ultimo < l.dormir_apos_min * 60_000) return { ok: false, motivo: "nao_ociosa" };
      }
      await conn`update maquinas_nuvem mn set estado = 'adormecendo', estado_desde = ${data(agora)}, desejado = 'dormindo', ligou_em = null,
        motivo = null, proxima_tentativa_em = null, reiniciou_em = null where ${daPessoa()} and mn.id = ${id}`;
      await registrarEvento(id, "acordada", "adormecendo", null, agora);
      return { ok: true };
    },

    /**
     * NOD-92 (revisão B1): marca atividade nas acordadas com turno rodando agora. O `reivindicar` marca ao pegar; esta
     * marca segue durante o turno longo, para o ocioso contar do FIM do trabalho (com folga de uma volta).
     */
    async marcarAtividade(agora: number): Promise<number> {
      const r = await conn`update maquinas_nuvem mn set ultima_atividade_em = ${data(agora)}
        where ${daPessoa()} and mn.estado = 'acordada' and mn.maquina_id is not null
          and exists (select 1 from turnos t where t.tenant_id = mn.tenant_id and t.owner_id = mn.owner_id and t.estado = 'despachando' and t.machine_id = mn.maquina_id)
        returning mn.id`;
      return r.length;
    },

    /** As acordadas ociosas há `dormir_apos_min` (candidatas; o `tentarDormir` reconfere sob a trava). */
    async ociosasParaDormir(agora: number): Promise<{ id: string; maquinaId: string }[]> {
      const linhas = await conn<{ id: string; maquina_id: string }[]>`select mn.id, mn.maquina_id from maquinas_nuvem mn
        join maquina_tokens k on k.tenant_id = mn.tenant_id and k.id = mn.maquina_id
        where ${daPessoa()} and mn.estado = 'acordada' and mn.dormir_apos_min is not null
          and (mn.ocupado_ate is null or mn.ocupado_ate <= ${data(agora)})
          and greatest(mn.ultima_atividade_em, mn.estado_desde) <= ${data(agora)}::timestamptz - make_interval(mins => mn.dormir_apos_min)`;
      return linhas.map((l) => ({ id: l.id, maquinaId: l.maquina_id }));
    },

    /**
     * Os gatilhos (ADR-121): a máquina dormindo que é alvo de um turno pendente ou de uma rotina nos próximos 15 min passa
     * a desejar acordar. O turno SEM alvo acorda UMA máquina na nuvem (a usada por último) só se nenhuma outra máquina
     * da pessoa falou com o servidor nos últimos `contatoRecenteMs` (alguém já pode pegá-lo). Devolve quantas mudou.
     */
    async acordarSePreciso(agora: number, contatoRecenteMs: number): Promise<number> {
      const alvo = alvoDoTurno(conn, agora);
      const comAlvo = await conn<{ id: string }[]>`
        update maquinas_nuvem mn set desejado = 'acordada'
        where ${daPessoa()} and mn.estado in ('dormindo', 'adormecendo') and mn.desejado = 'dormindo' and mn.maquina_id is not null
          and (exists (select 1 from turnos t where t.tenant_id = mn.tenant_id and t.owner_id = mn.owner_id and t.estado = 'pendente'
                and (t.acordar_em is null or t.acordar_em <= ${data(agora)}) and ${alvo} = mn.maquina_id::text)
            or exists (select 1 from rotinas r join agentes a on a.tenant_id = r.tenant_id and a.id = r.agente_id
                where r.tenant_id = mn.tenant_id and r.owner_id = mn.owner_id and r.estado = 'ativa' and a.excluido_em is null
                  and r.proxima_execucao <= ${data(agora + ROTINA_SEGURA_SONO_MS)}
                  and coalesce(a.maquina_id, (select pr.maquina_padrao_id from preferencias pr where pr.tenant_id = r.tenant_id and pr.owner_id = r.owner_id)) = mn.maquina_id))
        returning mn.id`;
      const [semAlvo] = await conn`select 1 from turnos t where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente'
        and (t.acordar_em is null or t.acordar_em <= ${data(agora)}) and ${alvo} is null limit 1`;
      if (!semAlvo) return comAlvo.length;
      // Já há máquina a caminho, ou alguma outra falou há pouco (pode pegar o turno): não acorda mais nenhuma.
      const [jaTem] = await conn`select 1 from maquina_tokens k where k.tenant_id = ${escopo.tenantId} and k.owner_id = ${escopo.pessoaId}
          and k.revogado_em is null and (k.expira_em is null or k.expira_em > ${data(agora)})
          and k.ultimo_uso_em > ${data(agora - contatoRecenteMs)}
          and not exists (select 1 from maquinas_nuvem mn where mn.tenant_id = k.tenant_id and mn.maquina_id = k.id and mn.estado in ('adormecendo', 'dormindo', 'acordando'))
        union all
        select 1 from maquinas_nuvem mn where ${daPessoa()} and (mn.estado = 'acordando' or (mn.estado in ('dormindo', 'adormecendo') and mn.desejado = 'acordada'))
        limit 1`;
      if (jaTem) return comAlvo.length;
      const uma = await conn<{ id: string }[]>`
        update maquinas_nuvem set desejado = 'acordada' where (tenant_id, id) = (
          select mn.tenant_id, mn.id from maquinas_nuvem mn left join maquina_tokens k on k.tenant_id = mn.tenant_id and k.id = mn.maquina_id
          where ${daPessoa()} and mn.estado in ('dormindo', 'adormecendo') and mn.desejado = 'dormindo' and mn.maquina_id is not null
          order by k.ultimo_uso_em desc nulls last limit 1)
        returning id`;
      return comAlvo.length + uma.length;
    },

    /**
     * As máquinas em que o reconciliador tem trabalho (criando, adormecendo, acordando, dormindo com desejo de acordar e
     * excluída com exclusão pendente no provedor) e sem reserva viva.
     */
    async paraReconciliar(agora: number): Promise<ParaReconciliar[]> {
      const linhas = await conn<(Linha & { contato: boolean })[]>`
        select mn.*, (mn.ligou_em is not null and k.ultimo_uso_em is not null and k.ultimo_uso_em > mn.ligou_em) as contato
        from maquinas_nuvem mn left join maquina_tokens k on k.tenant_id = mn.tenant_id and k.id = mn.maquina_id
        where ${daPessoa()} and (mn.estado in ('criando', 'adormecendo', 'acordando') or (mn.estado = 'dormindo' and mn.desejado = 'acordada')
          or (mn.estado = 'excluida' and mn.proxima_tentativa_em is not null))
          and (mn.ocupado_ate is null or mn.ocupado_ate <= ${data(agora)})
        order by mn.estado_desde`;
      return linhas.map((l) => {
        const m = maquina(l);
        return { ...m, situacao: { estado: m.estado, desejado: m.desejado, estadoDesde: m.estadoDesde, ligouEm: m.ligouEm, reiniciouEm: m.reiniciouEm, proximaTentativaEm: m.proximaTentativaEm, contato: l.contato } };
      });
    },

    /** Reserva a máquina para UMA operação (padrão de `computadores`): só quem tem `operacaoId` grava o resultado. */
    async reservar(id: string, operacaoId: string, agora: number): Promise<boolean> {
      const r = await conn`update maquinas_nuvem mn set operacao_id = ${operacaoId}, ocupado_ate = ${data(agora + RESERVA_MS)}
        where ${daPessoa()} and mn.id = ${id} and (mn.ocupado_ate is null or mn.ocupado_ate <= ${data(agora)}) returning mn.id`;
      return r.length > 0;
    },

    /**
     * Grava o resultado da operação reservada e solta a reserva. Só com a reserva (`operacao_id = op`): a operação que
     * perdeu a reserva (expirou e outra pegou) não escreve nada. Troca de estado registra o evento e zera `estado_desde`.
     * `undefined` num campo = não mexe.
     */
    async concluir(id: string, operacaoId: string, agora: number, m: { estado?: EstadoMaquinaNuvem; motivo?: MotivoFalhaNuvem | null; ligouEm?: number | null; reiniciouEm?: number | null; proximaTentativaEm?: number | null; desejado?: DesejoNuvem }): Promise<boolean> {
      const [antes] = await conn<{ estado: EstadoMaquinaNuvem }[]>`select mn.estado from maquinas_nuvem mn where ${daPessoa()} and mn.id = ${id} and mn.operacao_id = ${operacaoId} for update`;
      if (!antes) return false;
      const muda = m.estado !== undefined && m.estado !== antes.estado;
      await conn`update maquinas_nuvem mn set operacao_id = null, ocupado_ate = null,
        estado = coalesce(${m.estado ?? null}::estado_maquina_nuvem, estado),
        estado_desde = case when ${muda} then ${data(agora)} else estado_desde end,
        motivo = case when ${m.motivo !== undefined} then ${m.motivo ?? null}::motivo_falha_nuvem else motivo end,
        ligou_em = case when ${m.ligouEm !== undefined} then ${dataOuNull(m.ligouEm)}::timestamptz else ligou_em end,
        reiniciou_em = case when ${m.reiniciouEm !== undefined} then ${dataOuNull(m.reiniciouEm)}::timestamptz else reiniciou_em end,
        proxima_tentativa_em = case when ${m.proximaTentativaEm !== undefined} then ${dataOuNull(m.proximaTentativaEm)}::timestamptz else proxima_tentativa_em end,
        desejado = coalesce(${m.desejado ?? null}, desejado)
        where ${daPessoa()} and mn.id = ${id} and mn.operacao_id = ${operacaoId}`;
      if (muda && m.estado) await registrarEvento(id, antes.estado, m.estado, m.motivo ?? null, agora);
      return true;
    },

    async soltar(id: string, operacaoId: string): Promise<void> {
      await conn`update maquinas_nuvem mn set operacao_id = null, ocupado_ate = null where ${daPessoa()} and mn.id = ${id} and mn.operacao_id = ${operacaoId}`;
    },

    // ——— PR 2: criar a VM (ADR-121) ———

    /**
     * A intenção de criar: a linha nasce `criando`, sem máquina, com o `request_id` fixo (toda nova tentativa do
     * reconciliador manda o mesmo, e o Google não duplica) e o convite cifrado que vai no script de início.
     */
    async criarIntencao(p: { credencialId: string; ref: RefInstancia; subrede: string; tamanho: TamanhoMaquinaNuvem; requestId: string; conviteCifrado: string; conviteExpiraEm: number; agora: number }): Promise<MaquinaNuvem | null> {
      // NOD-92 (revisão B3): uma criação por vez por pessoa, sob a trava da pessoa e o índice parcial
      // `maquinas_nuvem_uma_criando`. O segundo clique (ou a segunda aba) recebe null e a rota responde 409.
      await travarPessoa();
      const [l] = await conn<Linha[]>`
        insert into maquinas_nuvem (tenant_id, owner_id, credencial_id, maquina_id, provedor, projeto, zona, subrede, nome_instancia, request_id, tamanho,
          criada_pelo_nod, estado, estado_desde, desejado, convite_cifrado, convite_expira_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.credencialId}, null, 'gcp', ${p.ref.projeto}, ${p.ref.zona}, ${p.subrede}, ${p.ref.nome}, ${p.requestId}, ${p.tamanho},
          true, 'criando', ${data(p.agora)}, 'acordada', ${p.conviteCifrado}, ${data(p.conviteExpiraEm)})
        on conflict (tenant_id, owner_id) where estado = 'criando' do nothing
        returning *`;
      if (!l) return null;
      await registrarEvento(l.id, null, "criando", null, p.agora);
      return maquina(l);
    },

    /** O que a criação manda ao provedor (sub-rede, tamanho, `request_id`, convite cifrado). Só o reconciliador lê. */
    async dadosDaCriacao(id: string): Promise<{ subrede: string; tamanho: TamanhoMaquinaNuvem; requestId: string; conviteCifrado: string; conviteExpiraEm: number } | null> {
      const [l] = await conn<{ subrede: string | null; tamanho: TamanhoMaquinaNuvem | null; request_id: string | null; convite_cifrado: string | null; convite_expira_em: Date | null }[]>`
        select mn.subrede, mn.tamanho, mn.request_id, mn.convite_cifrado, mn.convite_expira_em from maquinas_nuvem mn
        where ${daPessoa()} and mn.id = ${id} and mn.estado = 'criando'`;
      if (!l?.subrede || !l.tamanho || !l.request_id || !l.convite_cifrado || !l.convite_expira_em) return null;
      return { subrede: l.subrede, tamanho: l.tamanho, requestId: l.request_id, conviteCifrado: l.convite_cifrado, conviteExpiraEm: l.convite_expira_em.getTime() };
    },

    /** Os convites ainda válidos das VMs em criação (o reconciliador os registra no pareamento a cada volta). */
    async convitesAtivos(agora: number): Promise<{ id: string; nome: string; conviteCifrado: string; expiraEm: number }[]> {
      const linhas = await conn<{ id: string; nome_instancia: string; convite_cifrado: string; convite_expira_em: Date }[]>`
        select mn.id, mn.nome_instancia, mn.convite_cifrado, mn.convite_expira_em from maquinas_nuvem mn
        where ${daPessoa()} and mn.estado = 'criando' and mn.convite_cifrado is not null and mn.convite_confirmado_em is null
          and mn.convite_expira_em > ${data(agora)}`;
      return linhas.map((l) => ({ id: l.id, nome: l.nome_instancia, conviteCifrado: l.convite_cifrado, expiraEm: l.convite_expira_em.getTime() }));
    },

    /**
     * O motor da VM criada pareou com o convite: a chave nova vira a máquina desta linha. Se já havia uma chave ainda não
     * confirmada (o script rodou de novo antes de o motor falar), devolve a anterior para quem chama revogá-la. Depois da
     * confirmação, ou fora de `criando`, recusa (`null`): o convite não pareia uma segunda máquina.
     */
    async vincularCriada(id: string, maquinaId: string): Promise<{ anterior: string | null } | null> {
      const [l] = await conn<{ maquina_id: string | null }[]>`select mn.maquina_id from maquinas_nuvem mn
        where ${daPessoa()} and mn.id = ${id} and mn.estado = 'criando' and mn.convite_confirmado_em is null for update`;
      if (!l) return null;
      await conn`update maquinas_nuvem mn set maquina_id = ${maquinaId} where ${daPessoa()} and mn.id = ${id}`;
      return { anterior: l.maquina_id };
    },

    /** O motor da VM criada falou: acordada, o convite sai do banco e não vale mais. Só com a reserva. */
    async confirmarCriada(id: string, operacaoId: string, agora: number): Promise<boolean> {
      const r = await conn`update maquinas_nuvem mn set estado = 'acordada', estado_desde = ${data(agora)}, desejado = 'acordada', motivo = null,
        convite_cifrado = null, convite_confirmado_em = ${data(agora)}, operacao_id = null, ocupado_ate = null
        where ${daPessoa()} and mn.id = ${id} and mn.operacao_id = ${operacaoId} and mn.estado = 'criando' returning mn.id`;
      if (r.length > 0) await registrarEvento(id, "criando", "acordada", null, agora);
      return r.length > 0;
    },

    /** As VMs criadas pelo nod que ainda não parearam (a tela as mostra pela conta: não estão em `GET /maquinas`). */
    async criandoSemMaquina(): Promise<MaquinaNuvem[]> {
      const linhas = await conn<Linha[]>`select * from maquinas_nuvem mn
        where ${daPessoa()} and mn.criada_pelo_nod and mn.estado in ('criando', 'falhou_ao_acordar') and mn.convite_confirmado_em is null order by mn.criado_em`;
      return linhas.map(maquina);
    },

    /**
     * A VM criada pelo nod foi apagada no provedor: a linha fica `excluida` e, na mesma transação, nada mais aponta para
     * a máquina (bots, padrão da pessoa, "desta vez" dos pendentes); a chave é revogada. Devolve o id da chave (ou null).
     */
    async marcarExcluida(id: string, agora: number): Promise<{ maquinaId: string | null } | null> {
      const [antes] = await conn<{ estado: EstadoMaquinaNuvem; maquina_id: string | null }[]>`select mn.estado, mn.maquina_id from maquinas_nuvem mn
        where ${daPessoa()} and mn.id = ${id} for update`;
      if (!antes) return null;
      await conn`update maquinas_nuvem mn set estado = 'excluida', estado_desde = ${data(agora)}, convite_cifrado = null, operacao_id = null, ocupado_ate = null,
        proxima_tentativa_em = null where ${daPessoa()} and mn.id = ${id}`;
      if (antes.estado !== "excluida") await registrarEvento(id, antes.estado, "excluida", null, agora);
      const m = antes.maquina_id;
      if (m) {
        await conn`update agentes set maquina_id = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and maquina_id = ${m}`;
        await conn`update preferencias set maquina_padrao_id = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and maquina_padrao_id = ${m}`;
        await conn`update turnos set maquina_desta_vez = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente' and maquina_desta_vez = ${m}`;
        await conn`update maquina_tokens set revogado_em = coalesce(revogado_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${m}`;
      }
      return { maquinaId: m };
    },

    /**
     * Revisão NOD-92 (rodada 2, item 3): a VM nasceu depois do DELETE (linha `excluida`) e o excluir no provedor falhou.
     * Na linha excluída, `proxima_tentativa_em` marca a exclusão pendente: o reconciliador repete o excluir a partir dela.
     */
    async marcarExclusaoPendente(id: string, em: number): Promise<boolean> {
      const r = await conn`update maquinas_nuvem mn set proxima_tentativa_em = ${data(em)}
        where ${daPessoa()} and mn.id = ${id} and mn.estado = 'excluida' returning mn.id`;
      return r.length > 0;
    },

    async eventos(id: string, limite = 30): Promise<{ de: EstadoMaquinaNuvem | null; para: EstadoMaquinaNuvem; motivo: MotivoFalhaNuvem | null; em: number }[]> {
      const linhas = await conn<{ de: EstadoMaquinaNuvem | null; para: EstadoMaquinaNuvem; motivo: MotivoFalhaNuvem | null; em: Date }[]>`
        select e.de, e.para, e.motivo, e.em from maquinas_nuvem_eventos e
        where e.tenant_id = ${escopo.tenantId} and e.owner_id = ${escopo.pessoaId} and e.maquina_nuvem_id = ${id} order by e.em desc limit ${limite}`;
      return linhas.map((l) => ({ ...l, em: l.em.getTime() }));
    },
  };
}
