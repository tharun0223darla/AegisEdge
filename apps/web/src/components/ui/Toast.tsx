import { Toaster, toast as hotToast, type ToastOptions } from 'react-hot-toast';
import { colors } from '@/theme/colors';

/**
 * Themed toast viewport. Mounted once near the app root.
 * Use the `notify` helper below for consistent styling across the app.
 */
export function ToastViewport() {
  return (
    <Toaster
      position="top-right"
      gutter={10}
      toastOptions={{
        duration: 4000,
        style: {
          background: colors.bg.overlay,
          color: colors.text.primary,
          border: `1px solid ${colors.border.DEFAULT}`,
          borderRadius: '12px',
          fontSize: '14px',
          padding: '10px 14px',
          boxShadow: '0 12px 32px -8px rgba(0,0,0,0.6)',
        },
        success: { iconTheme: { primary: colors.success.DEFAULT, secondary: colors.bg.overlay } },
        error: { iconTheme: { primary: colors.danger.DEFAULT, secondary: colors.bg.overlay } },
      }}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const notify = {
  success: (message: string, options?: ToastOptions) => hotToast.success(message, options),
  error: (message: string, options?: ToastOptions) => hotToast.error(message, options),
  warning: (message: string, options?: ToastOptions) => hotToast(message, { icon: '⚠️', ...options }),
  loading: (message: string, options?: ToastOptions) => hotToast.loading(message, options),
  message: (message: string, options?: ToastOptions) => hotToast(message, options),
  dismiss: (id?: string) => hotToast.dismiss(id),
  promise: hotToast.promise,
};
