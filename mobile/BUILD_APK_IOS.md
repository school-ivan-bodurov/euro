# Build APK (Android) и IPA (iPhone) с EAS Build

Този проект е Expo (managed). Най-лесният и реалистичен начин да изкараш **APK** и **IPA**
е чрез **EAS Build** (cloud build), защото локално ще ти трябват Android SDK/Gradle и (за iOS) Mac + сертификати.

## 0) Инсталирай инструменти
```bash
npm i -g eas-cli
```

## 1) Влез в Expo акаунт
```bash
eas login
```

## 2) Build APK за Android (готов за инсталация)
```bash
cd mobile
eas build --platform android --profile preview
```
- Профилът **preview** е настроен на **APK**.
- След build-а EAS ще ти даде линк за сваляне на .apk.

## 3) Build за iPhone (.ipa)
За iOS ти трябва Apple Developer (или поне Apple ID за подписване през EAS, според режима).
```bash
cd mobile
eas build --platform ios --profile preview
```
- EAS ще те преведе през подписването (certificates/profiles).
- За лесно разпространение: качи в **TestFlight** (submit).

## 4) Важно: пакетни имена
В `mobile/app.json` са сложени примерни:
- Android package: `com.example.bgneurscan`
- iOS bundleIdentifier: `com.example.bgneurscan`

Препоръка: смени `example` с твоето име/организация (напр. `com.ivan.bgneurscan`) **преди** production build.

## 5) Production
Android production по подразбиране генерира **AAB**:
```bash
eas build --platform android --profile production
```

Ако искаш production APK, кажи и ще ти добавя отделен профил за това.
