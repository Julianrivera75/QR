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

## Credenciales por Defecto

El sistema se inicializa automáticamente con la siguiente cuenta de administrador en la base de datos:
- **Usuario**: `admin`
- **Contraseña**: `admin123`

*(Puedes cambiar la contraseña o agregar nuevos administradores registrándolos en la base de datos SQLite).*

---

## Modelo de Datos de Beneficiarios

Por cada registro se almacena la siguiente información:
- **Datos Estructurados**: Nombre completo, Tipo de documento (CC, CE, PEP, PPT, Pasaporte), Número de documento de identidad, Registro en HEMI (Sí/No), RIVI, Estado (Activo/Inactivo/Revocado), Edad, Género (Masculino/Femenino/Otro), Grupo Poblacional, Presenta discapacidad (Sí/No), Teléfono, Coordenadas (Latitud/Longitud), Tipo de actividad económica, Beneficiario oferta IPES (Sí/No), Tipo de oferta, Días de ubicación por semana, Tiempo de permanencia.
- **Datos No Estructurados**: Foto (ruta del archivo JPG/PNG), Código QR único (Token UUIDv4 autogenerado).
