#!/usr/bin/env bash
# Cria (ou confere) a infraestrutura de produção do nod na GCP. Idempotente: cada recurso só é criado
# se ainda não existe, então dá para rodar de novo depois de uma falha. Roda do Mac, com o gcloud
# logado numa conta dona do projeto. Ver docs/deploy-gcp.md.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
G="${GCLOUD:-gcloud}"
gc() { "$G" --project="$PROJETO" --quiet "$@"; }
passo() { printf '\n== %s\n' "$*"; }

passo "APIs"
gc services enable compute.googleapis.com sqladmin.googleapis.com servicenetworking.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com iap.googleapis.com logging.googleapis.com monitoring.googleapis.com cloudresourcemanager.googleapis.com \
  texttospeech.googleapis.com aiplatform.googleapis.com speech.googleapis.com

passo "Rede $REDE (sem as regras abertas da rede default)"
gc compute networks describe "$REDE" >/dev/null 2>&1 || gc compute networks create "$REDE" --subnet-mode=custom
gc compute networks subnets describe "$SUBREDE" --region="$REGIAO" >/dev/null 2>&1 ||
  gc compute networks subnets create "$SUBREDE" --network="$REDE" --region="$REGIAO" --range="$SUBREDE_FAIXA" --enable-private-ip-google-access
# Só TCP (NOD-254, 2026-10-15): sem HTTP/3 na VM; quem já tinha a regra com udp:443 fica só com TCP ao rodar de novo.
if gc compute firewall-rules describe nod-web >/dev/null 2>&1; then
  gc compute firewall-rules update nod-web --allow=tcp:80,tcp:443
else
  gc compute firewall-rules create nod-web --network="$REDE" --direction=INGRESS --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=nod-web
fi
# SSH só pelo IAP (faixa fixa do Google): o deploy entra por túnel, nunca pela internet.
gc compute firewall-rules describe nod-ssh-iap >/dev/null 2>&1 ||
  gc compute firewall-rules create nod-ssh-iap --network="$REDE" --direction=INGRESS --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=nod-web

passo "Acesso privado a serviços (peering do Cloud SQL)"
gc compute addresses describe "$PSA_FAIXA_NOME" --global >/dev/null 2>&1 ||
  gc compute addresses create "$PSA_FAIXA_NOME" --global --purpose=VPC_PEERING --prefix-length="$PSA_FAIXA_PREFIXO" --network="$REDE"
gc services vpc-peerings list --network="$REDE" --format='value(service)' | grep -q servicenetworking ||
  gc services vpc-peerings connect --service=servicenetworking.googleapis.com --ranges="$PSA_FAIXA_NOME" --network="$REDE"

passo "Segredos (gerados uma vez; nunca saem do Secret Manager)"
segredo_gerado() { # nome, comando que gera o valor
  gc secrets describe "$1" >/dev/null 2>&1 && return 0
  eval "$2" | tr -d '\n' | gc secrets create "$1" --replication-policy=user-managed --locations="$REGIAO" --data-file=-
}
segredo_gerado nod-pg-senha-postgres "openssl rand -hex 24"
segredo_gerado nod-pg-senha-dono "openssl rand -hex 24"
segredo_gerado nod-pg-senha-app "openssl rand -hex 24"
segredo_gerado nod-sessao-segredo "openssl rand -base64 48"
segredo_gerado nod-credential-key "openssl rand -hex 32"
# Os dois do Google, a chave da API do revisor (ADR-115) e a do Resend (ADR-124, NOD-406) são cadastrados à mão
# (docs/deploy-gcp.md); aqui só nascem vazios. Sem versão, o deploy com NOD_REVISOR=ligado ou NOD_CONTAS=1 para antes
# de subir a cor nova.
for s in nod-google-client-id nod-google-client-secret nod-anthropic-revisor nod-resend-api-key; do
  gc secrets describe "$s" >/dev/null 2>&1 || gc secrets create "$s" --replication-policy=user-managed --locations="$REGIAO"
done

passo "Cloud SQL $SQL_INSTANCIA ($SQL_VERSAO, $SQL_TIER, só IP privado)"
if ! gc sql instances describe "$SQL_INSTANCIA" >/dev/null 2>&1; then
  gc sql instances create "$SQL_INSTANCIA" --database-version="$SQL_VERSAO" --edition=ENTERPRISE --tier="$SQL_TIER" \
    --region="$REGIAO" --availability-type=zonal --network="projects/$PROJETO/global/networks/$REDE" --no-assign-ip \
    --ssl-mode=ENCRYPTED_ONLY --storage-type=SSD --storage-size=10 --storage-auto-increase \
    --backup-start-time=06:00 --retained-backups-count=7 --enable-point-in-time-recovery --retained-transaction-log-days=7 \
    --maintenance-window-day=SUN --maintenance-window-hour=7 --deletion-protection \
    --root-password="$(gc secrets versions access latest --secret=nod-pg-senha-postgres)"
