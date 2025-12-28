import React, { useEffect, useMemo, useRef, useState } from "react";
import { SafeAreaView, View, Text, TouchableOpacity, TextInput, FlatList, Alert, ActivityIndicator, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system";

const RATE = 1.95583;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function bgnToEur(bgn) {
  return bgn / RATE;
}
function eurToBgn(eur) {
  return eur * RATE;
}

function formatMoney(n) {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(2);
}

function nowISO() {
  return new Date().toISOString();
}

function uuid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

const STORAGE_KEYS = {
  items: "bgn_eur_scan_items_v1",
  serverUrl: "bgn_eur_scan_server_url_v1",
};

function TopTabs({ tab, setTab }) {
  const tabs = [
    { key: "scan", label: "Сканирай" },
    { key: "cart", label: "Сметка" },
    { key: "settings", label: "Настройки" },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 1, borderColor: "#ddd" }}>
      {tabs.map(t => (
        <TouchableOpacity
          key={t.key}
          onPress={() => setTab(t.key)}
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 12,
            alignItems: "center",
            backgroundColor: tab === t.key ? "#111" : "#f2f2f2",
          }}
        >
          <Text style={{ color: tab === t.key ? "#fff" : "#111", fontWeight: "700" }}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function CurrencyToggle({ value, onChange }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {["BGN", "EUR"].map(c => (
        <TouchableOpacity
          key={c}
          onPress={() => onChange(c)}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 12,
            backgroundColor: value === c ? "#111" : "#f2f2f2",
          }}
        >
          <Text style={{ color: value === c ? "#fff" : "#111", fontWeight: "700" }}>{c}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState("scan");
  const [items, setItems] = useState([]);

  const [serverUrl, setServerUrl] = useState("http://localhost:4000");
  const [serverUrlDraft, setServerUrlDraft] = useState("http://localhost:4000");

  // Scan state
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastPhotoUri, setLastPhotoUri] = useState(null);
  const [ocrText, setOcrText] = useState("");
  const [ocrCandidates, setOcrCandidates] = useState([]);
  const [detectedAmount, setDetectedAmount] = useState("");
  const [detectedCurrency, setDetectedCurrency] = useState("BGN");

  const [manualAmount, setManualAmount] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [savedItems, savedUrl] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.items),
          AsyncStorage.getItem(STORAGE_KEYS.serverUrl),
        ]);
        if (savedItems) setItems(JSON.parse(savedItems));
        if (savedUrl) {
          setServerUrl(savedUrl);
          setServerUrlDraft(savedUrl);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.items, JSON.stringify(items)).catch(() => {});
  }, [items]);

  const totals = useMemo(() => {
    let totalBgn = 0;
    let totalEur = 0;
    for (const it of items) {
      if (it.currency === "BGN") {
        totalBgn += it.amount;
        totalEur += bgnToEur(it.amount);
      } else {
        totalEur += it.amount;
        totalBgn += eurToBgn(it.amount);
      }
    }
    return { totalBgn: round2(totalBgn), totalEur: round2(totalEur) };
  }, [items]);

  function addItem(amount, currency, source = "manual", photoUri = null) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) {
      Alert.alert("Грешка", "Невалидна сума.");
      return;
    }
    const item = { id: uuid(), amount: round2(a), currency, createdAt: nowISO(), source, photoUri };
    setItems(prev => [item, ...prev]);
    setManualAmount("");
    setDetectedAmount("");
    setOcrCandidates([]);
    setOcrText("");
    setLastPhotoUri(photoUri);
    setTab("cart");
  }

  function removeItem(id) {
    setItems(prev => prev.filter(x => x.id !== id));
  }

  function clearAll() {
    Alert.alert("Изчистване", "Да изтрия ли всички суми?", [
      { text: "Отказ", style: "cancel" },
      { text: "Изтрий", style: "destructive", onPress: () => setItems([]) },
    ]);
  }

  async function takePhotoAndOcr() {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    if (!cameraRef.current) return;

    setIsProcessing(true);
    setOcrText("");
    setOcrCandidates([]);
    setDetectedAmount("");

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: true });
      setLastPhotoUri(photo.uri);

      const form = new FormData();
      form.append("image", {
        uri: photo.uri,
        name: "price.jpg",
        type: "image/jpeg",
      });

      const url = serverUrl.replace(/\/+$/, "") + "/api/ocr";
      const resp = await fetch(url, { method: "POST", body: form });
      const data = await resp.json();

      if (!resp.ok || !data.ok) {
        throw new Error(data?.error || "OCR failed");
      }

      setOcrText(data.rawText || "");
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      setOcrCandidates(candidates);

      if (data.bestAmount != null) {
        setDetectedAmount(String(data.bestAmount));
      } else {
        Alert.alert("Не намерих цена", "Опитай по-близо/по-ясно, или въведи сумата ръчно.");
      }
    } catch (e) {
      Alert.alert("Грешка", "Не успях да сканирам. Провери дали backend-ът работи и дали URL-ът е правилен.\n\n" + String(e?.message || e));
    } finally {
      setIsProcessing(false);
    }
  }

  async function saveServerUrl() {
    const url = (serverUrlDraft || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      Alert.alert("Грешка", "URL трябва да започва с http:// или https://");
      return;
    }
    setServerUrl(url);
    await AsyncStorage.setItem(STORAGE_KEYS.serverUrl, url).catch(() => {});
    Alert.alert("Запазено", "Server URL е записан.");
  }

  const ScanTab = (
    <View style={{ flex: 1, padding: 12, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "800" }}>Сканиране на цена</Text>
      <Text style={{ color: "#444" }}>
        Снимай етикет/касова бележка → OCR → добави към сметката.
      </Text>

      <View style={{ height: 340, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#ddd" }}>
        {permission?.granted ? (
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 12 }}>
            <Text style={{ textAlign: "center" }}>Нямам достъп до камера. Натисни бутона и разреши.</Text>
            <TouchableOpacity onPress={requestPermission} style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#111" }}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Разреши камера</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <TouchableOpacity
        onPress={takePhotoAndOcr}
        disabled={isProcessing || !permission?.granted}
        style={{ padding: 14, borderRadius: 14, backgroundColor: isProcessing ? "#999" : "#111", alignItems: "center" }}
      >
        {isProcessing ? <ActivityIndicator /> : <Text style={{ color: "#fff", fontWeight: "800" }}>Снимай и извлечи цена</Text>}
      </TouchableOpacity>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: "#f7f7f7", gap: 10 }}>
        <Text style={{ fontWeight: "800" }}>Открита сума</Text>
        <CurrencyToggle value={detectedCurrency} onChange={setDetectedCurrency} />

        <TextInput
          value={detectedAmount}
          onChangeText={setDetectedAmount}
          placeholder="напр. 3.49"
          keyboardType="decimal-pad"
          style={{ padding: 12, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
        />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={() => addItem(detectedAmount, detectedCurrency, "ocr", lastPhotoUri)}
            style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: "#111", alignItems: "center" }}
          >
            <Text style={{ color: "#fff", fontWeight: "800" }}>Добави</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setDetectedAmount("");
              setOcrCandidates([]);
              setOcrText("");
            }}
            style={{ padding: 12, borderRadius: 12, backgroundColor: "#eaeaea", alignItems: "center" }}
          >
            <Text style={{ color: "#111", fontWeight: "800" }}>Изчисти</Text>
          </TouchableOpacity>
        </View>

        {detectedAmount ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: "#333" }}>
              Конверсия:{" "}
              {detectedCurrency === "BGN"
                ? `${formatMoney(Number(detectedAmount) / RATE)} EUR`
                : `${formatMoney(Number(detectedAmount) * RATE)} BGN`}
            </Text>
            <Text style={{ color: "#666" }}>Курс: 1 EUR = {RATE} BGN</Text>
          </View>
        ) : null}

        {ocrCandidates.length ? (
          <View style={{ marginTop: 8, gap: 8 }}>
            <Text style={{ fontWeight: "800" }}>Кандидати (тапни за избор)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {ocrCandidates.map((c, idx) => (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setDetectedAmount(String(c.value))}
                  style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
                >
                  <Text style={{ fontWeight: "700" }}>{formatMoney(Number(c.value))}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {ocrText ? (
          <View style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: "800", marginBottom: 6 }}>OCR текст (за debug)</Text>
            <Text style={{ color: "#444" }} numberOfLines={5}>{ocrText}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: "#f7f7f7", gap: 10 }}>
        <Text style={{ fontWeight: "800" }}>Ръчно добавяне</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <CurrencyToggle value={detectedCurrency} onChange={setDetectedCurrency} />
        </View>

        <TextInput
          value={manualAmount}
          onChangeText={setManualAmount}
          placeholder="напр. 12.00"
          keyboardType="decimal-pad"
          style={{ padding: 12, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
        />

        <TouchableOpacity
          onPress={() => addItem(manualAmount, detectedCurrency, "manual", null)}
          style={{ padding: 12, borderRadius: 12, backgroundColor: "#111", alignItems: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "800" }}>Добави ръчно</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const CartTab = (
    <View style={{ flex: 1, padding: 12, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "800" }}>Сметка (stack)</Text>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: "#111" }}>
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Общо</Text>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "900", marginTop: 4 }}>{formatMoney(totals.totalBgn)} BGN</Text>
        <Text style={{ color: "#fff", opacity: 0.9, fontSize: 18, marginTop: 2 }}>{formatMoney(totals.totalEur)} EUR</Text>
        <Text style={{ color: "#fff", opacity: 0.8, marginTop: 8 }}>Курс: 1 EUR = {RATE} BGN</Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <TouchableOpacity onPress={() => setTab("scan")} style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: "#f2f2f2", alignItems: "center" }}>
          <Text style={{ fontWeight: "800" }}>+ Добави</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={clearAll} style={{ padding: 12, borderRadius: 12, backgroundColor: "#ffe5e5", alignItems: "center" }}>
          <Text style={{ fontWeight: "800", color: "#a40000" }}>Изчисти</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={<Text style={{ color: "#444" }}>Още няма добавени суми.</Text>}
        renderItem={({ item }) => {
          const bgn = item.currency === "BGN" ? item.amount : eurToBgn(item.amount);
          const eur = item.currency === "EUR" ? item.amount : bgnToEur(item.amount);
          return (
            <View style={{ padding: 12, borderRadius: 16, borderWidth: 1, borderColor: "#ddd", backgroundColor: "#fff", marginBottom: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 16, fontWeight: "900" }}>
                  {formatMoney(item.amount)} {item.currency}
                </Text>
                <TouchableOpacity onPress={() => removeItem(item.id)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#f2f2f2" }}>
                  <Text style={{ fontWeight: "800" }}>Премахни</Text>
                </TouchableOpacity>
              </View>

              <Text style={{ marginTop: 6, color: "#333" }}>
                ↳ {formatMoney(round2(bgn))} BGN · {formatMoney(round2(eur))} EUR
              </Text>
              <Text style={{ marginTop: 4, color: "#777" }}>
                Източник: {item.source === "ocr" ? "снимка (OCR)" : "ръчно"} · {new Date(item.createdAt).toLocaleString()}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );

  const SettingsTab = (
    <View style={{ flex: 1, padding: 12, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "800" }}>Настройки</Text>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: "#f7f7f7", gap: 10 }}>
        <Text style={{ fontWeight: "800" }}>Backend URL</Text>
        <Text style={{ color: "#444" }}>
          Ако си на истински телефон, <Text style={{ fontWeight: "800" }}>НЕ</Text> ползвай localhost. Сложи IP адреса на компютъра в същата Wi‑Fi мрежа, напр. http://192.168.1.20:4000
        </Text>

        <TextInput
          value={serverUrlDraft}
          onChangeText={setServerUrlDraft}
          placeholder="http://192.168.x.x:4000"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ padding: 12, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd" }}
        />

        <TouchableOpacity onPress={saveServerUrl} style={{ padding: 12, borderRadius: 12, backgroundColor: "#111", alignItems: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "800" }}>Запази</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={async () => {
            try {
              const url = serverUrl.replace(/\/+$/, "") + "/api/health";
              const resp = await fetch(url);
              const data = await resp.json();
              Alert.alert("Тест", resp.ok ? `OK ✅\nКурс: ${data.rate}` : "Неуспешно ❌");
            } catch (e) {
              Alert.alert("Тест", "Неуспешно ❌\n" + String(e?.message || e));
            }
          }}
          style={{ padding: 12, borderRadius: 12, backgroundColor: "#f2f2f2", alignItems: "center" }}
        >
          <Text style={{ fontWeight: "800" }}>Тествай връзка</Text>
        </TouchableOpacity>
      </View>

      <View style={{ padding: 12, borderRadius: 16, backgroundColor: "#f7f7f7", gap: 8 }}>
        <Text style={{ fontWeight: "800" }}>Курс</Text>
        <Text style={{ color: "#444" }}>
          Това приложение използва фиксиран курс: <Text style={{ fontWeight: "900" }}>1 EUR = {RATE} BGN</Text>
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar style="auto" />
      <TopTabs tab={tab} setTab={setTab} />
      {tab === "scan" ? ScanTab : tab === "cart" ? CartTab : SettingsTab}
    </SafeAreaView>
  );
}
