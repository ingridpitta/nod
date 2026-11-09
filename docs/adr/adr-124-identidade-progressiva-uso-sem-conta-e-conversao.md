# ADR-124 — Identidade progressiva: usar sem conta e converter sem perder o trabalho

Status: aceita · Data: 2026-10-23 · Issue: NOD-345 · Substitui a decisão central da
[ADR-030](adr-030-identidade-de-login-allowlist-por-email-semeada-nunca-provi.md), emenda a
[ADR-031](adr-031-a-chave-de-maquina-persiste-carrega-o-proprio-escopo-e-e-rev.md) e a
[ADR-069](adr-069-o-mac-se-conecta-pelo-navegador.md). Emendada pela
[ADR-126](adr-126-minha-conta-reautenticacao-exportacao-e-purga-no-beta.md) (troca de e-mail, desligar forma de entrada).

## Contexto

Hoje o app do Mac só começa depois de a pessoa entrar com Google, confirmar o computador e receber uma chave. O login
Google só reconhece uma `pessoa` já existente ou um domínio Workspace admitido. Não existem conta pessoal, senha,
recuperação de senha nem uma forma de usar o nod antes de se cadastrar.

Para o lançamento público, o cadastro antes do primeiro uso é uma barreira de retenção. A decisão de produto de
2026-10-23 é inverter a ordem: baixar, usar e perceber valor primeiro; criar uma conta depois. Quando a pessoa criar a
conta, o que ela fez sem login continua no mesmo lugar.

## Decisão

### 1. Pessoa, conta e forma de entrar são coisas diferentes

- `pessoas` continua sendo a identidade dentro de um tenant e o eixo de autoria/RLS.
- `contas` é a identidade global de acesso. Uma conta pode se ligar a uma `pessoa` em cada tenant; isso prepara a
  Jornada 2 sem transformar e-mail em chave de tenant.
- `identidades_conta` guarda as formas de entrar: `google` (o `sub` estável do Google) e `senha` (e-mail verificado +
  hash). Uma conta pode ter as duas.
- A pessoa provisória nasce sem `conta_id`. Criar ou entrar numa conta liga a conta à pessoa provisória existente, na
  mesma transação, sem trocar `tenant_id` nem `pessoa_id`. Conversas, bots, rotinas, acessos e arquivos portanto não
  migram: continuam apontando para a mesma pessoa.
- O `pessoas.email` legado permanece durante a transição por causa da regra de migração aditiva. Login novo não o usa
  como fonte da verdade; o e-mail canônico passa a ser da identidade da conta.

### 2. “Baixar e usar” cria um espaço provisório no servidor

Na primeira abertura, o app gera um verificador aleatório, guarda-o com `safeStorage` e chama um bootstrap público por
HTTPS. O servidor cria, por uma função mínima de dono, um tenant pessoal, uma pessoa provisória, o Nod fixo e uma chave
de máquina. Só o hash do verificador/chave fica no servidor. A resposta crua é mostrada uma vez ao app e nunca vai para
URL, log ou banco.

Isso é **sem login**, não offline: conversas e estado continuam no servidor, como hoje. A tela inicial deixa isso claro
e mostra `Criar conta` de forma discreta, sem bloquear o primeiro uso. Perder o único Mac antes de criar conta pode
significar perder o acesso ao espaço; o produto avisa isso depois de a pessoa já ter usado, não como portão inicial.

O bootstrap é protegido por limite por IP e por instalação, desafio anti-automação depois de abuso e cota pequena do
espaço provisório. A resposta de erro nunca diz se um e-mail já existe.

### 3. Converter preserva o espaço provisório

- **Google:** qualquer conta Google com `email_verified`; o vínculo usa `iss + sub`, nunca `hd`. Gmail pessoal entra.
- **E-mail e senha:** a pessoa informa e-mail e senha, recebe um código de verificação de 6 dígitos (uso único, 15 min, no máximo 5
  tentativas; guardado só em hash) e só então a identidade fica ativa. Definido em 2026-10-23: código em vez de link,
  porque o cartão fica no chat do Nod e a pessoa não precisa trocar de janela (protótipo v3 da NOD-345).
- Se o Google ou o e-mail verificado ainda não pertence a uma conta, o cadastro converte automaticamente o espaço
  provisório: a mesma pessoa, tenant e trabalho passam a ter conta, sem tela de importação.
