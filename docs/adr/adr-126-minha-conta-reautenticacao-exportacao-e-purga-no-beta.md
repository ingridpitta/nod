# ADR-126 — Minha conta: reautenticação, exportação e purga no beta

Status: aceita · Data: 2026-10-23 · Issue: NOD-346 · Emenda a
[ADR-004](adr-004-trilha-imutavel-por-trigger-sem-texto-livre-prosa-em-tab.md) (exceção da purga) e a
[ADR-124](adr-124-identidade-progressiva-uso-sem-conta-e-conversao.md) (troca de e-mail, desligar forma de entrada).

## Contexto

A Jornada 3 dá à pessoa o controle da própria conta sem suporte: perfil e "Sobre mim", formas de entrada, troca de
e-mail e senha, exportação dos dados e exclusão com 30 dias para desfazer. No beta, a decisão de produto de 2026-10-23
é que, vencido o prazo, **todos** os dados da conta sejam apagados, sem anonimização nem retenção seletiva.

Isso esbarra em três regras vigentes: a trilha é imutável inclusive para o dono (ADR-004); o `nod_app` não escreve em
identidade (ADR-003/124); e as tabelas escopadas têm FORCE RLS com policies só `TO nod_app`.

## Decisão

1. **Reautenticação recente.** Ações de risco (excluir a conta, baixar a exportação, trocar e-mail, desligar uma forma
   de entrada) exigem `sessoes.reautenticada_em` nos últimos 10 minutos. Reautentica por senha ou por um código de 6
   dígitos enviado ao e-mail da conta (finalidade `reautenticacao`, preso à sessão que o pediu). Emenda de
   2026-10-23 (implementação): o Google com `prompt=login` saiu do escopo — o código no e-mail cobre quem só tem Google
   sem depender do OAuth externo (que pode estar desligado), e o Google fica como evolução.
2. **Nunca a última forma de entrada.** O domínio recusa e um trigger em `identidades_conta` recusa de novo (2ª barreira,
   também contra corrida). O `nod_app` ganha `DELETE` em `identidades_conta` só para isso.
3. **Troca de e-mail** por código `troca_email` (link de uso único, 24 h) enviado ao endereço novo; o antigo vale até a
   confirmação e recebe o aviso. Confirmar revoga as outras sessões. O `nod_app` ganha `UPDATE (email)` em `contas`, por
   coluna.
4. **Exportação** assíncrona num zip guardado no banco (`exportacoes.arquivo`), válido por 7 dias, só com dados da
   pessoa e lista explícita de colunas secretas fora (cifrados, hashes, tokens, impressões, ids de sessão).
5. **Exclusão** programa `exclusoes_conta.purgar_em = agora + 30 dias`; desfazer vale até lá. Só para tenant pessoal:
   a marca `tenants.pessoal` (nasce no espaço provisório), nenhum domínio admitido, uma pessoa e uma ligação; fora
   disso responde `conta_de_equipe` e a purga recusa (`bloqueada`, `espaco_de_equipe`).
6. **Purga** pela função `nod_purgar_conta(p_exclusao)`, SECURITY DEFINER do dono, chamada por um laço de fundo atrás
   de `NOD_PURGA_CONTA=1`. Ela marca o GUC transacional `nod.purga_tenant`; uma policy `nod_purga` `TO nod_dono` em
   cada tabela escopada deixa o dono ver e apagar só esse tenant; e `nod_trilha_imutavel()` passa a permitir DELETE
   **só** quando `current_user = nod_dono`, o GUC aponta o tenant da linha **e** esse tenant tem uma exclusão
   programada e vencida (ou purgada há menos de 1 hora, para a varredura de depois). Fora disso a trilha segue
   imutável, para todos. Erro passageiro (deadlock, trava, serialização) conta tentativa e tenta de novo; na 5ª, ou
   com qualquer outro erro, a exclusão fica `bloqueada` e o laço avisa. A trava da própria exclusão ou da pessoa,
   no início (antes do bloco da purga), só adia para a próxima volta, sem contar tentativa (`lock_timeout` de 3 s).
7. **Fora do banco, exceção registrada.** A purga apaga só o que está no Postgres. Ficam para um follow-up (com o
   label precisa-humano, antes de ligar `NOD_PURGA_CONTA`): conexões no Composio/OAuth da pessoa (revogar no
   provedor), pastas de trabalho dos bots no disco (`NOD_HOME`) e a sessão do CLI pareado na máquina dela. Até lá, a
   flag fica desligada em produção.

## Consequências

- A ADR-004 ganha uma exceção estreita e testada (conformidade: UPDATE/DELETE na trilha continuam falhando fora da
  purga, inclusive como dono).
- `nod_escopar_tabela` cria a policy `nod_purga` nas tabelas futuras; a conformidade exige que toda tabela escopada a
  tenha, senão a purga deixaria dado para trás.

## Gatilho de reversão

Antes de sair do beta, a política de purga total é revista (jurídico/LGPD): retenção legal pode exigir anonimizar a
trilha em vez de apagá-la. Até essa revisão, `NOD_PURGA_CONTA` fica desligada em produção e a exclusão programada não
é executada.
