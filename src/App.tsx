import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { ConfirmationProvider } from "./contexts/ConfirmationContext";
import { ThemeContextProvider } from "./contexts/ThemeContext";
import { VocabularyUpdateProvider } from "./contexts/VocabularyUpdateContext";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import EntriesPage from "./pages/EntriesPage";
import EntryDetailPage from "./pages/EntryDetailPage";
import EditEntryPage from "./pages/EditEntryPage";
import ProfilePage from "./pages/ProfilePage";
import AccountPage from "./pages/AccountPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";
import FlashcardsPage from "./pages/FlashcardsPage";
import FlashcardsLearnPage from "./pages/FlashcardsLearnPage";
import FlashcardsDecksPage from "./pages/FlashcardsDecksPage";
import ReaderPage from "./pages/ReaderPage";
import MarketViewerPage from "./pages/MarketViewerPage";
import DictionaryPage from "./pages/DictionaryPage";
import SortCardsPage from "./pages/SortCardsPage";
import VocabCardDetailPage from "./pages/VocabCardDetailPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <ThemeContextProvider>
      <AuthProvider>
        <VocabularyUpdateProvider>
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
                <Route path="/flashcards/learn" element={
                  <ProtectedRoute allowPublic>
                    <FlashcardsLearnPage />
                  </ProtectedRoute>
                } />
                <Route path="/flashcards/decks" element={<FlashcardsDecksPage />} />
                <Route path="/reader" element={
                  <ProtectedRoute>
                    <ReaderPage />
                  </ProtectedRoute>
                } />
                <Route path="/dictionary" element={
                  <ProtectedRoute>
                    <DictionaryPage />
                  </ProtectedRoute>
                } />
                <Route path="/discover/sort/:language" element={
                  <ProtectedRoute allowPublic>
                    <SortCardsPage />
                  </ProtectedRoute>
                } />
                <Route path="/flashcards/card/:id" element={
                  <ProtectedRoute allowPublic>
                    <VocabCardDetailPage />
                  </ProtectedRoute>
                } />
                <Route path="/night-market" element={
                  <ProtectedRoute>
                    <MarketViewerPage />
                  </ProtectedRoute>
                } />
                <Route path="/profile" element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                } />
                <Route path="/account" element={
                  <ProtectedRoute allowPublic>
                    <AccountPage />
                  </ProtectedRoute>
                } />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Layout>
          </ConfirmationProvider>
        </VocabularyUpdateProvider>
      </AuthProvider>
    </ThemeContextProvider>
  );
}

export default App;
