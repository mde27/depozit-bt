import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Cerere from './pages/Cerere';
import Tickets from './pages/Tickets';
import TicketDetail from './pages/TicketDetail';
import TicketScanPage from './pages/TicketScanPage';
import Stock from './pages/Stock';
import StockMovements from './pages/StockMovements';
import Logs from './pages/Logs';
import Users from './pages/Users';

function Private({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Se încarcă…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Private>
            <Layout />
          </Private>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="cerere" element={<Cerere />} />
        <Route path="cerere/:id" element={<Cerere />} />
        <Route path="tichete" element={<Tickets />} />
        <Route path="tichete/:id" element={<TicketDetail />} />
        <Route path="tichete/:id/scan/:stage" element={<TicketScanPage />} />
        <Route path="stock" element={<Stock />} />
        <Route path="stock/:id/movements" element={<StockMovements />} />
        <Route path="logs" element={<Logs />} />
        <Route path="users" element={<Users />} />
        {/* legacy redirects */}
        <Route path="client" element={<Navigate to="/cerere" replace />} />
        <Route path="warehouse" element={<Navigate to="/tichete" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
