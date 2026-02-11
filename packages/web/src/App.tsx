import { AuthProvider, useAuthContext } from "./components/Auth/AuthProvider";
import { LoginForm } from "./components/Auth/LoginForm";
import { ChatContainer } from "./components/Chat/ChatContainer";
import "./App.css";

function AppContent() {
  const { session, loading } = useAuthContext();

  if (loading) {
    return <div className="app-loading">Loading...</div>;
  }

  if (!session) {
    return <LoginForm />;
  }

  return <ChatContainer />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
