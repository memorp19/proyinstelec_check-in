# Despliegue: Vercel + Neon

Guía de punta a punta para dejar corriendo la rama `feat/vercel-neon`.
Orden recomendado: **Neon → Google OAuth → Vercel → migraciones → siembra**.

---

## 1. Base de datos en Neon

1. Crear un proyecto en [console.neon.tech](https://console.neon.tech) (región `us-east-1`
   para quedar junto a las funciones de Vercel).
2. Neon crea la rama `main` (producción). Crear además una rama `develop` desde
   el dashboard: será la base de la rama de feature y de desarrollo local, y se
   puede resetear sin tocar producción.
3. Copiar de cada rama la cadena **pooled** (la que dice `-pooler`) —
   es la que aguanta muchas conexiones cortas de funciones serverless.

```
postgresql://usuario:password@ep-xxxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
```

## 2. Credenciales de Google

**OAuth (inicio de sesión).** En Google Cloud Console → *APIs & Services* →
*Credentials* → OAuth client ID (tipo *Web application*), agregar como URIs de
redirección autorizadas:

```
http://localhost:3000/api/auth/callback/google
https://<tu-proyecto>.vercel.app/api/auth/callback/google
https://<dominio-final>/api/auth/callback/google
```

Los *preview deployments* de Vercel usan un dominio distinto en cada commit; para
probar el login en preview, agregar también la URL del preview que vayas a usar
(o probar el login sólo en producción y usar `DEMO_MODE=true` en previews).

**Service account (Drive y correo).** El mismo del sistema actual. Para el envío
de correo hace falta habilitar la delegación de dominio en la consola de
administrador de Workspace con el scope `https://www.googleapis.com/auth/gmail.send`.

## 3. Proyecto en Vercel

**Un solo proyecto.** Si el import se intentó varias veces, Vercel creó un proyecto
por intento (`…-web`, `…-web-kmtb`, `…-web-l14g`, …). Conservar uno y borrar el
resto en *Project Settings → Advanced → Delete Project*, para que no compitan por
el mismo repositorio.

1. *Add New → Project* → importar `memorp19/proyinstelec_check-in`.
2. **Root Directory: `apps/web`** ← lo más importante. Este es un monorepo pnpm y
   la app de Next.js vive ahí. Si se deja la raíz, el build falla con
   *"No Next.js version detected"*, porque el `package.json` de la raíz no
   depende de `next`. Se cambia en *Settings → General → Root Directory → Edit*.
3. Framework Preset: **Next.js** (se detecta solo al fijar el Root Directory).
   Dejar *Build Command*, *Output Directory* e *Install Command* en automático:
   Vercel reconoce el workspace de pnpm e instala desde la raíz por su cuenta.
   Por eso este repositorio **no** lleva `vercel.json`.
4. Cargar las variables de entorno de `apps/web/.env.example`:
   - `DATABASE_URL`: rama `develop` de Neon en *Preview*, rama `main` en *Production*.
   - `AUTH_SECRET`: `openssl rand -base64 32`.
   - **No** definir `NEXTAUTH_URL` ni `AUTH_URL` en Vercel (se detectan solos).
   - `DRIVE_SERVICE_ACCOUNT_KEY`: el JSON completo en una sola línea.
   - Sin `DATABASE_URL` y `AUTH_SECRET` el build sí pasa, pero la app responde 500
     en cuanto toca la base o la sesión.
5. *Settings → Git → Production Branch* debe seguir siendo `main`: así cada push a
   `feat/vercel-neon` publica un preview y producción no se toca.

### Login en los previews

Cada deployment tiene una URL distinta, pero Vercel mantiene además un alias
estable por rama:

```
https://<proyecto>-git-feat-vercel-neon-<equipo>.vercel.app
```

Esa es la URL que conviene agregar a las URIs de redirección de Google
(`…/api/auth/callback/google`) para poder probar el login en la rama sin ir
agregando una URL por cada commit.

## 4. Migraciones

El esquema vive en `apps/web/src/db/schema.ts` y las migraciones en
`apps/web/drizzle/`.

```bash
pnpm db:generate   # genera el SQL tras cambiar el esquema
pnpm db:migrate    # lo aplica a la base de DATABASE_URL
pnpm db:studio     # explorador visual de datos
```

`db:push` existe para iterar rápido en desarrollo (aplica el esquema sin generar
migración); en la base de producción usar siempre `db:migrate`.

Las migraciones **no** corren solas en el despliegue: se aplican a mano antes de
publicar un cambio de esquema, para que un deploy nunca altere la base por
sorpresa.

## 5. Siembra

```bash
pnpm db:seed
```

Crea usuarios de trabajo (admin, comercial, revisor, campo), una empresa con su
proyecto, una invitación de prueba y el catálogo de áreas del ERP. Los usuarios
quedan "sembrados": al entrar con Google, Auth.js los enlaza por correo y
conserva rol y permisos.

## 6. Desarrollo local

```bash
cp apps/web/.env.example apps/web/.env.local   # y llenar valores
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

No hace falta Docker ni base local: se trabaja contra la rama `develop` de Neon.
Para trabajar sin Google ni base, `pnpm dev:demo`.

---

## Notas de arquitectura

- **Driver HTTP de Neon** (`@neondatabase/serverless`): sin pool de conexiones,
  funciona igual en funciones serverless, en el runtime edge del middleware y en
  los scripts. A cambio no hay transacciones interactivas: la atomicidad se
  resuelve con sentencias únicas (`ON CONFLICT`, `UPDATE ... WHERE ... RETURNING`).
- **Auth.js v5** con adaptador de Drizzle. Sesión en JWT para que el middleware
  no consulte la base en cada petición; la configuración está partida en
  `src/auth.config.ts` (sin base, apta para edge) y `src/auth.ts` (completa).
- El personal de planta se detecta por el dominio del correo
  (`GOOGLE_WORKSPACE_DOMAIN`) y entra listo para trabajar; los temporales llegan
  por invitación y completan su alta antes de poder usar la app.
