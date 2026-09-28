import { BrowserRouter } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { AuthProvider } from './providers/AuthProvider';
import { AppRouter } from './router';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { ToastViewport } from './components/ui/Toast';
import { ForegroundDoseReminder } from './components/notifications/ForegroundDoseReminder';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryProvider>
          <BrowserRouter>
            <AuthProvider>
              <AppRouter />
              <ForegroundDoseReminder />
              <ToastViewport />
            </AuthProvider>
          </BrowserRouter>
        </QueryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
