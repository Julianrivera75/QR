# Plataforma Web de Carnetización y Validación QR

Esta es una aplicación web segura diseñada para administrar una base de datos de vendedores informales, generar carnés digitales en formato PDF vertical (escarapela) listos para impresión y validar la autenticidad de los mismos en tiempo real mediante códigos QR.

---

## Características Principales

1. **Panel Administrativo (SPA)**:
   - Diseño moderno con estética **Glassmorphism**, fondos translúcidos y animaciones.
   - Gráficos estadísticos dinámicos (distribución por actividad y escaneos de los últimos 7 días).
   - CRUD completo de beneficiarios con carga de fotografías.
   - Filtros avanzados (documento, HEMI, RIVI, actividad económica, ofertas de IPES, días de ubicación, etc.).
   - Historial de Auditoría: Visualización en tiempo real de cambios de registros mostrando qué administrador modificó qué campos (valores anteriores y nuevos).
   - Importación Masiva: Procesador de archivos Excel y CSV que autovalida registros, reporta errores estructurales de fila por fila e inserta registros de forma ágil.
   - Descarga Masiva: Generación individual y masiva en formato ZIP comprimido de carnés PDF listos para imprimir.
2. **Generación de Carnés Verticales**:
   - Diseño tipo escarapela (54x85.6mm) dibujado en servidor con `pdf-lib`.
   - Incorpora foto del vendedor (con avatar vectorizado de contingencia), datos de identificación y un código QR encriptado único (UUIDv4).
   - Franja inferior dinámica que indica visualmente si el carné está **Activo** (verde), **Inactivo** (amarillo) o **Revocado** (rojo).
3. **Portal Público de Validación**:
   - Enlace cifrado libre de autenticación para que inspectores verifiquen credenciales.
   - Enmascara el número de documento del vendedor y omite datos sensibles (teléfono, discapacidad, edad, etc.) para salvaguardar la privacidad.
   - Registra de forma automática eventos de consulta en una tabla de auditoría (`scan_logs`) guardando la IP, el dispositivo y el estado al momento de escaneo.

---

## Estructura del Proyecto

```text
├── database/            # Carpeta para base de datos SQLite (.db)
├── public/              # Archivos estáticos del Frontend
│   ├── css/             # Estilos de diseño (styles.css)
│   ├── js/              # Controladores JavaScript (admin.js, validate.js)
│   ├── index.html       # Interfaz del Dashboard & Login Administrativo (SPA)
│   └── validate.html    # Interfaz móvil pública de validación QR
├── server/              # Código del Backend (Node.js)
│   ├── middleware/      # Middlewares de seguridad (auth.js)
│   ├── routes/          # API REST Enrutadores (auth, beneficiaries, pdf, audit, public)
│   └── db.js            # Conexión, creación de tablas y sembrado de SQLite
├── uploads/             # Directorio para archivos cargados
│   ├── imports/         # Temporales de importación masiva
│   └── photos/          # Fotografías de los beneficiarios
├── package.json         # Dependencias npm y scripts
├── server.js            # Punto de entrada de la aplicación
└── README.md            # Documentación del proyecto
```

---

## Requisitos Previos

- **Node.js** (versión 18.0.0 o superior)
- **NPM** (incluido con Node.js)

---

## Instrucciones de Instalación

1. Descarga o clona el proyecto en tu máquina.
2. Abre una terminal en la carpeta raíz del proyecto y ejecuta el comando de instalación de paquetes:
   ```bash
   npm install
   ```
3. Ejecuta la aplicación en modo producción o desarrollo:
   - **Producción**:
     ```bash
     npm start
     ```
   - **Desarrollo** (con autorecarga automática al modificar archivos):
     ```bash
     npm run dev
     ```