fi
SQL_IP_ATUAL="$(gc sql instances describe "$SQL_INSTANCIA" --format='value(ipAddresses[0].ipAddress)')"
echo "IP privado do Cloud SQL: $SQL_IP_ATUAL (grave em SQL_IP no config.env)"

passo "Artifact Registry $REPO"
gc artifacts repositories describe "$REPO" --location="$REGIAO" >/dev/null 2>&1 ||
  gc artifacts repositories create "$REPO" --repository-format=docker --location="$REGIAO"

passo "Cloud Build (opcional: construir a imagem sem Docker local)"
gc services enable cloudbuild.googleapis.com
NUMERO_CB="$(gc projects describe "$PROJETO" --format='value(projectNumber)')"
for papel in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  gc projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$NUMERO_CB-compute@developer.gserviceaccount.com" --role="$papel" --condition=None >/dev/null
done

passo "Conta de serviço da VM"
SA_VM="app-vm@$PROJETO.iam.gserviceaccount.com"
gc iam service-accounts describe "$SA_VM" >/dev/null 2>&1 || gc iam service-accounts create nod-vm --display-name="nod: VM"
# ADR-071: a voz da ligação (Transcribe Live pela Vertex, Chirp 3 HD) roda com a conta da VM.
# NOD-329: roles/speech.client para o STT de arquivo (Speech-to-Text v2 recognize, chirp_2) do memo de voz.
for papel in roles/logging.logWriter roles/monitoring.metricWriter roles/aiplatform.user roles/serviceusage.serviceUsageConsumer roles/speech.client; do
  gc projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA_VM" --role="$papel" --condition=None >/dev/null
done
gc artifacts repositories add-iam-policy-binding "$REPO" --location="$REGIAO" --member="serviceAccount:$SA_VM" --role=roles/artifactregistry.reader >/dev/null
for s in nod-pg-senha-postgres nod-pg-senha-dono nod-pg-senha-app nod-sessao-segredo nod-credential-key nod-google-client-id nod-google-client-secret nod-anthropic-revisor nod-resend-api-key; do
  gc secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA_VM" --role=roles/secretmanager.secretAccessor >/dev/null
done

passo "IP fixo e VM $VM_NOME"
gc compute addresses describe "$VM_IP_NOME" --region="$REGIAO" >/dev/null 2>&1 || gc compute addresses create "$VM_IP_NOME" --region="$REGIAO"
IP="$(gc compute addresses describe "$VM_IP_NOME" --region="$REGIAO" --format='value(address)')"
if ! gc compute instances describe "$VM_NOME" --zone="$ZONA" >/dev/null 2>&1; then
  gc compute instances create "$VM_NOME" --zone="$ZONA" --machine-type="$VM_TIPO" \
    --network-interface="subnet=$SUBREDE,address=$IP" --tags=nod-web \
    --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --boot-disk-type=pd-balanced \
    --service-account="$SA_VM" --scopes=cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata=enable-oslogin=TRUE --metadata-from-file=startup-script=vm/preparar.sh
fi
echo "IP público: $IP  →  provisório: https://${IP//./-}.sslip.io"

passo "Deploy pelo GitHub Actions (Workload Identity Federation, sem chave guardada)"
SA_DEPLOY="nod-deploy@$PROJETO.iam.gserviceaccount.com"
NUMERO="$(gc projects describe "$PROJETO" --format='value(projectNumber)')"
gc iam service-accounts describe "$SA_DEPLOY" >/dev/null 2>&1 || gc iam service-accounts create nod-deploy --display-name="nod: deploy do GitHub"
gc artifacts repositories add-iam-policy-binding "$REPO" --location="$REGIAO" --member="serviceAccount:$SA_DEPLOY" --role=roles/artifactregistry.writer >/dev/null
for papel in roles/compute.viewer roles/compute.osAdminLogin roles/iap.tunnelResourceAccessor; do
  gc projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA_DEPLOY" --role="$papel" --condition=None >/dev/null
done
gc iam service-accounts add-iam-policy-binding "$SA_VM" --member="serviceAccount:$SA_DEPLOY" --role=roles/iam.serviceAccountUser >/dev/null
gc iam workload-identity-pools describe github --location=global >/dev/null 2>&1 ||
  gc iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gc iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1 ||
  gc iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
    --attribute-condition="assertion.repository == '$GITHUB_REPO' && assertion.ref == 'refs/heads/main'"
