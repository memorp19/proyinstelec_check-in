# Setup Google Drive — Almacenamiento de Evidencias

Estos pasos se ejecutan **una sola vez** antes del primer deploy a producción.
No se requiere Domain-Wide Delegation ni permisos de Admin de Workspace.

---

## 1. Crear la Service Account en Google Cloud

```bash
# Proyecto de Google Cloud corporativo de Proyinstelec
gcloud iam service-accounts create field-app-storage \
  --display-name="Field App Storage" \
  --project=TU_PROYECTO_GCP
```

## 2. Generar y descargar la JSON key

```bash
gcloud iam service-accounts keys create /tmp/field-app-storage-key.json \
  --iam-account=field-app-storage@TU_PROYECTO_GCP.iam.gserviceaccount.com
```

Guarda el archivo en un lugar seguro. Lo necesitas en el paso 5.

## 3. Crear la carpeta raíz en Google Drive

1. Abre Google Drive con una cuenta admin de Proyinstelec
2. Crea la carpeta: **"Proyinstelec Field App"**
3. Copia el **ID de la carpeta** de la URL:
   `https://drive.google.com/drive/folders/`**`1BxiMYourFolderIDHere`**

## 4. Compartir la carpeta con la Service Account

1. Click derecho sobre la carpeta → **Compartir**
2. Añade el email de la service account: `field-app-storage@TU_PROYECTO_GCP.iam.gserviceaccount.com`
3. Otorga rol **Editor**
4. Desmarca "Notificar a las personas" → **Listo**

La app creará subcarpetas automáticamente con esta estructura:
```
Proyinstelec Field App/
└── Proyectos/
    └── Subestación Polanco/
        └── 2026-05-14/
            └── Carlos Reyes/
                ├── checkin_0941.jpg
                ├── checkout_1741.jpg
                └── evidencias/
                    └── 1015_panel-revision.jpg
```

## 5. Subir credenciales a SSM Parameter Store

```bash
# Email de la service account (String)
aws ssm put-parameter \
  --name /proyinstelec/drive/service-account-email \
  --value "field-app-storage@TU_PROYECTO_GCP.iam.gserviceaccount.com" \
  --type String \
  --overwrite \
  --region us-east-1

# JSON key completo (SecureString — cifrado con KMS)
aws ssm put-parameter \
  --name /proyinstelec/drive/service-account-key \
  --value "$(cat /tmp/field-app-storage-key.json)" \
  --type SecureString \
  --overwrite \
  --region us-east-1

# ID de la carpeta raíz (String)
aws ssm put-parameter \
  --name /proyinstelec/drive/root-folder-id \
  --value "1BxiMYourFolderIDHere" \
  --type String \
  --overwrite \
  --region us-east-1

# Borrar el archivo local de la key
rm /tmp/field-app-storage-key.json
```

## 6. Verificar

```bash
# Confirmar que los parámetros existen
aws ssm get-parameters \
  --names /proyinstelec/drive/service-account-email \
          /proyinstelec/drive/root-folder-id \
  --region us-east-1

# El key SecureString requiere --with-decryption
aws ssm get-parameter \
  --name /proyinstelec/drive/service-account-key \
  --with-decryption \
  --region us-east-1 | jq '.Parameter.Value | fromjson | .client_email'
```

## Para desarrollo local

En lugar de SSM, usa variables de entorno directas en `.env.local`:

```env
DRIVE_SERVICE_ACCOUNT_EMAIL=field-app-storage@TU_PROYECTO_GCP.iam.gserviceaccount.com
DRIVE_SERVICE_ACCOUNT_KEY={"type":"service_account","client_email":"...","private_key":"..."}
DRIVE_ROOT_FOLDER_ID=1BxiMYourFolderIDHere
```

Para leer desde env en local, actualiza `drive.ts` para intentar primero las vars de entorno directas antes de llamar a SSM (ya contemplado con el fallback en `getDriveConfig()`).
