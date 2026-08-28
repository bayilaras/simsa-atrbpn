// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@/context/theme-context';
import { ThemeProvider } from './theme-provider';

describe('ThemeProvider', () => {
    beforeEach(() => {
        const values = new Map();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key) => values.get(key) ?? null),
            setItem: vi.fn((key, value) => values.set(key, String(value))),
            removeItem: vi.fn((key) => values.delete(key)),
            clear: vi.fn(() => values.clear()),
        });
        document.documentElement.className = '';
    });

    it('keeps the theme setter stable across theme updates', () => {
        const wrapper = ({ children }) => (
            <ThemeProvider defaultTheme="light">{children}</ThemeProvider>
        );
        const { result } = renderHook(() => useTheme(), { wrapper });
        const initialSetter = result.current.setTheme;

        act(() => {
            result.current.setTheme('dark');
        });

        expect(result.current.theme).toBe('dark');
        expect(result.current.setTheme).toBe(initialSetter);
        expect(localStorage.getItem('vite-ui-theme')).toBe('dark');
    });
});
