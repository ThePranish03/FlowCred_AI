import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  COMPANY_DEFAULT,
  NOTIFICATION_PREFS_DEFAULT,
  WORKSPACES,
} from "@/lib/constants";

interface CompanySettings {
  name: string;
  industry: string;
  baseCurrency: string;
  timezone: string;
  fiscalYear: string;
  country: string;
}

interface PreferencesState {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  workspaceId: string;
  company: CompanySettings;
  notifications: typeof NOTIFICATION_PREFS_DEFAULT;
  readNotificationIds: string[];
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setWorkspace: (id: string) => void;
  updateCompany: (updates: Partial<CompanySettings>) => void;
  setNotification: (key: keyof typeof NOTIFICATION_PREFS_DEFAULT, value: boolean) => void;
  markNotificationsRead: (ids: string[]) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      workspaceId: WORKSPACES[0].id,
      company: { ...COMPANY_DEFAULT },
      notifications: { ...NOTIFICATION_PREFS_DEFAULT },
      readNotificationIds: [],
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      setWorkspace: (id) => set({ workspaceId: id }),
      updateCompany: (updates) => set((state) => ({ company: { ...state.company, ...updates } })),
      setNotification: (key, value) =>
        set((state) => ({ notifications: { ...state.notifications, [key]: value } })),
      markNotificationsRead: (ids) =>
        set((state) => ({
          readNotificationIds: Array.from(new Set([...state.readNotificationIds, ...ids])),
        })),
    }),
    { name: "flowcred-preferences", version: 1 },
  ),
);
