import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { GlobalSettingsProvider } from './contexts/GlobalSettingsContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

import VillasTable from './components/VillasTable';
import AdminSettings from './components/AdminSettings';
import AgentsPage from './components/AgentsPage';
import ClientsPage from './components/ClientsPage';
import QuotesPage from './components/QuotesPage';
import BookingsPage from './components/BookingsPage';
import PayoutManager from './components/PayoutManager';
import VillaView from './components/VillaView';
import QuotePublicView from './components/QuotePublicView';
import AgentSettings from './components/AgentSettings';
import OwnerSettings from './components/OwnerSettings';
import OwnersPage from './components/OwnersPage';
import AgencyAgentsPage from './components/AgencyAgentsPage';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsAndConditions from './components/TermsAndConditions';
import BoatsPage from './components/BoatsPage';
import BoatView from './components/BoatView';

import GuestPublicFormView from './components/GuestFormPublicView';
import OwnerConfirmationView from './components/OwnerConfirmationView';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Prevent infinite fetch floods when returning to tab
      retry: 2, // Be more patient with network blips
      staleTime: 1000 * 60 * 10, // Data is fresh for 10 minutes
    },
  },
});

// Guard: must be logged in
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin size-8 border-2 border-primary border-t-transparent rounded-full"></div>
        <span className="text-[10px] text-text-muted uppercase tracking-[0.2em]">Verifying Session...</span>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

// Guard: must be admin
const AdminRoute = ({ children }) => {
  const { user, role, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (role !== 'admin' && role !== 'super_admin') return <Navigate to="/" replace />;
  return children;
};

// Guard: must be super admin
const SuperAdminRoute = ({ children }) => {
  const { user, role, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (role !== 'super_admin') return <Navigate to="/" replace />;
  return children;
};

// Logic for profile element (handles role-based view)
const ProfileElement = () => {
  const { role } = useAuth();
  return role === 'owner' ? <OwnerSettings /> : <AgentSettings />;
};

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider>
            <GlobalSettingsProvider>
              <Router>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/quote/:id" element={<QuotePublicView />} />
                  <Route path="/confirm-availability/:id" element={<OwnerConfirmationView />} />
                  <Route path="/guest-info/:token" element={<GuestPublicFormView />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<TermsAndConditions />} />

                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <Layout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Dashboard />} />
                    <Route path="villas" element={<VillasTable />} />
                    <Route path="villas/:id" element={<VillaView />} />
                    <Route path="boats" element={<BoatsPage />} />
                    <Route path="boats/:id" element={<BoatView />} />
                    <Route path="clients" element={<ClientsPage />} />
                    <Route path="quotes" element={<QuotesPage />} />
                    <Route path="bookings" element={<BookingsPage />} />
                    <Route path="profile" element={<ProfileElement />} />
                    <Route path="team" element={<AgencyAgentsPage />} />
                    <Route path="settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />
                    <Route path="agents" element={<AdminRoute><AgentsPage /></AdminRoute>} />
                    <Route path="owners" element={<ProtectedRoute><OwnersPage /></ProtectedRoute>} />
                    <Route path="payouts" element={<SuperAdminRoute><PayoutManager /></SuperAdminRoute>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Router>
            </GlobalSettingsProvider>
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
