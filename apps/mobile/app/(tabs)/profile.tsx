import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
const menuItems = [
  { icon: "👤", title: "My Profile", subtitle: "View & edit" },
  { icon: "🔔", title: "Notifications", subtitle: "Manage alerts" },
  { icon: "❓", title: "Help & Support", subtitle: "Get help" },
];
export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>JD</Text>
        </View>
        <Text style={styles.userName}>John Doe</Text>
        <Text style={styles.userEmail}>john@example.com</Text>
      </View>
      <View style={styles.menuSection}>
        {menuItems.map((item, index) => (
          <TouchableOpacity key={index} style={styles.menuItem}>
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{item.title}</Text>
              <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.logoutButton}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: { padding: 20, paddingTop: 60, backgroundColor: "#8B5CF6" },
  title: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  profileCard: {
    alignItems: "center",
    backgroundColor: "#fff",
    margin: 16,
    padding: 24,
    borderRadius: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#8B5CF6",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 28, fontWeight: "bold" },
  userName: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1F2937",
    marginTop: 12,
  },
  userEmail: { fontSize: 14, color: "#6B7280", marginTop: 4 },
  menuSection: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    borderRadius: 12,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  menuIcon: { fontSize: 20 },
  menuContent: { flex: 1, marginLeft: 12 },
  menuTitle: { fontSize: 16, color: "#1F2937" },
  menuSubtitle: { fontSize: 12, color: "#9CA3AF" },
  chevron: { fontSize: 20, color: "#D1D5DB" },
  logoutButton: {
    backgroundColor: "#FEE2E2",
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  logoutText: { color: "#EF4444", fontSize: 16, fontWeight: "600" },
});
