import { useAuth } from '../context/AuthContext';

/**
 * Hook для управления аутентификацией
 */
export default function useAuthAdapter() {
  return useAuth();
}
