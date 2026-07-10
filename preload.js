const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onNewBooking: (cb) => ipcRenderer.on('new-booking', (_e, booking) => cb(booking)),
  getBookings: () => ipcRenderer.invoke('get-bookings'),
  updateBookingStatus: (id, status) => ipcRenderer.invoke('update-booking-status', id, status),
  searchPlaces: (query, city) => ipcRenderer.invoke('search-places', query, city),
  getPlaceDetails: (placeId) => ipcRenderer.invoke('get-place-details', placeId),
  analyzeCompanyWebsite: (website) => ipcRenderer.invoke('analyze-company-website', website),
  backendStatus: () => ipcRenderer.invoke('backend-status'),
  restoreSession: () => ipcRenderer.invoke('auth-restore'),
  login: (email, password) => ipcRenderer.invoke('auth-login', email, password),
  register: (account) => ipcRenderer.invoke('auth-register', account),
  logout: () => ipcRenderer.invoke('auth-logout'),
  listEmployees: () => ipcRenderer.invoke('employees-list'),
  saveEmployee: (employee) => ipcRenderer.invoke('employees-save', employee),
  deleteEmployee: (id) => ipcRenderer.invoke('employees-delete', id),
  loadUserData: () => ipcRenderer.invoke('user-data-load'),
  saveUserData: (dataKey, value) => ipcRenderer.invoke('user-data-save', dataKey, value),
  loadTeamData: () => ipcRenderer.invoke('team-data-load'),
  saveTeamUserData: (userId, dataKey, value) => ipcRenderer.invoke('team-data-save', userId, dataKey, value),
  listChatThreads: () => ipcRenderer.invoke('chat-threads-list'),
  listChatMessages: (threadId) => ipcRenderer.invoke('chat-messages-list', threadId),
  sendChatMessage: (payload) => ipcRenderer.invoke('chat-message-send', payload),
  uploadChatFile: (file) => ipcRenderer.invoke('chat-file-upload', file),
  createChatFileUrl: (path) => ipcRenderer.invoke('chat-file-url', path),
  generateSalesAI: (action, payload) => ipcRenderer.invoke('sales-ai-generate', action, payload),
  apolloContacts: (action, payload) => ipcRenderer.invoke('apollo-contacts', action, payload),
  getSalesJourneyStats: () => ipcRenderer.invoke('sales-journey-stats'),
  generateColdEmail: (payload) => ipcRenderer.invoke('cold-email-generate', payload),
  pushToInstantly: (payload) => ipcRenderer.invoke('instantly-push', payload),
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: (manual = false) => ipcRenderer.invoke('updates-check', manual),
  installUpdate: () => ipcRenderer.invoke('updates-install'),
  onUpdateEvent: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('update-event', listener);
    return () => ipcRenderer.removeListener('update-event', listener);
  },
});