gc iam service-accounts add-iam-policy-binding "$SA_DEPLOY" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO" >/dev/null
echo "Provider WIF: projects/$NUMERO/locations/global/workloadIdentityPools/github/providers/github"
echo "Conta de deploy: $SA_DEPLOY"

passo "Ensaio de restauração pelo GitHub Actions (NOD-205, conta própria, sem escrita na produção)"
# A nod-ensaio clona o nod-pg numa cópia nod-pg-ensaio-*, entra na VM pelo IAP para comparar e apaga a cópia.
# Nenhum papel de escrita em Secret Manager, Artifact Registry ou Compute: a senha do banco é lida pela conta
# da VM, na VM. Dois papéis customizados para que ela não consiga desligar a proteção contra exclusão nem
# apagar o nod-pg: update/delete só valem para nomes com o prefixo (condição IAM), e o script repete a regra.
SA_ENSAIO="nod-ensaio@$PROJETO.iam.gserviceaccount.com"
gc iam service-accounts describe "$SA_ENSAIO" >/dev/null 2>&1 ||
  gc iam service-accounts create nod-ensaio --display-name="nod: ensaio de restauração do GitHub"
papel_customizado() { # id, título, permissões (create na primeira vez; update iguala a lista nas seguintes)
  if gc iam roles describe "$1" >/dev/null 2>&1; then
    gc iam roles update "$1" --title="$2" --permissions="$3" --stage=GA >/dev/null
  else
    gc iam roles create "$1" --title="$2" --permissions="$3" --stage=GA >/dev/null
  fi
}
# O clone é checado na instância de origem (instances/nod-pg/clone): fica no papel sem condição. O Cloud SQL
# não tem família de permissões de operações: `gcloud sql operations list/wait` pedem cloudsql.instances.get/list
# (docs do Cloud SQL, "IAM permissions", 2026-10-09).
papel_customizado nodEnsaioLeitura "nod: ensaio de restauração (clonar e ler)" \
  cloudsql.instances.get,cloudsql.instances.list,cloudsql.instances.clone,cloudsql.instances.create
papel_customizado nodEnsaioApagar "nod: ensaio de restauração (apagar a cópia)" \
  cloudsql.instances.update,cloudsql.instances.delete
gc projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA_ENSAIO" \
  --role="projects/$PROJETO/roles/nodEnsaioLeitura" --condition=None >/dev/null
gc projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA_ENSAIO" \
  --role="projects/$PROJETO/roles/nodEnsaioApagar" \
  --condition="expression=resource.name.startsWith(\"projects/$PROJETO/instances/nod-pg-ensaio-\"),title=so-copias-de-ensaio,description=Só instâncias nod-pg-ensaio-* (NOD-205)" >/dev/null
for papel in roles/compute.viewer roles/compute.osAdminLogin roles/iap.tunnelResourceAccessor; do
  gc projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$SA_ENSAIO" --role="$papel" --condition=None >/dev/null
done
gc iam service-accounts add-iam-policy-binding "$SA_VM" --member="serviceAccount:$SA_ENSAIO" --role=roles/iam.serviceAccountUser >/dev/null
gc iam service-accounts add-iam-policy-binding "$SA_ENSAIO" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO" >/dev/null
echo "Conta do ensaio: $SA_ENSAIO (grave na variável GCP_ENSAIO_SA do repositório)"

passo "Atualização do app do Mac (NOD-132, ADR-149)"
# Bucket privado dos ZIPs; a VM só lê e assina URL curta com um papel que tem só o signBlob (menor privilégio: com
# signBlob sobre si mesma a SA ainda assina um JWT e troca por token, mas é a própria VM, sem escalada). Quem publica é
# a conta de quem roda o script de publicação.
BUCKET_ATUALIZACOES="gs://$PROJETO-atualizacoes"
gc storage buckets describe "$BUCKET_ATUALIZACOES" >/dev/null 2>&1 ||
  gc storage buckets create "$BUCKET_ATUALIZACOES" --location="$REGIAO" --uniform-bucket-level-access --public-access-prevention
gc storage buckets add-iam-policy-binding "$BUCKET_ATUALIZACOES" --member="serviceAccount:$SA_VM" --role=roles/storage.objectViewer >/dev/null
papel_customizado nodAssinarBlob "nod: assinar URL do bucket" iam.serviceAccounts.signBlob
gc iam service-accounts add-iam-policy-binding "$SA_VM" --member="serviceAccount:$SA_VM" \
  --role="projects/$PROJETO/roles/nodAssinarBlob" >/dev/null
