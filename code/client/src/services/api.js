import axios from 'axios';

export const TOKEN_KEY = 'onboardiq_token';

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api/v1' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// An expired/invalid token anywhere sends the user back to the login page.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) {
      localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(err);
  },
);

/** Normalises any axios error to { code, message, details: [{field, message}] } for display. */
export function errorInfo(err) {
  const e = err?.response?.data?.error;
  if (e) return { code: e.code, message: e.message, details: e.details || [] };
  if (err?.response) return { code: 'HTTP_' + err.response.status, message: `Request failed (${err.response.status})`, details: [] };
  return { code: 'NETWORK', message: 'Cannot reach the server. Is the API running on port 3001?', details: [] };
}

// ---- auth
export const loginRequest = (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data);
export const registerRequest = (name, email, password) =>
  api.post('/auth/register', { name, email, password }).then((r) => r.data);
export const meRequest = () => api.get('/auth/me').then((r) => r.data.user);

// ---- applications (Person 1)
export const createApplication = (formData, onProgress) =>
  api
    .post('/applications', formData, {
      onUploadProgress: (e) => onProgress && e.total && onProgress(Math.round((e.loaded / e.total) * 100)),
    })
    .then((r) => r.data.application);
export const listMyApplications = () => api.get('/applications').then((r) => r.data.applications);
export const getApplication = (id) => api.get(`/applications/${id}`).then((r) => r.data.application);
export const getDocumentContent = (id, docId) =>
  api.get(`/applications/${id}/documents/${encodeURIComponent(docId)}/content`).then((r) => r.data.document);

export const resubmitApplication = (id, formData, onProgress) =>
  api
    .post(`/applications/${id}/resubmit`, formData, {
      onUploadProgress: (e) => onProgress && e.total && onProgress(Math.round((e.loaded / e.total) * 100)),
    })
    .then((r) => r.data.application);
export const listOccupations = () => api.get('/reference/occupations').then((r) => r.data.occupations);

// ---- KYC officer (maker)
export const reviewQueue = (status) => api.get('/review/queue', { params: { status } }).then((r) => r.data);
export const correctField = (id, docId, field, body) =>
  api.patch(`/review/${id}/documents/${encodeURIComponent(docId)}/fields/${field}`, body).then((r) => r.data);
export const recommend = (id, body) => api.post(`/review/${id}/recommend`, body).then((r) => r.data.application);
export const reextract = (docId, applicationId) =>
  api.post(`/documents/${encodeURIComponent(docId)}/extract`, { application_id: applicationId }).then((r) => r.data);

// ---- compliance officer (checker)
export const pendingQueue = () => api.get('/compliance/pending').then((r) => r.data);
export const decide = (id, body) => api.post(`/compliance/${id}/decision`, body).then((r) => r.data.application);
export const openAccount = (id) => api.post(`/compliance/${id}/open-account`).then((r) => r.data.application);
export const getDashboard = (params) => api.get('/compliance/dashboard', { params }).then((r) => r.data);
export const getConfig = () => api.get('/compliance/config').then((r) => r.data.config);
export const patchConfig = (changes) => api.patch('/compliance/config', { changes }).then((r) => r.data.config);
export const listWatchlist = (list, q) => api.get('/compliance/watchlists', { params: { list, q } }).then((r) => r.data);
export const createWatchEntry = (body) => api.post('/compliance/watchlists', body).then((r) => r.data);
export const deleteWatchEntry = (list, id) => api.delete(`/compliance/watchlists/${list}/${id}`).then((r) => r.data);
export const rescreen = () => api.post('/compliance/rescreen', {}).then((r) => r.data);
export const searchAudit = (params) => api.get('/compliance/audit', { params }).then((r) => r.data);
export const applicationAudit = (id) => api.get(`/applications/${id}/audit`).then((r) => r.data.events);
export const downloadAuditCsv = async (id) => {
  const res = await api.get(`/applications/${id}/audit/export`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_${id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

export default api;
