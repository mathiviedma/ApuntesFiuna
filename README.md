# apuntes.fiuna — Hackathon CPF 2026 · Reto 12

Repositorio de apuntes y exámenes anteriores por materia, con matching de tutorías.
Cubre los cursos básicos (semestres 1 a 4) de la Malla 2023 de Ingeniería Civil e Ingeniería Electromecánica.

## 1. Instalar Node.js

Se necesita **Node.js 22.13 o más nuevo** y un proyecto de Supabase (ver la sección de despliegue al final).

**Windows** (PowerShell):
```powershell
winget install OpenJS.NodeJS.LTS
```
o descargá el instalador LTS de https://nodejs.org. Cerrá y volvé a abrir la terminal después de instalar.

**macOS**: `brew install node` o el instalador de https://nodejs.org.

**Linux (Ubuntu/Debian)**:
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Comprobá la versión:
```bash
node --version   # v22.13.0 o mayor
npm --version
```

## 2. Instalar dependencias y arrancar

```bash
cd apuntes-fiuna
npm install
npm start
```

`npm install` también descarga Chromium (~150 MB, una sola vez), que se usa para leer las notas de insweb. Si ya tenés Google Chrome o Edge instalado, podés evitar la descarga: creá un `.env` con `INSWEB_CANAL=chrome` (o `msedge`) y ejecutá `npm install --ignore-scripts`.

Abrí http://localhost:3000. La primera vez se cargan datos de demo (4 usuarios, 12 apuntes, 5 tutores).

| Cuenta de demo | Contraseña | Rol |
|---|---|---|
| ana.benitez@fiuna.edu.py | demo1234 | Civil, sin tutorías |
| carla.ortiz@fiuna.edu.py | demo1234 | Electromecánica, tutora de Cálculo 1 |
| bruno.gimenez@fiuna.edu.py | demo1234 | Electromecánica |
| diego.ramirez@fiuna.edu.py | demo1234 | Civil, tutor de Cálculo 1 y Estática |

Otros comandos:

- `npm run dev`: reinicia el servidor solo cuando cambiás código.
- `npm run db:init`: aplica el esquema en Supabase, carga las materias y crea el bucket (`-- --demo` agrega datos de ejemplo).

## Funciones

- **Apuntes:** se suben con su materia, tipo, año y período. El buscador ignora tildes. Los apuntes con más me gusta (♥) aparecen primero.
- **Mis apuntes:** cada usuario puede editar los datos de lo que subió, reemplazar el archivo o borrarlo. Nadie puede tocar el material de otro.
- **Tutorías:** tutores verificados en insweb (nota 4 o 5). Cada tutor tiene un máximo de **5 alumnos a la vez**; se cambia con `CUPO_TUTOR`. El alumno ve los cupos libres, pide la tutoría, y recién entonces ve el WhatsApp o el email del tutor. Si el alumno deja la tutoría o el tutor la da por terminada, el cupo se libera.

## 3. Guion de la demo (dos navegadores lado a lado)

1. **Subir y encontrar.** En el navegador A entrá como Ana, andá a **Subir** y subí un PDF de *Cálculo 2*, tipo *Examen · final*. En el navegador B (ventana de incógnito), sin sesión, buscá `calculo 2 final`. Aparece aunque se escriba sin tilde.
2. **Pedir ayuda.** En el navegador B, entrá como Ana y andá a **Tutorías** → *Cálculo 1*. Carla tiene 3 de 5 cupos libres y Diego está lleno. Pedile tutoría a Carla: aparecen su WhatsApp y su email, y en **Ser tutor** de Carla, Ana figura en *Mis alumnos*.
3. **Ofrecerse como tutor.** En el navegador A (Ana), andá a **Ser tutor**, marcá materias que hayas aprobado, cargá el WhatsApp (opcional) y tocá **Inscribirme**. Luego verificá con **tu usuario y contraseña reales de insweb**: la app entra a insweb, abre *Notas finales* y marca cada materia como cumplida o no.
4. Volvé a **Tutorías** en el navegador B: Ana ya aparece en la lista de las materias que cumplieron.

**Plan B sin internet:** con `VERIFICADOR=simulado` en `.env`, la verificación usa `data/insweb-simulado.json`. El usuario `1111111` / `demo` tiene Cálculo 1 con un 1 por aplazo y después un 4, así que cumple. El usuario `2222222` / `demo` tiene Cálculo 1 con 3 (no cumple) y Mecánica y Calor con 5 (cumple).

## 4. Verificación contra insweb

La regla es: en **Notas finales** tiene que existir **al menos una** fila de la materia con nota 4 o 5. Las filas con notas más bajas, por ejemplo aplazos anteriores, no afectan el resultado.

insweb es una aplicación de una sola página: el servidor no entrega ni el formulario ni las notas, los dibuja JavaScript en el navegador. Por eso el verificador (`src/verificador/insweb.js`) usa **Playwright**, un Chromium sin ventana que hace lo mismo que el alumno:

1. Abre `https://insweb.ing.una.py/login`, completa usuario y contraseña y envía el formulario. Si insweb muestra un mensaje de error, ese mensaje se le muestra al alumno.
2. Va a `/main/NotasFinales`. Primero navega dentro de la app, sin recargar, para no perder la sesión. Si eso no funciona, carga la URL directamente. Y si al recargar insweb vuelve al login, entra de nuevo y usa el menú *Notas → Notas finales*.
3. Lee las notas de la respuesta que la página recibe de `/insweb-backend/notas_finales/`. Cada registro tiene esta forma:
   ```json
   { "descrip": "CALCULO 1", "codnota": "4  ", "codasign": "23012", "fechaacta": "21/12/2024", "acta": "37411", "tipo": "NOTAS FINALES" }
   ```
   La materia sale de `descrip` y la nota de `codnota`. Si ese endpoint no respondiera, se usa como respaldo la tabla visible, ubicando las columnas por encabezado y recorriendo la paginación.