4. Abre tu navegador e ingresa a:
   - Módulo Administrativo: [http://localhost:3000](http://localhost:3000)

---

## Variables de Entorno

| Variable | Descripción |
|----------|-------------|
| `ADMIN_PASSWORD` | Contraseña del usuario `admin` (mínimo 12 caracteres). Se aplica en cada arranque, lo que permite rotarla. Si no se define en el primer arranque, se genera una contraseña temporal que se muestra una sola vez en los logs. |
| `JWT_SECRET` | Secreto de firma de sesiones (mínimo 32 caracteres). Sin él se usa un secreto temporal y las sesiones se cierran al reiniciar. |
| `BASE_URL` | URL pública de la plataforma (ej. `https://carnets.dominio.gov.co`). Fija el dominio usado en los QR, correos y certificados. |
| `DATABASE_URL` | Cadena de conexión PostgreSQL. Sin ella se usa SQLite local. |
| `CONFIRM_LINK_TTL_DAYS` | Días de vigencia del enlace de descarga enviado por correo (por defecto 30). |
| `NODE_ENV` | `production` activa cookies seguras, HTTPS obligatorio y oculta detalles de errores. |
| `SENDGRID_API_KEY`, `SENDGRID_FROM` | Envío de correos por SendGrid. |

## Seguridad

- Contraseñas con bcrypt y sesión JWT en cookie `httpOnly`, `SameSite=strict` y `Secure` en producción.
- Límite de intentos de inicio de sesión (10 cada 15 minutos por IP) y de consultas públicas (120 por minuto por IP).
- Cabeceras de seguridad con Helmet: CSP, HSTS, `X-Frame-Options`, `nosniff`.
- Consultas SQL parametrizadas y escape de todo dato dinámico en el panel administrativo.
- Las fotografías no se exponen como archivos estáticos; se sirven solo a través de `/api/public/photo/:uuid`.
- El portal público enmascara el documento y omite teléfono, correo, edad, género, grupo poblacional, discapacidad y ubicación.

---

## Modelo de Datos de Beneficiarios

Por cada registro se almacena la siguiente información:
- **Datos Estructurados**: Nombre completo, Tipo de documento (CC, CE, PEP, PPT, Pasaporte), Número de documento de identidad, Registro en HEMI (Sí/No), RIVI, Estado (Activo/Inactivo/Revocado), Edad, Género (Masculino/Femenino/Otro), Grupo Poblacional, Presenta discapacidad (Sí/No), Teléfono, Coordenadas (Latitud/Longitud), Tipo de actividad económica, Beneficiario oferta IPES (Sí/No), Tipo de oferta, Días de ubicación por semana, Tiempo de permanencia.
- **Datos No Estructurados**: Foto (ruta del archivo JPG/PNG), Código QR único (Token UUIDv4 autogenerado).

---

## Sincronizar con una base oficial (Excel)

`scripts/sync_base.js` reemplaza el contenido de `beneficiaries` por el de un Excel oficial sin cambiar el QR de quien sigue en la base:

- Empareja por número de documento (también si Excel quitó ceros a la izquierda o espacios).
- Actualiza los datos de los registros existentes (foto y correo solo si el Excel los trae), inserta los nuevos y elimina los que ya no están.
- Los documentos "No tiene" repetidos reciben un identificador provisional `SD-<fila>`.

```bash
DATABASE_URL=... node scripts/sync_base.js base.xlsx --details   # simulación
DATABASE_URL=... node scripts/sync_base.js base.xlsx --apply     # aplica en una transacción
```

En Railway la base solo tiene dirección interna: se ejecuta dentro del contenedor con `railway ssh --service QR` (el Excel no se sube al repositorio).

## Envío manual de carnés desde el buzón institucional

Cuando el buzón institucional no permite envío automático (SMTP/Graph), use la pestaña
**Envío por Outlook** del panel:

1. **Redactar** abre el correo web (Outlook institucional, Outlook.com o Gmail) con el
   destinatario, el asunto y el texto listos, que incluye el enlace personal de descarga.
2. El operador revisa y envía desde su correo.
3. **Marcar enviado** registra la fecha y el operador (`email_logs.smtp_message_id = manual:<usuario>`)
   y deja constancia en `audit_logs` (`EMAIL_MANUAL_SENT`).
4. Cuando el vendedor abre su enlace, el estado pasa a **Descargado** y se habilita el
   certificado de descarga.

Los borradores sin confirmar quedan con estado `prepared` y no aparecen en el historial ni
generan certificados. La lista filtrada (pendientes, enviados, descargados, sin correo) se
puede exportar a CSV.
