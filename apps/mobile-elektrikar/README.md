# ROVA Elektrikár — Android appka (Capacitor)

Android obal nad elektrikárskym modulom ROVA (plán/výkres, okruhy, **AR režim**,
materiál, report). Postavený rovnako ako `mobile/` (ROVA Maliar) — cez Capacitor.

## Ako to funguje

- Zdrojový kód modulu žije v monorepe: `packages/modules/src/elektrikar/` (build cez `@rova/modules`).
- `sync-assets.js` skopíruje build do `www/` (spolu s `index.html` a `theme.css`).
- Capacitor zabalí `www/` do natívneho Android projektu v `android/`.
- `androidScheme: https` => secure context => v **AR režime funguje kamera**
  (`getUserMedia`) aj `localStorage` (offline projekty).
- Kamera: v manifeste je `android.permission.CAMERA`; Capacitor si o povolenie
  vypýta pri prvom spustení AR.
- Import výkresu/fotky (`<input type=file>`) rieši Capacitor automaticky.
- PDF import používa `pdf.js` z CDN (potrebný internet).

## Požiadavky

- Node.js (na sync + Capacitor CLI), Android Studio (JDK 17+ je súčasťou).
- `minSdk`/`targetSdk` podľa Capacitor 6 (compileSdk 34).
- Pre **3D AR**: zariadenie s ARCore (Google Play Services for AR).

## Workflow

```bash
cd apps/mobile-elektrikar
npm install                 # raz
npm run prepare:android     # sync assetov + cap sync
npm run open:android        # otvorí projekt v Android Studio  -> Run
```

Build APK z príkazového riadka:

```bash
npm run build:android
# ekvivalent: npm run prepare:android && cd android && gradlew.bat assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

> Po každej zmene modulu v `packages/modules` spusti z koreňa repa
> `npm run build -w @rova/modules`, potom `npm run prepare:android`,
> aby sa zmeny dostali do appky.

## AR test checklist — 2D vs 3D

Použi rovnaký testovací projekt (aspoň 2 miestnosti, pár prvkov, okruhy v rozvádzači).

### Príprava (oba režimy)

- [ ] `npm run prepare:android` a nainštalovaný debug APK
- [ ] Povolená kamera pri prvom spustení AR
- [ ] Načítaný projekt s plánom a kalibrovanou mierkou
- [ ] Endpoint reportu nastavený (napr. dev server `/api/electrician/report`)

### 2D AR (predvolené — funguje aj v prehliadači)

- [ ] Prepínač AR režimu: **2D**
- [ ] Kamera sa spustí, plán je viditeľný cez video
- [ ] Posun / mierka / rotácia / priehľadnosť reagujú
- [ ] Subrežim **Bod na stene**: výber prvku, zobrazenie výšky na rail
- [ ] Manuálne meranie výšky (ťuk na podlahu → stred prvku) uloží `measuredZ`
- [ ] Subrežim **Vrtací plán**: fázy drážky / prierazy / chráničky / kábel
- [ ] Audit → Kontrola: stav prvku, foto, export tlače

### 3D AR (Android + ARCore)

- [ ] Prepínač AR režimu: **3D** (len na podporovanom zariadení)
- [ ] Ak ARCore chýba, zobrazí sa zrozumiteľná chyba (fallback na 2D)
- [ ] Kalibrácia 3D plánu (2 body) — po ukončení sa uloží `ar3dCalib`
- [ ] Plán v 3D sedí s 2D režimom (porovnanie v tej istej miestnosti)
- [ ] Po audite report obsahuje `audit.ar3dCalib` meta (scale, at, calibrated)

### Odoslanie reportu

- [ ] Záložka Report → Odoslať do webu
- [ ] Server vráti `{ ok: true, auditSummary: { ... } }`
- [ ] V DB / `field_reports` je payload s `audit.rooms`, `audit.elements`, `audit.panel`

## Stav

- ✅ Debug APK sa úspešne builduje (overené).
- AR režim **2D** = prekrytie plánu cez živú kameru s manuálnym ukotvením
  (posun / mierka / rotácia / priehľadnosť).
- AR režim **3D** = ARCore kalibrácia a stabilizácia (vyžaduje Android appku).