Los nombres se comparan ignorando tildes, mayúsculas y números romanos (`CÁLCULO II` = `Cálculo 2`).

**Cómo se probó:** el formato de `notas_finales` se confirmó con una respuesta real de insweb. El flujo completo se probó contra una réplica local con el mismo endpoint y el mismo formato (login dibujado por JavaScript, sesión que se pierde al recargar). Para revisar el funcionamiento con una cuenta real:

```bash
npm run probar-insweb
```

Pide tu usuario y contraseña, abre el navegador **visible** para que veas cada paso, y muestra las filas leídas y el resultado de la regla para cada materia. Además guarda en `debug-insweb/`:

- capturas de cada paso,
- `notas-finales.html`, con el HTML de la página,
- `respuestas-json.json`, con lo que insweb devolvió.

Si algo no coincide, con esos archivos se ajusta en minutos:

- Si el login no encuentra los campos, revisá `iniciarSesion()`.
- Si las notas vienen con otros nombres de campo, ajustá `RE_CLAVE_MATERIA` y `RE_CLAVE_NOTA`.
- Si una materia figura con otro nombre en insweb, agregá un alias en `src/materias.js`.

**Borrá `debug-insweb/` al terminar: contiene tus notas.** Si insweb pidiera un captcha, la app lo detecta y avisa. No se intenta saltearlo.

### Seguridad (el jurado va a preguntar)

- Las credenciales de insweb se usan una vez dentro de la petición y se descartan. No se guardan en la base ni se escriben en logs.
- Se limitan los intentos de verificación a 5 cada 15 minutos por usuario, para que la app no sirva para adivinar contraseñas de insweb.
- Se guarda solo un hash del usuario de insweb, para impedir que una misma cuenta de insweb verifique a dos usuarios distintos.
- En producción tiene que correr sobre HTTPS.
- **Limitación honesta:** pedirle a un alumno su contraseña de insweb en un sitio de terceros es un riesgo, y puede chocar con las normas de la facultad. La solución de fondo es que FIUNA exponga una forma oficial de verificar notas (OAuth o API). Conviene presentar el scraping como prueba de concepto de ese flujo.

## 5. Estructura

```
server.js                  API (Express) y archivos estáticos
src/db.js                  conexión a Postgres (Supabase)
src/materias.js            materias de los semestres 1–4 (Civil + Electromecánica)
src/verificador/index.js   regla de la nota 4–5 y comparación de nombres
src/verificador/simulado.js  insweb simulado (data/insweb-simulado.json)
src/verificador/insweb.js    insweb real con Playwright (/login → /main/NotasFinales)
src/semilla.js             datos de demo
public/                    frontend (HTML + JS sin build)
```

### Esquema

```
usuarios(id, nombre, email, pass_hash, carrera, whatsapp?, insweb_id?)
materias(id, nombre, sigla, semestre, alias)  +  materia_carrera(materia_id, carrera)
apuntes(id, usuario_id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo…, busqueda)
votos(apunte_id, usuario_id, valor ±1)                        PK(apunte_id, usuario_id)
postulaciones(id, usuario_id, materia_id, estado, nota 4|5, detalle, disponible)
                                                              UNIQUE(usuario_id, materia_id)
```

Un tutor visible es una postulación con `estado = 'verificado'` y `disponible = 1`. El WhatsApp es opcional: lo carga el tutor al inscribirse y solo lo ven los usuarios con sesión iniciada. Si no lo cargó, se muestra su email.

### API

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/registro`, `/api/login`, `/api/logout` | sesión |
| GET | `/api/materias?carrera=` | catálogo con cantidad de apuntes y tutores |
| GET | `/api/apuntes?q=&materia=&tipo=&anio=&carrera=&orden=votos\|recientes` | buscador |
| POST | `/api/apuntes` (multipart) | subir |
| POST | `/api/apuntes/:id/voto` `{valor: 1\|-1\|0}` | votar |
| GET | `/api/tutores?materia=` | tutores verificados |
| POST | `/api/postulaciones` `{materias:[ids], whatsapp?}` | paso 1: inscripción |
| POST | `/api/postulaciones/verificar` `{usuario, password}` | paso 2: verificación en insweb |
| PATCH | `/api/postulaciones/:id` `{disponible}` | pausar o reactivar como tutor |


## Despliegue en Vercel + Supabase

La app guarda todo fuera del servidor, así que corre en Vercel (serverless):

| Qué | Dónde |
|---|---|
| Base de datos | Postgres de Supabase (`supabase/schema.sql`) |
| Archivos | Supabase Storage, bucket privado `apuntes` (el navegador sube directo con URL firmada) |
| Sesión | Cookie firmada (`SECRETO_SESION`) |
| Límite de intentos de insweb | Tabla `intentos_verificacion` |
| Lectura de insweb | Playwright + `@sparticuz/chromium` (función de hasta 60 s, ver `vercel.json`) |

1. En Supabase: SQL Editor → pegar y ejecutar `supabase/migracion-completa.sql` (o `npm run db:init`).
2. En Vercel → Settings → Environment Variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `SECRETO_SESION` (y `VERIFICADOR`, `DOMINIO_EMAIL` si corresponde).
3. Deploy. Datos de demo opcionales: `npm run db:init -- --demo`.

Local: copiar `.env.example` a `.env`, completar las variables y `npm run dev`. Ya no existe `npm run reset` ni la carpeta `uploads/`.
