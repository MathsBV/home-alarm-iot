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
  const [channels, setChannels] = useState({ push: false, email: true, sms: true });

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
      { text: "Excluir", style: "destructive", onPress: async () => {
        if (!homeId) return;
        await api.deleteContact(homeId, await getToken(), contact.id);
        await load();
      } },
    ]);
  };

  return (
    <Screen title="Contatos" subtitle="Pessoas que recebem alertas da residência.">
      <Button title={showForm ? "Cancelar cadastro" : "Adicionar contato"} variant={showForm ? "secondary" : "primary"} onPress={() => setShowForm(!showForm)} />
      {showForm ? (
        <View style={styles.form}>
          <Field label="Nome" value={name} onChangeText={setName} placeholder="Nome do contato" />
          <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="contato@email.com" />
          <Field label="Telefone com DDI" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+5511999999999" />
          <Channel label="Push" value={channels.push} onChange={(push) => setChannels({ ...channels, push })} />
          <Channel label="E-mail" value={channels.email} onChange={(value) => setChannels({ ...channels, email: value })} />
          <Channel label="SMS" value={channels.sms} onChange={(sms) => setChannels({ ...channels, sms })} />
          <Button title="Salvar contato" onPress={save} disabled={!name || (!email && !phone)} />
        </View>
      ) : null}
      {!contacts.length && !showForm ? <Text style={styles.empty}>Nenhum destinatário cadastrado.</Text> : null}
      {contacts.map((contact) => (
        <View key={contact.id} style={styles.contact}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{contact.name.slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.copy}>
            <Text style={styles.name}>{contact.name}</Text>
            <Text style={styles.detail}>{contact.email || contact.phone}</Text>
            <View style={styles.tags}>
              {Object.entries(contact.channels).filter(([, enabled]) => enabled).map(([channel]) => <Text key={channel} style={styles.tag}>{channel.toUpperCase()}</Text>)}
            </View>
          </View>
          <Pressable onPress={() => remove(contact)} hitSlop={10}><Ionicons name="trash-outline" size={20} color={colors.danger} /></Pressable>
        </View>
      ))}
    </Screen>
  );
}

function Channel({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.channel}><Text style={styles.name}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primaryDark, false: colors.border }} thumbColor={colors.white} /></View>;
}

const styles = StyleSheet.create({
  form: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, padding: 16, gap: 13 },
  channel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  empty: { color: colors.textMuted, textAlign: "center", paddingVertical: 40 },
  contact: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 45, height: 45, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryDark },
  avatarText: { color: colors.white, fontWeight: "900", fontSize: 18 },
  copy: { flex: 1, gap: 3 },
  name: { color: colors.text, fontWeight: "800" },
  detail: { color: colors.textMuted, fontSize: 12 },
  tags: { flexDirection: "row", gap: 5, marginTop: 4 },
  tag: { color: colors.primary, fontSize: 9, fontWeight: "900", backgroundColor: "#0F3D37", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
});
