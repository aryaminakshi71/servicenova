import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
const children = [
  { id: "1", name: "Alex", age: 6, sessions: 12, progress: "75%" },
  { id: "2", name: "Emma", age: 5, sessions: 8, progress: "60%" },
];
export default function ChildrenScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Children</Text>
        <Text style={styles.subtitle}>Registered children</Text>
      </View>
      <FlatList
        data={children}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.childCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
            </View>
            <View style={styles.childInfo}>
              <Text style={styles.childName}>{item.name}</Text>
              <Text style={styles.childAge}>Age: {item.age}</Text>
            </View>
            <View style={styles.progressBadge}>
              <Text style={styles.progressText}>{item.progress}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: { padding: 20, paddingTop: 60, backgroundColor: "#8B5CF6" },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  subtitle: { fontSize: 14, color: "#EDE9FE", marginTop: 4 },
  childCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#8B5CF6",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  childInfo: { flex: 1, marginLeft: 12 },
  childName: { fontSize: 16, fontWeight: "600", color: "#1F2937" },
  childAge: { fontSize: 14, color: "#6B7280" },
  progressBadge: {
    backgroundColor: "#EDE9FE",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  progressText: { fontSize: 14, fontWeight: "600", color: "#8B5CF6" },
});
