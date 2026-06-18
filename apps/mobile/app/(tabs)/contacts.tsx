import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { api, type Contact } from "@/lib/api";
import { colors, radius } from "@/theme";

export default function ContactsScreen() {
  const { homeId, getToken } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channels, setChannels] = useState({ push: false, email: true, sms: true, whatsapp: false });

  const load = useCallback(async () => {
    if (!homeId) return;
    try {
      setContacts(await api.contacts(homeId, await getToken()));
    } catch (error) {
      Alert.alert("Contatos indisponíveis", error instanceof Error ? error.message : "Tente novamente.");
    }
  }, [getToken, homeId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const save = async () => {
    if (!homeId) return;
    try {
      await api.saveContact(homeId, await getToken(), { name, email, phone, channels });
      setName(""); setEmail(""); setPhone(""); setShowForm(false);
      await load();
    } catch (error) {
      Alert.alert("Contato não salvo", error instanceof Error ? error.message : "Tente novamente.");
    }
  };

  const remove = (contact: Contact) => {
    Alert.alert("Excluir contato", `Remover ${contact.name} dos alertas?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          if (!homeId) return;
          await api.deleteContact(homeId, await getToken(), contact.id);
          await load();
        },
      },
    ]);
  };

  return (
    <Screen title="Contatos" subtitle="Pessoas que recebem alertas da residência.">
      <Button
        title={showForm ? "Cancelar" : "Adicionar contato"}
        variant={showForm ? "secondary" : "primary"}
        onPress={() => setShowForm(!showForm)}
      />

      {showForm ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>NOVO CONTATO</Text>
          <Field label="Nome" value={name} onChangeText={setName} placeholder="Nome do contato" />
          <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="contato@email.com" />
          <Field label="Telefone com DDI" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+5511999999999" />
          <View style={styles.channels}>
            <ChannelToggle label="Push" value={channels.push} onChange={(v) => setChannels({ ...channels, push: v })} />
            <ChannelToggle label="E-mail" value={channels.email} onChange={(v) => setChannels({ ...channels, email: v })} />
            <ChannelToggle label="SMS" value={channels.sms} onChange={(v) => setChannels({ ...channels, sms: v })} />
            <ChannelToggle label="WhatsApp" value={channels.whatsapp} onChange={(v) => setChannels({ ...channels, whatsapp: v })} />
          </View>
          <Button title="Salvar contato" onPress={save} disabled={!name || (!email && !phone)} />
        </View>
      ) : null}

      {!contacts.length && !showForm ? (
        <Text style={styles.empty}>Nenhum destinatário cadastrado.</Text>
      ) : null}

      {contacts.length > 0 ? (
        <View style={styles.contactList}>
          {contacts.map((contact, index) => (
            <View
              key={contact.id}
              style={[styles.contactRow, index < contacts.length - 1 && styles.contactRowSep]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{contact.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactDetail}>{contact.email || contact.phone}</Text>
                <View style={styles.channelTags}>
                  {Object.entries(contact.channels)
                    .filter(([, enabled]) => enabled)
                    .map(([ch]) => (
                      <View key={ch} style={styles.channelTag}>
                        <Text style={styles.channelTagText}>{ch.toUpperCase()}</Text>
                      </View>
                    ))}
                </View>
              </View>
              <Pressable onPress={() => remove(contact)} hitSlop={10} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={17} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function ChannelToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.channelRow}>
      <Text style={styles.channelLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primaryDark, false: colors.border }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    backgroundColor: colors.surface,
    borderRadius: radius.large,
    padding: 16,
    gap: 13,
  },
  formTitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  channels: { gap: 0, backgroundColor: colors.surfaceElevated, borderRadius: radius.medium, overflow: "hidden" },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  channelLabel: { color: colors.text, fontWeight: "700", fontSize: 14 },

  empty: { color: colors.textMuted, textAlign: "center", paddingVertical: 40, fontSize: 13 },

  contactList: { backgroundColor: colors.surface, borderRadius: radius.medium, overflow: "hidden" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  contactRowSep: { borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryDark,
  },
  avatarText: { color: colors.white, fontWeight: "900", fontSize: 17 },
  contactInfo: { flex: 1, gap: 3 },
  contactName: { color: colors.text, fontWeight: "700", fontSize: 14 },
  contactDetail: { color: colors.textMuted, fontSize: 12 },
  channelTags: { flexDirection: "row", gap: 5, marginTop: 4 },
  channelTag: {
    backgroundColor: colors.successSurface,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  channelTagText: { color: colors.primary, fontSize: 9, fontWeight: "800" },
  deleteBtn: { padding: 6 },
});
