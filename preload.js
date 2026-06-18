const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onNewBooking: (cb) => ipcRenderer.on('new-booking', (_e, booking) => cb(booking)),
  getBookings: () => ipcRenderer.invoke('get-bookings'),
  updateBookingStatus: (id, status) => ipcRenderer.invoke('update-booking-status', id, status),
  searchPlaces: (query, city) => ipcRenderer.invoke('search-places', query, city),
  getPlaceDetails: (placeId) => ipcRenderer.invoke('get-place-details', placeId),
});
