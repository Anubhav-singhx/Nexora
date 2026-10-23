import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TOKEN_KEY, loginRequest, meRequest, registerRequest } from '../services/api.js';

const AuthContext = createContext(null);

export const ROLES = {
  APPLICANT: 'APPLICANT',
  KYC_OFFICER: 'KYC_OFFICER',
  COMPLIANCE_OFFICER: 'COMPLIANCE_OFFICER',
};

/** Where each role lands after login. */
export const landingPath = (role) =>
  ({ APPLICANT: '/applications', KYC_OFFICER: '/review', COMPLIANCE_OFFICER: '/compliance' })[role] || '/login';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));

  // Restore the session from a saved token.
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    meRequest()
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const finish = ({ token, user: u }) => {
    localStorage.setItem(TOKEN_KEY, token);
    setUser(u);
    return u;
  };

  const login = useCallback(async (email, password) => finish(await loginRequest(email, password)), []);
  const register = useCallback(async (name, email, password) => finish(await registerRequest(name, email, password)), []);
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
