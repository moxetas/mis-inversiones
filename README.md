# Moxetas Invest

App para **apuntar todas tus inversiones** y ver cuánto ganas o pierdes. Se instala en el iPhone desde Safari, sin pasar por la App Store, y funciona sin conexión.

Tus datos se guardan **solo en tu teléfono**: no se suben a ningún sitio.

## Qué hace

| Apartado | Qué permite |
| --- | --- |
| Resumen | Valor total de la cartera, ganancia o pérdida en euros y en %, dinero aportado y retirado, dividendos cobrados, reparto por tipo y por plataforma. |
| Inversiones | Lista de inversiones con su valor y rentabilidad (también por bróker o billetera). Cada inversión nueva se busca sola en TradingView (por ISIN, ticker o nombre) para tener su precio y su logo. Al tocar una se ven participaciones, precio medio de compra, ganancia sin vender y ya vendida, y sus movimientos. |
| Movimientos | Gráfica de la evolución del patrimonio (valor frente a dinero puesto), todas las compras, ventas y dividendos por meses, con totales por año, e **importar el extracto del bróker** (PDF o CSV): la app apunta sola las compras, ventas, dividendos y recompras, sin repetir las que ya estaban. |
| Noticias | Noticias gratuitas en español (de Google Noticias, sin webs de pago): de la bolsa, de cripto y de cada uno de tus activos (la app los reconoce solos entre unos 90 activos habituales: Ibex 35, grandes de EE. UU. y Europa, cripto, oro, plata e índices). Una tarea de GitHub Actions (`.github/workflows/noticias.yml`, que ejecuta `scripts/noticias.py`) las descarga cada hora en la rama `noticias`. |
| Ajustes | Moneda, copia de seguridad (guardar y recuperar), exportar a Excel (CSV) y borrar todo. |

- Cada inversión se apunta de una de dos formas: **por participaciones** (acciones, ETF, fondos, cripto, planes de pensiones: cantidad × precio) o **solo por importe** (depósitos, cuentas, inmuebles: euros aportados y valor actual).
- Los precios se actualizan a mano con **Actualizar precio**. Al apuntar una compra o venta, su precio pasa a ser el precio actual. El resumen avisa si hay precios sin actualizar desde hace más de 30 días.
- La ganancia total es: valor actual + dinero retirado + dividendos − dinero aportado (las comisiones cuentan). El precio medio usa el método de coste medio.
- Conviene hacer una **copia de seguridad** de vez en cuando desde Ajustes, por si cambias de móvil o borras Safari.
- Para probarla sin apuntar nada, en la pantalla inicial está **Probar con datos de ejemplo**.
- La primera vez se abre la guía **Cómo funciona** (`#/guia`), que se reabre desde Ajustes. La guía para compartir está en [`guia.pdf`](guia.pdf).
- **Desde una captura o foto, con tu IA** (en Importar): la app copia unas instrucciones, la persona adjunta la captura o el PDF en su propia app de IA (ChatGPT, Claude, Gemini…) y pega aquí la respuesta (JSON de movimientos, o una tabla/CSV). Pasa por la misma pantalla de revisión que los extractos. La app no envía nada a ningún sitio.

## Instalarla en el iPhone

La app se publica con GitHub Pages. Solo hay que activarlo una vez:

1. En GitHub, abre el repositorio y ve a **Settings → Pages**.
2. En **Build and deployment → Source**, elige **Deploy from a branch**.
3. En **Branch**, elige **main** y la carpeta **/ (root)**. Pulsa **Save**.
4. Al cabo de uno o dos minutos, la app estará en `https://moxetas.github.io/mis-inversiones/`.

Después, en el iPhone:

1. Abre esa dirección en **Safari**.
2. Toca el botón **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elige **Añadir a pantalla de inicio** y toca **Añadir**.

Cada vez que se suben cambios, la app se actualiza sola la próxima vez que la abres con conexión.

## Cómo está hecha

Es una web normal (HTML, CSS y JavaScript) sin librerías ni servidor:

| Archivo | Contenido |
| --- | --- |
| `index.html` | Estructura de la app. |
| `styles.css` | Diseño, con modo claro y oscuro. |
| `app.js` | Pantallas, cálculos y datos guardados en el teléfono. |
| `importar.js` | Lee los extractos de los brókeres (PDF con pdf.js, o CSV) y los convierte en movimientos. |
| `guia.js` | Guía de primeros pasos y «Desde una captura o foto, con tu IA». |
| `vendor/pdfjs/` | pdf.js de Mozilla (licencia Apache-2.0), para leer los PDF dentro del teléfono. |
| `sw.js` | Guarda la app en el teléfono para que abra sin cobertura. |
| `manifest.webmanifest`, `icons/` | Nombre e icono al instalarla. |

Para probarla en un ordenador basta con servir la carpeta, por ejemplo con `python3 -m http.server`, y abrir `http://localhost:8000`.

## Grupo (ranking y retos con amigos)

La pestaña **Grupo** permite crear un grupo o unirse con un código (`MX-XXXXXX`) y ver un ranking por rentabilidad
en %, en tiempo real. Solo se envía el apodo y la rentabilidad total (y los euros si cada uno lo activa); las
inversiones nunca salen del teléfono. Funciona con Supabase (cuenta anónima, sin registro).
Las tablas y reglas de seguridad están en `supabase/esquema.sql`. La librería `vendor/supabase/supabase.js` es
@supabase/supabase-js 2.118.0 (licencia MIT, ver `vendor/supabase/LICENSE`).

### Retos

Dentro del grupo, la pestaña **Retos** permite crear un reto con fecha de inicio y duración. Hasta que empieza, cada uno
elige de 1 a 10 activos (buscados en TradingView o de su cartera) y nadie ve los de los demás. Gana la mayor subida
media en %. Los precios de inicio y final los guarda el servidor cada minuto con pg_cron + pg_net (`supabase/retos.sql`).

## Seguimiento, carteras de los hijos y noticias de cualquier activo

- **Seguimiento**: activos en el punto de mira (sin comprarlos), con logo, precio en directo, gráfico y noticias.
- **Hijos**: en Inversiones, «＋ Hijo» crea una cartera aparte; sus inversiones no se suman a las tuyas
  (ni al Resumen, ni a la gráfica, ni al ranking del grupo). En el Resumen salen en una tarjeta aparte.
- **Noticias de activos fuera de la lista fija**: la app apunta su nombre y símbolo en Supabase
  (`supabase/noticias.sql`) y la tarea de noticias los busca también cada hora.
- La gráfica de Movimientos empieza el 1 de enero de 2027.
- Ajustes está en la rueda de arriba a la izquierda.