- Se o Google ou o e-mail verificado já pertence a uma conta, o produto interrompe a entrada antes de trocar de espaço
  e oferece três caminhos claros: importar o trabalho provisório para a conta existente (ação principal), criar uma
  conta nova com outro endereço ou cancelar e continuar no espaço provisório. Importar preserva o conteúdo que já
  existe na conta e mantém ambos quando houver conflito; nunca sobrescreve nem descarta silenciosamente.
- Converter revoga o segredo provisório depois de emitir uma sessão normal e uma chave de máquina ligada à conta. A
  operação é transacional e idempotente: repetir o callback não cria outra pessoa nem outro tenant.

### 4. Senha, recuperação e sessões

- E-mails de verificação e recuperação são enviados pelo Resend usando o domínio `nodbot.ai`.
- Senhas são processadas com Argon2id e parâmetros versionados; o servidor guarda só o hash. O tamanho aceito é de 12 a
  128 caracteres e não há regras de composição.
- Recuperar senha sempre responde da mesma forma. Quando a conta existe, envia um token aleatório, de uso único, com
  hash no banco e validade de 30 minutos. Pedir outro invalida o anterior.
- Trocar ou redefinir a senha revoga todas as sessões, exceto a sessão que concluiu a ação, e invalida tokens de
  recuperação pendentes. Chaves de máquina ficam ativas e podem ser revogadas em Computadores.
- Sessões passam a ter registro revogável no banco, mantendo no cookie apenas um identificador opaco assinado. `Sair`
  revoga a sessão atual; `Sair de todos os dispositivos` revoga as demais.
- E-mail, senha, tokens, cookies e códigos nunca entram em trilha, métricas ou mensagens de erro. As rotas mutáveis usam
  CSRF e rate limit por conta/IP.

### 5. Relação com o modo de desenvolvimento

`NOD_LOGIN=stub` continua apenas em loopback. Produção aceita `conta` e `provisorio`; não existe fallback automático
para stub. O bootstrap provisório pode ser desligado por configuração em instalações internas, mas vem ligado no
produto público.

### 6. Como entra no ar (NOD-345)

Tudo atrás de flags, desligadas por padrão; com elas desligadas, o servidor é o de antes (nenhuma rota e nenhuma
consulta nova). O servidor recusa subir com combinação inválida.

| Flag | O que liga | Exige |
| --- | --- | --- |
| `NOD_CONTAS=1` | sessão revogável (sid no cookie), e-mail e senha, código de 6 números, escolha/importação, recuperação, trocar senha, sessões, pareamento de outro computador | com `NOD_LOGIN=google`: `NOD_RESEND_API_KEY`, `NOD_EMAIL_REMETENTE` (domínio `nodbot.ai`) e `NOD_URL_PUBLICA` |
| `NOD_BOOTSTRAP=1` | o espaço provisório por instalação (app e web), sem cadastro | `NOD_CONTAS=1` |
| `NOD_CONTAS_GOOGLE=1` | "Continuar com Google" para Gmail e Workspace (sem `hd`, identidade `iss`+`sub`) | `NOD_CONTAS=1`, `NOD_LOGIN=google` e o client OAuth em modo **externo** |

Em `NOD_LOGIN=stub` os e-mails vão para a caixa local (`GET /api/dev/caixa`, só em loopback). A web e o app decidem
pelo campo `contas` de `/api/sessao/modo`, nunca por tentativa e 404. Ligar em produção depende do domínio `nodbot.ai`
no Resend e do OAuth externo (label precisa-humano na NOD-345).

Suposições registradas na decisão original: sem cota por espaço provisório (substituída pela ADR-137); o provisório não é apagado ao
converter nem ao importar (fica sem acesso); o código de verificação é por sessão; o pareamento não mostra cidade; no
app, o nome inicial do espaço é o usuário do sistema; a volta do Google iniciada no app termina com a sessão no
navegador e o app relê o estado.

