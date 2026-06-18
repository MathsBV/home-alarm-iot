import type { CommandType } from "@home-alarm/contracts";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { parseVoiceCommand } from "@/lib/voice";
import { colors, radius } from "@/theme";

type Props = {
  onCommand: (command: { type: CommandType; value?: number | string; label: string }) => void;
};

export function VoiceCommandButton({ onCommand }: Props) {
  const [listening, setListening] = useState(false);

  const startListening = async () => {
    try {
      const speech = await import("expo-speech-recognition");
      const permission = await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microfone indisponível", "Permita o acesso ao microfone nas configurações.");
        return;
      }
      setListening(true);
      const resultSubscription = speech.ExpoSpeechRecognitionModule.addListener(
        "result",
        (event: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
          const transcript = event.results?.[0]?.transcript ?? "";
          if (!event.isFinal) return;
          const command = parseVoiceCommand(transcript);
          setListening(false);
          speech.ExpoSpeechRecognitionModule.stop();
          resultSubscription.remove();
          errorSubscription.remove();
          if (command) onCommand(command);
          else Alert.alert("Comando não reconhecido", `Você disse: "${transcript}".`);
        },
      );
      const errorSubscription = speech.ExpoSpeechRecognitionModule.addListener(
        "error",
        () => {
          setListening(false);
          resultSubscription.remove();
          errorSubscription.remove();
        },
      );
      speech.ExpoSpeechRecognitionModule.start({
        lang: "pt-BR",
        interimResults: true,
        continuous: false,
      });
    } catch {
      setListening(false);
      Alert.alert(
        "Recurso disponível no Development Build",
        "O reconhecimento de voz exige o aplicativo compilado com EAS, não o Expo Go.",
      );
    }
  };

  return (
    <Pressable
      onPress={startListening}
      style={({ pressed }) => [styles.btn, listening && styles.btnActive, pressed && styles.pressed]}
    >
      <Ionicons
        name={listening ? "mic" : "mic-outline"}
        size={19}
        color={listening ? colors.warning : colors.textMuted}
      />
      <Text style={[styles.label, listening && styles.labelActive]}>
        {listening ? "Ouvindo..." : "Voz"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnActive: { borderColor: `${colors.warning}60` },
  label: { color: colors.textMuted, fontWeight: "700", fontSize: 13, letterSpacing: 0.3 },
  labelActive: { color: colors.warning },
  pressed: { opacity: 0.68 },
});
