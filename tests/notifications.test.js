/**
 * @fileoverview Unit tests for NotificationManager.
 */

import { jest } from '@jest/globals';
import { NotificationManager } from '../js/notifications.js';

describe('NotificationManager', () => {
  let manager;
  let container;

  beforeEach(() => {
    // Mock DOM
    document.body.innerHTML = `
      <div id="toast-container"></div>
      <div id="alert-banner" class="hidden">
        <span id="alert-banner-text"></span>
      </div>
    `;
    
    manager = new NotificationManager();
    manager.init();
    container = document.getElementById('toast-container');
    
    // Mock Notification API
    global.Notification = {
      permission: 'default',
      requestPermission: jest.fn().mockResolvedValue('granted')
    };
  });

  test('init() finds the toast container', () => {
    expect(manager._toastContainer).not.toBeNull();
  });

  test('showBanner() updates the banner UI', () => {
    manager.showBanner('Emergency Alert', 'danger');
    const banner = document.getElementById('alert-banner');
    const text = document.getElementById('alert-banner-text');
    
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(text.textContent).toBe('Emergency Alert');
    expect(banner.dataset.type).toBe('danger');
  });

  test('hideBanner() hides the banner UI', () => {
    manager.showBanner('Test');
    manager.hideBanner();
    const banner = document.getElementById('alert-banner');
    expect(banner.classList.contains('hidden')).toBe(true);
  });

  test('showToast() creates a toast element', () => {
    const notification = {
      id: 't1',
      type: 'success',
      title: 'Order Ready',
      body: 'Your food is ready at Stand N1',
      timestamp: Date.now()
    };
    
    manager.showToast(notification);
    
    const toast = container.querySelector('.toast--success');
    expect(toast).not.toBeNull();
    expect(toast.querySelector('.toast__title').textContent).toBe('Order Ready');
  });

  test('requestPushPermission() updates permission state', async () => {
    const result = await manager.requestPushPermission();
    expect(result).toBe(true);
    expect(global.Notification.requestPermission).toHaveBeenCalled();
  });
});
