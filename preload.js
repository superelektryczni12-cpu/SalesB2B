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
});
