# Río Limpio

Juego incremental 3D: un río con **1.000.000 kg de basura**, formada por **4.274 objetos reales, todos visibles desde el inicio** (latas, bolsas, botellas, neumáticos, tambores, heladeras, autos, contenedores y 4 barcos hundidos). Nada aparece ni desaparece solo: si quedan 3 contenedores, ves 3 contenedores. Tocando el panel de progreso se ve el desglose de lo que queda.

Arrancás **juntando a mano desde un bote a remo**. Cumpliendo objetivos te dan herramientas y vehículos nuevos, y cada uno se mejora con plata:

| Objetivo | Premio |
|---|---|
| Juntá 25 objetos | 🕸️ Red de pesca |
| Sacá 400 kg | 🚤 Lancha a motor |
| Juntá 600 objetos | 🏗️ Grúa (neumáticos) |
| Sacá 30 neumáticos | 🧲 Imán gigante + grúa para tambores |
| Juntá 1.200 objetos | 🎁 Hélice turbo (+2 niveles de motor) |
| Sacá 20.000 kg | 🚤 Flota de lanchas ayudantes |
| Sacá 70 tambores | 🌀 Aspiradora + grúa para heladeras |
| Sacá 45 heladeras | 🛸 Drones + grúa para autos |
| Sacá 30 autos | 🛳️ Barcaza industrial + grúa para contenedores |
| Sacá los 40 contenedores | Grúa para barcos hundidos |
| Limpiá todo el río | Final |

La grúa **sube con objetivos, no con plata**: así es imposible quedar trabado sin poder avanzar. El imán y la aspiradora atraen la basura hacia el bote (se la ve moverse) y la grúa iza lo pesado de a poco con el bote anclado.

- **Gráficos:** cielo con dispersión atmosférica (Preetham), iluminación por entorno (PBR), agua con reflejos planos reales, nubes procedurales, pasto animado, sombras suaves, bloom. Tres niveles de calidad (Ajustes → Gráficos).
- **Audio:** 100% procedural con Web Audio: ambiente, remadas o motor según el vehículo, efectos por material, imán, fanfarria de desbloqueo y música generativa que pasa de menor a mayor a medida que se limpia el río.
- **Controles:** teclado (WASD/flechas, `E` mejoras, `R` volver) o táctil (arrastrar en cualquier parte = joystick flotante).
- **Idiomas:** español e inglés. **Guardado** automático (qué objetos juntaste, herramientas, vehículo, objetivo).
- **Duración:** un bot que juega solo termina en ~44 min; una persona, estimado 60–80 min.

## Cómo ejecutarlo

Requisitos: Node.js 18 o superior.

```bash
cd rio-limpio
npm install
npm run dev        # abre http://localhost:5173 (también accesible desde el celular en la misma red Wi-Fi)
```

Build de producción:

```bash
npm run build      # genera dist/ (sitio estático listo para subir)
npm run preview    # sirve dist/ en http://localhost:4173
```

Para probarlo en el celular: con `npm run dev` corriendo, abrí en el celular la dirección `Network:` que muestra la terminal (ej. `http://192.168.0.10:5173`).

## Parámetros de prueba (URL)

| Parámetro | Efecto |
|---|---|
| `?clean=0.6` | Arranca con el río 60% limpio (para ver estados visuales) |
| `?money=100000` | Arranca con plata |
| `?levels=5` | Todas las mejoras desbloqueadas en nivel 5 |
| `?vehicle=lancha` | Arranca con ese vehículo (`remo`, `lancha`, `barcaza`) |
| `?obj=4` | Salta al objetivo N |
| `?quality=0` | Fuerza calidad gráfica (0 baja, 1 media, 2 alta) |
| `?autoplay` | Saltea la pantalla de título |
| `?timescale=20&norender` | Simulación acelerada sin dibujar (tests automáticos) |

## Balance

Toda la economía está en `src/game/config.ts` (inventario de basura, costos, curvas, objetivos y tiempos de izado de la grúa). El balance se midió con un bot que juega la partida real acelerada (`?timescale=40&norender`).

## Estructura

```
src/
  main.ts            punto de entrada
  style.css          interfaz (HUD, tienda, menús), responsive + safe areas de iPhone
  game/
    config.ts        economía, tipos de basura, forma del río
    game.ts          lógica principal: barco, ayudantes, recolección, hitos, cámara
    world.ts         cielo, terreno, agua (shader propio), árboles, planta, puente
    trash.ts         inventario fijo de basura (instancing + grilla espacial + vaivén en GPU)
    effects.ts       partículas, peces, pájaros
    models.ts        modelos 3D generados por código: basura, bote a remo, lancha, barcaza, drones
    audio.ts         motor de audio procedural + música generativa
    ui.ts            HUD, tienda, modales, textos flotantes
    input.ts         teclado + joystick táctil
    i18n.ts          textos ES/EN
    save.ts          guardado
```

## Publicar

### Web (gratis, para testear con gente)
Subí la carpeta `dist/` a **itch.io** (proyecto HTML, gratis) o a Vercel/Netlify/GitHub Pages. Es la forma más barata de validar si engancha antes de pagar tiendas.

### Android (Google Play) e iOS (App Store) con Capacitor
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "Río Limpio" com.tuempresa.riolimpio --web-dir dist
npm run build
npx cap add android && npx cap add ios
npx cap sync
npx cap open android   # Android Studio → generar AAB firmado
npx cap open ios       # Xcode (requiere Mac) → Archive → App Store Connect
```
Costos de las tiendas: Google Play USD 25 (pago único), Apple USD 99 por año.

### Steam (PC) con Electron
Envolver `dist/` con Electron (o Tauri, más liviano) y subir el build con Steamworks. Steam cobra USD 100 por juego (Steam Direct, recuperable después de USD 1.000 en ventas).

## Pendiente antes de una tienda

- Arte de tienda: ícono final, capturas, tráiler.
- Testear rendimiento en celulares de gama baja reales (en PC con GPU va fluido; la calidad baja se activa sola en táctiles).
- Política de privacidad (las tiendas la exigen aunque el juego no recolecte datos).
