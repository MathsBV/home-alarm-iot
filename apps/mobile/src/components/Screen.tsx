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
  content: { padding: 18, paddingBottom: 120, gap: 14 },
  header: { gap: 3, marginBottom: 4 },
  title: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: "900", letterSpacing: -0.3 },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
});
