import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { ConfirmationProvider } from "./contexts/ConfirmationContext";
import { ThemeContextProvider } from "./contexts/ThemeContext";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import EntriesPage from "./pages/EntriesPage";
import EntryDetailPage from "./pages/EntryDetailPage";
import EditEntryPage from "./pages/EditEntryPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import FlashcardsPage from "./pages/FlashcardsPage";
import ReaderPage from "./pages/ReaderPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <ThemeContextProvider>
      <AuthProvider>
        <ConfirmationProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/entries" element={
                <ProtectedRoute>
                  <EntriesPage />
                </ProtectedRoute>
              } />
              <Route path="/entries/:id" element={
                <ProtectedRoute>
                  <EntryDetailPage />
                </ProtectedRoute>
              } />
              <Route path="/edit/:id" element={
                <ProtectedRoute>
                  <EditEntryPage />
                </ProtectedRoute>
              } />
              <Route path="/flashcards" element={
                <ProtectedRoute>
                  <FlashcardsPage />
                </ProtectedRoute>
              } />
              <Route path="/reader" element={
                <ProtectedRoute>
                  <ReaderPage />
                </ProtectedRoute>
              } />
              <Route path="/profile" element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              } />
              <Route path="/settings" element={
                <ProtectedRoute>
                  <SettingsPage />
                </ProtectedRoute>
              } />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Layout>
        </ConfirmationProvider>
      </AuthProvider>
    </ThemeContextProvider>
  );
}

export default App;
