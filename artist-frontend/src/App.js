import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './state/auth/AuthContext';
import Shell from './ui/layout/Shell';
import LoginPage from './ui/pages/LoginPage';
import SignupPage from './ui/pages/SignupPage';
import DashboardPage from './ui/pages/DashboardPage';
import SecurityPage from './ui/pages/SecurityPage';
import OnboardingPage from './ui/pages/OnboardingPage';
import AdminClaimsPage from './ui/pages/AdminClaimsPage';
import ManageArtistPage from './ui/pages/ManageArtistPage';
import TracksPage from './ui/pages/TracksPage';
import AnalyticsPage from './ui/pages/AnalyticsPage';

function ProtectedRoute({ children, allowWithoutMfa = false, allowNonArtist = false }) {
    const { status, user, portal } = useAuth();

    if (status === 'loading') {
        return <Shell><div style={{ padding: 24 }}>Загрузка...</div></Shell>;
    }

    if (status === 'guest') {
        return <Navigate to="/login" replace />;
    }

    if (status === 'degraded' && !user) {
        return <Shell><div style={{ padding: 24 }}>Сессия временно проверяется...</div></Shell>;
    }

    if (!allowNonArtist && portal?.isArtist !== true) {
        return <Navigate to="/onboarding" replace />;
    }

    if (!allowWithoutMfa && portal?.isArtist === true && portal?.mfa?.enabled !== true) {
        return <Navigate to="/security/2fa" replace />;
    }

    return children;
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route
                    path="/onboarding"
                    element={
                        <ProtectedRoute allowWithoutMfa={true} allowNonArtist={true}>
                            <OnboardingPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/security/2fa"
                    element={
                        <ProtectedRoute allowWithoutMfa={true} allowNonArtist={true}>
                            <SecurityPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/security"
                    element={
                        <ProtectedRoute allowWithoutMfa={true} allowNonArtist={true}>
                            <SecurityPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/admin/claims"
                    element={
                        <ProtectedRoute allowWithoutMfa={true} allowNonArtist={true}>
                            <AdminClaimsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/manage"
                    element={
                        <ProtectedRoute allowWithoutMfa={true}>
                            <ManageArtistPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/tracks"
                    element={
                        <ProtectedRoute allowWithoutMfa={true}>
                            <TracksPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/analytics"
                    element={
                        <ProtectedRoute allowWithoutMfa={false}>
                            <AnalyticsPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/"
                    element={
                        <ProtectedRoute allowWithoutMfa={false}>
                            <DashboardPage />
                        </ProtectedRoute>
                    }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