**Em produção (NOD-406, 2026-10-28):** `NOD_CONTAS=1` e `NOD_BOOTSTRAP=1` ligados em app.nodbot.ai, com o remetente
`conta@nodbot.ai` e a chave do Resend (só de envio) no segredo `nod-resend-api-key`; `NOD_CONTAS_GOOGLE` e
`NOD_MINHA_CONTA` seguem desligados e o `deploy.sh` recusa ligá-los até terem caminho. O bootstrap vai junto porque o
cadastro por e-mail só converte um espaço provisório; isso abre o app para quem chega sem login, como a §2 prevê para
o produto público. A ADR-137 acrescentou, atrás de flags próprias e inicialmente desligadas, a cota por espaço, o
desafio anti-automação, os limites diários/de domínio e a revisão dos textos jurídicos. A equipe (ADR-030) entra pelo link "Sou
da equipe: entrar com Google" do cartão de entrar e do menu do espaço provisório; o navegador que já entrou pela equipe
guarda a marca `nod-equipe` e, quando a sessão cai, volta à tela de entrar em vez de abrir um provisório; a volta
recusada do Google mostra o motivo e tira a marca. Valem os gatilhos de reversão de baixo (10% da capacidade por três
dias); além deles, qualquer abuso de bootstrap visível no gasto do dia. Reverter é `NOD_BOOTSTRAP` vazio no
`config.env` e o deploy (as contas já criadas seguem entrando).

## Impacto nas decisões anteriores

- **ADR-030:** deixa de valer a regra “login só consulta pessoa admitida”. A allowlist e a admissão por domínio ficam
  como caminho de compatibilidade para instalações internas até migrarem; não são a identidade do produto público.
- **ADR-031:** a chave continua persistente, escopada e revogável. No espaço provisório ela nasce no bootstrap, antes de
  existir conta.
- **ADR-069:** “Entrar com Google” deixa de ser a primeira tela obrigatória. O pareamento pelo navegador continua para
  um segundo computador; o primeiro é pareado pelo bootstrap e pode criar conta depois.
- **ADR-003:** a aplicação continua sem `INSERT` direto em `tenants`/`pessoas`. Bootstrap e conversão usam funções
  `SECURITY DEFINER` estreitas, com argumentos e efeitos fechados, e testes de conformidade.

## Alternativas descartadas

- **Rodar servidor e banco inteiros dentro do app.** Entregaria uso offline, mas cria duas arquiteturas, migração de
  dados local→nuvem e conflito com o app atual, que depende do servidor. “Sem login” não exige “sem internet”.
- **Criar uma conta anônima.** Mistura acesso com pessoa e torna a conversão uma troca de identidade. Pessoa provisória
  sem conta preserva a separação e prepara múltiplos tenants.
- **Usar e-mail como identidade.** E-mail muda; no Google, `sub` é o identificador estável. O e-mail é endereço de
  contato e prova de posse, não chave primária.
- **Fundir automaticamente quando o e-mail já existe.** Um e-mail verificado prova controle do endereço, não intenção
  de misturar dois espaços com bots e efeitos externos. A importação para conta existente exige confirmação explícita.
- **Link mágico como único login.** Reduz senha, mas não atende a decisão explícita de oferecer credenciais e deixa o
  acesso dependente do e-mail a cada entrada.

## Limites

- O modo provisório depende de internet e do servidor.
- No beta, a exclusão apaga todos os dados da conta depois do prazo de arrependimento, sem retenção seletiva; a política
  e os textos jurídicos serão revistos antes do lançamento público.
- Importar um espaço provisório para uma conta existente faz parte da Jornada 1 e exige confirmação; conta nova é
  conversão automática, não importação.
- A Jornada 2 decide papéis, convite e troca de tenant. Este ADR só deixa o modelo pronto para uma conta participar de
  mais de um tenant.

## Gatilhos de reversão

- Se mais de 5% dos espaços provisórios ativos por sete dias perderem o único acesso antes da conversão, oferecer uma
  segunda prova de recuperação ainda no modo provisório.
- Se menos de 20% de quem conclui uma primeira conversa criar conta em 14 dias, rever o momento e o texto do convite,
  sem recolocar cadastro antes do uso.
- Se o bootstrap abusivo consumir mais de 10% da capacidade diária durante três dias, exigir desafio antes de criar o
  espaço, mantendo o primeiro uso sem conta.
- Se a conversão falhar ou duplicar pessoa em mais de 0,1% das tentativas, interromper a conversão e voltar ao
  pareamento autenticado até corrigir a idempotência.
