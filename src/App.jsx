import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import VillasTable from './components/VillasTable';
import AdminSettings from './components/AdminSettings';
import AgentsPage from './components/AgentsPage';
import ClientsPage from './components/ClientsPage';
import QuotesPage from './components/QuotesPage';
import VillaView from './components/VillaView';
import QuotePublicView from './components/QuotePublicView';
import AgentSettings from './components/AgentSettings';

// Guard: must be logged in
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background-dark">
      <div className="animate-spin size-8 border-2 border-primary border-t-transparent rounded-full"></div>
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
  if (role !== 'admin') return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/quote/:id" element={<QuotePublicView />} />

          {/* All authenticated routes share the Layout */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* Index → Dashboard */}
            <Route index element={<Dashboard />} />

            {/* Villa inventory */}
            <Route path="villas" element={<VillasTable />} />
            <Route path="villas/:id" element={<VillaView />} />

            {/* Business */}
            <Route path="clients" element={<ClientsPage />} />
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="profile" element={<AgentSettings />} />

            {/* Admin only */}
            <Route path="settings" element={
              <AdminRoute><AdminSettings /></AdminRoute>
            } />
            <Route path="agents" element={
              <AdminRoute><AgentsPage /></AdminRoute>
            } />

            {/* Redirect any unknown path back to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
