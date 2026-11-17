# El Penthouse

Juego de ordenar en primera persona (PC y celular). Ordenás 3.000 objetos en el penthouse de Cristian Rolando mientras una tormenta, cortes de luz y llamadas raras arman un misterio.

- **Zonas:** Living → Bar & Casino → Vestidor + Zapatillas (arriba) → Sala de Juegos → Terraza → habitación secreta.
- **Mejoras (tablet, T):** manos, velocidad, agarre rápido, imán, escáner, robots ayudantes, combo.
- **Actividades:** DJ, barra de tragos (efectos temporales), ruleta, blackjack, tragamonedas (plata del juego), arcade, básquet en la terraza.
- **Misterio:** 3 fichas doradas (arcade, básquet, caja fuerte) abren el cuadro del living.

## Correr
```
npm install
npm run dev        # desarrollo
npx vite build     # build en dist/
```
Parámetros de prueba: `?fresh` (partida nueva), `?low` / `?high` (calidad), `?bot&timescale=80&norender` (bot que juega solo y mide el ritmo).

Controles PC: WASD, mouse, clic agarrar/dejar, Q o rueda cambiar objeto, E usar, T tablet, Shift correr.
Celular: joystick a la izquierda, arrastrar a la derecha para mirar, ✋ agarrar/dejar, USAR.

Todo es procedural (Three.js + Web Audio): sin imágenes ni audios externos.
