# Río Limpio

Juego incremental 3D: un río con **1.000.000 kg de basura**. Juntás basura con tu barco, la llevás a la planta de reciclaje, cobrás y mejorás tu equipo hasta dejar el río limpio. A medida que limpiás, **el mundo y la música se curan**: el agua pasa de marrón a turquesa, vuelven los peces, las ranas, los pájaros y las flores, y la música pasa de menor y apagada a mayor y brillante.

- **Motor:** Three.js + TypeScript + Vite (web). Un solo código para PC, celular y tiendas.
- **Audio:** 100% procedural con Web Audio (sin archivos de audio): ambiente, motor, efectos y música generativa que cambia con la limpieza del río.
- **Controles:** teclado (WASD/flechas, `E` mejoras, `R` volver) o táctil (arrastrar en cualquier parte de la pantalla = joystick flotante).
- **Idiomas:** español e inglés (detecta el idioma del dispositivo).
- **Guardado:** automático (localStorage), con ganancias offline de las barreras.
- **Duración:** ~60–90 min para limpiar el río (medido con un bot que juega solo).

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
| `?levels=5` | Todas las mejoras en nivel 5 |
| `?autoplay` | Saltea la pantalla de título |
| `?timescale=20&norender` | Simulación acelerada sin dibujar (tests automáticos) |

## Balance

Toda la economía está en `src/game/config.ts` (costos, curvas, tipos de basura, hitos).
`npm run sim` corre una simulación rápida de la curva de progreso.

## Estructura

```
src/
  main.ts            punto de entrada
  style.css          interfaz (HUD, tienda, menús), responsive + safe areas de iPhone
  game/
    config.ts        economía, tipos de basura, forma del río
    game.ts          lógica principal: barco, ayudantes, recolección, hitos, cámara
    world.ts         cielo, terreno, agua (shader propio), árboles, planta, puente
    trash.ts         basura flotante (instancing, cientos de objetos a bajo costo)
    effects.ts       partículas, peces, pájaros, barreras
    models.ts        modelos 3D low-poly generados por código
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
