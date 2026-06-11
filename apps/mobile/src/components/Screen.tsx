import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/theme";

type Props = PropsWithChildren<
  ScrollViewProps & {
    title?: string;
    subtitle?: string;
    scroll?: boolean;
  }
>;

export function Screen({ title, subtitle, scroll = true, children, ...props }: Props) {
  const content = (
    <>
      {title ? (
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </>
  );
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            {...props}
          >
            {content}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.flex]}>{content}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 120, gap: 16 },
  header: { gap: 5, marginBottom: 6 },
  title: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
});
