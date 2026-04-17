/**
 * @fileoverview Unit tests for AuthManager.
 */

import { jest } from '@jest/globals';
import { AuthManager } from '../js/auth.js';

// Mocking is now handled by moduleNameMapper in package.json

describe('AuthManager', () => {
  let manager;

  beforeEach(() => {
    // Clear sessionStorage
    sessionStorage.clear();
    manager = new AuthManager();
  });

  test('constructor restores session from sessionStorage', () => {
    const mockUser = { uid: '123', displayName: 'Test User' };
    sessionStorage.setItem('siq_session', JSON.stringify(mockUser));
    
    const newManager = new AuthManager();
    expect(newManager.getCurrentUser().uid).toBe('123');
  });

  test('signOut() clears the current user and session', async () => {
    const mockUser = { uid: '123', displayName: 'Test User' };
    manager._setUser(mockUser);
    
    await manager.signOut();
    
    expect(manager.getCurrentUser()).toBeNull();
    expect(sessionStorage.getItem('siq_session')).toBeNull();
  });

  test('onAuthStateChanged() registers listeners', () => {
    const callback = jest.fn();
    manager.onAuthStateChanged(callback);
    
    expect(callback).toHaveBeenCalledWith(null);
    
    const mockUser = { uid: '123', role: 'attendee' };
    manager._setUser(mockUser);
    
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ uid: '123' }));
  });

  test('hasRole() identifies user permissions', () => {
    manager._setUser({ role: 'admin' });
    expect(manager.hasRole('admin')).toBe(true);
    expect(manager.hasRole('attendee')).toBe(false);
  });
});
